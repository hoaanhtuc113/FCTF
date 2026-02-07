from sqlalchemy import Table, select, insert, update, delete, text
from sqlalchemy.exc import SQLAlchemyError, OperationalError, DBAPIError
from datetime import datetime
import time
from functools import wraps

def retry_on_connection_error(max_retries=3, delay=2):
    """
    Decorator to retry database operations on connection errors
    max_retries: Maximum number of retry attempts
    delay: Delay in seconds between retries
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except (OperationalError, DBAPIError) as e:
                    last_exception = e
                    error_msg = str(e).lower()
                    
                    # Check if it's a connection/timeout error
                    if any(keyword in error_msg for keyword in [
                        'timeout', 'lost connection', 'server has gone away',
                        'connection refused', 'can\'t connect', 'broken pipe'
                    ]):
                        if attempt < max_retries - 1:
                            print(f"\n⚠ Connection error (attempt {attempt + 1}/{max_retries}): {e}")
                            print(f"  Retrying in {delay} seconds...")
                            time.sleep(delay)
                            continue
                        else:
                            print(f"\n✗ Connection failed after {max_retries} attempts")
                            raise
                    else:
                        # Not a connection error, don't retry
                        raise
                except Exception as e:
                    # Other exceptions, don't retry
                    raise
            
            # If we get here, all retries failed
            raise last_exception
        
        return wrapper
    return decorator

class DataMigrator:
    """Handle data migration between databases"""
    
    def __init__(self, db_config):
        self.db_config = db_config
        self.stats = {
            'total_tasks': 0,
            'completed_tasks': 0,
            'failed_tasks': 0,
            'total_rows': 0,
            'inserted_rows': 0,
            'updated_rows': 0,
            'unchanged_rows': 0,
            'errors': []
        }
    
    def migrate(self, direction):
        """
        Migrate data based on direction
        direction: 'fctf_to_ctfd' or 'ctfd_to_fctf'
        """
        print(f"\n{'='*60}")
        print(f"Starting migration: {direction.upper().replace('_', ' ')}")
        print(f"{'='*60}\n")
        
        # Load mapping configuration
        try:
            mapping_config = self.db_config.load_mapping(direction)
        except Exception as e:
            print(f"Error loading mapping: {e}")
            return False
        
        # Get source and target sessions
        if direction == 'fctf_to_ctfd':
            source_session = self.db_config.get_fctf_session()
            target_session = self.db_config.get_ctfd_session()
            source_engine = self.db_config.fctf_engine
            target_engine = self.db_config.ctfd_engine
        else:
            source_session = self.db_config.get_ctfd_session()
            target_session = self.db_config.get_fctf_session()
            source_engine = self.db_config.ctfd_engine
            target_engine = self.db_config.fctf_engine
        
        tasks = mapping_config.get('tasks', [])
        self.stats['total_tasks'] = len(tasks)
        
        try:
            for task in tasks:
                print(f"\n{'─'*60}")
                print(f"Processing task: {task['name']}")
                print(f"{'─'*60}")
                
                success = self._process_task(
                    task, 
                    source_session, 
                    target_session,
                    source_engine,
                    target_engine,
                    direction
                )
                
                if success:
                    self.stats['completed_tasks'] += 1
                else:
                    self.stats['failed_tasks'] += 1
            
            # Print summary
            self._print_summary()
            
            return self.stats['failed_tasks'] == 0
            
        except Exception as e:
            print(f"\n✗ Migration failed: {e}")
            self.stats['errors'].append(str(e))
            return False
        finally:
            source_session.close()
            target_session.close()
    
    @retry_on_connection_error(max_retries=3, delay=2)
    def _execute_batch(self, target_session, target_table, batch_data, mode, task):
        """Execute batch insert/update operations"""
        inserted = 0
        updated = 0
        unchanged = 0
        
        try:
            if mode == 'insert':
                # Bulk insert
                if batch_data:
                    target_session.execute(insert(target_table), batch_data)
                    inserted = len(batch_data)
            
            elif mode == 'upsert':
                # Optimize by bulk checking existing records
                pk_cols = task['target']['pk']
                
                # Build OR condition to fetch all potentially existing records in one query
                pk_tuples = []
                for data in batch_data:
                    pk_values = tuple(data.get(col) for col in pk_cols if col in data)
                    pk_tuples.append(pk_values)
                
                # Query all existing records at once
                or_conditions = []
                for data in batch_data:
                    and_conditions = []
                    for col in pk_cols:
                        if col in data:
                            and_conditions.append(target_table.c[col] == data[col])
                    
                    if len(and_conditions) == 1:
                        or_conditions.append(and_conditions[0])
                    elif len(and_conditions) > 1:
                        combined = and_conditions[0]
                        for cond in and_conditions[1:]:
                            combined = combined & cond
                        or_conditions.append(combined)
                
                existing_rows = {}
                if or_conditions:
                    if len(or_conditions) == 1:
                        check_stmt = select(target_table).where(or_conditions[0])
                    else:
                        combined_or = or_conditions[0]
                        for cond in or_conditions[1:]:
                            combined_or = combined_or | cond
                        check_stmt = select(target_table).where(combined_or)
                    
                    result = target_session.execute(check_stmt)
                    for row in result:
                        pk_key = tuple(getattr(row, col) for col in pk_cols)
                        existing_rows[pk_key] = row
                
                # Classify rows into insert, update, or unchanged
                to_insert = []
                to_update = []
                
                for data in batch_data:
                    pk_key = tuple(data.get(col) for col in pk_cols if col in data)
                    
                    if pk_key in existing_rows:
                        existing_row = existing_rows[pk_key]
                        
                        # Check if data actually changed
                        has_changes = False
                        for col, new_val in data.items():
                            if col not in pk_cols and hasattr(existing_row, col):
                                old_val = getattr(existing_row, col)
                                if old_val != new_val:
                                    has_changes = True
                                    break
                        
                        if has_changes:
                            to_update.append(data)
                        else:
                            unchanged += 1
                    else:
                        to_insert.append(data)
                
                # Bulk insert new records
                if to_insert:
                    target_session.execute(insert(target_table), to_insert)
                    inserted = len(to_insert)
                
                # Bulk update changed records
                for data in to_update:
                    where_conditions = []
                    for col in pk_cols:
                        if col in data:
                            where_conditions.append(target_table.c[col] == data[col])
                    
                    if len(where_conditions) == 1:
                        where_clause = where_conditions[0]
                    else:
                        where_clause = where_conditions[0]
                        for cond in where_conditions[1:]:
                            where_clause = where_clause & cond
                    
                    stmt = update(target_table).where(where_clause).values(**data)
                    target_session.execute(stmt)
                    updated += 1
        
        except Exception as e:
            # Log batch error but don't fail entire task
            error_msg = f"Batch operation error: {e}"
            print(f"  ⚠ {error_msg}")
            self.stats['errors'].append(error_msg)
        
        return {'inserted': inserted, 'updated': updated, 'unchanged': unchanged}
    
    @retry_on_connection_error(max_retries=3, delay=2)
    def _process_task(self, task, source_session, target_session, source_engine, target_engine, direction):
        """Process a single migration task"""
        try:
            task_name = task['name']
            source_table_name = task['source']['table']
            target_table_name = task['target']['table']
            mode = task.get('mode', 'upsert')
            columns_mapping = task['columns']
            
            # Execute pre-SQL if exists
            pre_sql = task.get('preSQL', [])
            for sql in pre_sql:
                try:
                    target_session.execute(text(sql))
                    target_session.commit()
                except Exception as e:
                    print(f"  Warning: Pre-SQL execution: {e}")

            if target_table_name == 'dynamic_challenge' and direction == 'fctf_to_ctfd':
                print("  ℹ Ensuring clean dynamic_challenge table for CTFd")
                self._rebuild_ctfd_dynamic_challenge(target_session)
            
            # Reflect source table
            source_table = Table(
                source_table_name, 
                self.db_config.fctf_metadata if source_engine == self.db_config.fctf_engine else self.db_config.ctfd_metadata,
                autoload_with=source_engine
            )
            
            # Reflect target table
            target_table = Table(
                target_table_name,
                self.db_config.ctfd_metadata if target_engine == self.db_config.ctfd_engine else self.db_config.fctf_metadata,
                autoload_with=target_engine
            )
            
            # Read source data
            stmt = select(source_table)
            result = source_session.execute(stmt)
            rows = result.fetchall()
            
            print(f"  Found {len(rows)} rows in source table '{source_table_name}'")
            self.stats['total_rows'] += len(rows)
            
            if len(rows) == 0:
                print(f"  ✓ No data to migrate")
                return True
            
            # Process rows in batches for better performance
            inserted = 0
            updated = 0
            unchanged = 0
            #note
            batch_size = 5000
            batch_data = []
            
            for row in rows:
                try:
                    # Map columns from source to target
                    target_data = {}
                    for target_col, mapping in columns_mapping.items():
                        # Skip if column doesn't exist in target table
                        if target_col not in target_table.c:
                            continue
                            
                        if 'from' in mapping:
                            # Get value from source column
                            source_col = mapping['from']
                            if hasattr(row, source_col):
                                target_data[target_col] = getattr(row, source_col)
                        elif 'const' in mapping:
                            # Use constant value
                            target_data[target_col] = mapping['const']
                    
                    # Add default values for required columns not in mapping
                    for col_name, col in target_table.c.items():
                        # Skip if already mapped
                        if col_name in target_data:
                            continue
                        
                        # Check if column is NOT NULL and has no default
                        if not col.nullable and col.default is None and col.server_default is None:
                            # Set default based on type
                            if str(col.type).startswith('VARCHAR') or str(col.type).startswith('TEXT'):
                                target_data[col_name] = ''
                            elif str(col.type).startswith('INT') or str(col.type).startswith('BIGINT'):
                                target_data[col_name] = 0
                            elif str(col.type).startswith('FLOAT') or str(col.type).startswith('DECIMAL'):
                                target_data[col_name] = 0.0
                            elif str(col.type).startswith('BOOL'):
                                target_data[col_name] = False
                            else:
                                # For other types, try empty string
                                target_data[col_name] = ''
                    
                    # Add to batch
                    batch_data.append(target_data)
                    
                    # Execute batch when size reached
                    if len(batch_data) >= batch_size:
                        result = self._execute_batch(target_session, target_table, batch_data, mode, task)
                        inserted += result['inserted']
                        updated += result['updated']
                        unchanged += result['unchanged']
                        batch_data = []
                
                except Exception as e:
                    # Check if it's a record changed error (can be safely skipped)
                    error_str = str(e)
                    if "Record has changed since last read" in error_str or "1020" in error_str:
                        # Skip this row silently as it might be a concurrent modification
                        print(f"  ⚠ Skipping row due to concurrent modification in '{task_name}'")
                        continue
                    
                    error_msg = f"Error processing row in '{task_name}': {e}"
                    print(f"  ✗ {error_msg}")
                    self.stats['errors'].append(error_msg)
                    continue
            
            # Execute remaining batch
            if batch_data:
                result = self._execute_batch(target_session, target_table, batch_data, mode, task)
                inserted += result['inserted']
                updated += result['updated']
                unchanged += result['unchanged']
            
            # Commit transaction
            target_session.commit()
            
            # Execute post-SQL if exists
            post_sql = task.get('postSQL', [])
            for sql in post_sql:
                try:
                    target_session.execute(text(sql))
                    target_session.commit()
                except Exception as e:
                    print(f"  Warning: Post-SQL execution: {e}")

            if target_table_name == 'dynamic_challenge':
                mapped_rows = self._map_rows_for_target(rows, columns_mapping, target_table)
                self._ensure_dynamic_challenge_fk(target_session, target_engine, direction, mapped_rows)
            
            self.stats['inserted_rows'] += inserted
            self.stats['updated_rows'] += updated
            self.stats['unchanged_rows'] += unchanged
            
            print(f"  ✓ Task completed: {inserted} inserted, {updated} updated, {unchanged} unchanged")
            return True
            
        except Exception as e:
            target_session.rollback()
            error_msg = f"Task '{task_name}' failed: {e}"
            print(f"  ✗ {error_msg}")
            self.stats['errors'].append(error_msg)
            return False

    def _map_rows_for_target(self, rows, columns_mapping, target_table):
        mapped_rows = []
        for row in rows:
            target_data = {}
            for target_col, mapping in columns_mapping.items():
                if target_col not in target_table.c:
                    continue

                if 'from' in mapping:
                    source_col = mapping['from']
                    if hasattr(row, source_col):
                        target_data[target_col] = getattr(row, source_col)
                elif 'const' in mapping:
                    target_data[target_col] = mapping['const']

            mapped_rows.append(target_data)

        return mapped_rows

    def _ensure_dynamic_challenge_fk(self, target_session, target_engine, direction, mapped_rows):
        if direction != 'fctf_to_ctfd':
            return

        try:
            fk_count = target_session.execute(text(
                "SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS "
                "WHERE CONSTRAINT_SCHEMA = DATABASE() "
                "AND TABLE_NAME = 'dynamic_challenge' "
                "AND CONSTRAINT_NAME = 'dynamic_challenge_ibfk_1' "
                "AND CONSTRAINT_TYPE = 'FOREIGN KEY'"
            )).scalar()
            target_session.commit()
        except OperationalError as e:
            if self._is_missing_tablespace_error(e) or self._is_table_missing_error(e):
                print("  ⚠ dynamic_challenge missing or corrupted; rebuilding before FK")
                self._rebuild_ctfd_dynamic_challenge(target_session)
                fk_count = 0
            else:
                raise

        if fk_count:
            return

        filtered_rows = self._filter_dynamic_rows_to_existing_challenges(
            target_session,
            mapped_rows
        )

        self._rebuild_ctfd_dynamic_challenge(target_session)
        self._reinsert_dynamic_challenge_rows(target_session, target_engine, filtered_rows)

    def _reinsert_dynamic_challenge_rows(self, target_session, target_engine, mapped_rows):
        if not mapped_rows:
            return

        target_table = Table(
            'dynamic_challenge',
            self.db_config.ctfd_metadata if target_engine == self.db_config.ctfd_engine else self.db_config.fctf_metadata,
            autoload_with=target_engine
        )
        target_session.execute(insert(target_table), mapped_rows)
        target_session.commit()

    def _filter_dynamic_rows_to_existing_challenges(self, target_session, mapped_rows):
        if not mapped_rows:
            return []

        ids = [row.get('id') for row in mapped_rows if row.get('id') is not None]
        if not ids:
            return []

        existing_ids = set()
        chunk_size = 1000
        for i in range(0, len(ids), chunk_size):
            chunk = ids[i:i + chunk_size]
            result = target_session.execute(text(
                "SELECT id FROM challenges WHERE id IN :ids"
            ), {"ids": tuple(chunk)})
            existing_ids.update(row[0] for row in result)

        return [row for row in mapped_rows if row.get('id') in existing_ids]

    @staticmethod
    def _is_fk_violation_error(error):
        message = str(error).lower()
        if 'foreign key constraint fails' in message:
            return True
        orig = getattr(error, 'orig', None)
        if orig and hasattr(orig, 'args') and orig.args:
            return orig.args[0] == 1452
        return False



    @staticmethod
    def _is_missing_tablespace_error(error):
        message = str(error).lower()
        if 'tablespace is missing' in message:
            return True
        orig = getattr(error, 'orig', None)
        if orig and hasattr(orig, 'args') and orig.args:
            return orig.args[0] == 194
        return False

    @staticmethod
    def _is_table_missing_error(error):
        message = str(error).lower()
        if 'doesn\'t exist' in message or 'unknown table' in message:
            return True
        orig = getattr(error, 'orig', None)
        if orig and hasattr(orig, 'args') and orig.args:
            return orig.args[0] == 1146
        return False

    @staticmethod
    def _rebuild_ctfd_dynamic_challenge(target_session):
        rebuild_sql = [
            "SET FOREIGN_KEY_CHECKS=0",
            "DROP TABLE IF EXISTS dynamic_challenge",
            "CREATE TABLE dynamic_challenge ("
            "  id int(11) NOT NULL,"
            "  dynamic_initial int(11) DEFAULT NULL,"
            "  dynamic_minimum int(11) DEFAULT NULL,"
            "  dynamic_decay int(11) DEFAULT NULL,"
            "  dynamic_function varchar(32) DEFAULT NULL,"
            "  PRIMARY KEY (id),"
            "  CONSTRAINT dynamic_challenge_ibfk_1 FOREIGN KEY (id) REFERENCES challenges(id) ON DELETE CASCADE"
            ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci",
            "SET FOREIGN_KEY_CHECKS=1"
        ]

        for sql in rebuild_sql:
            target_session.execute(text(sql))
        target_session.commit()
    
    def _print_summary(self):
        """Print migration summary"""
        print(f"\n{'='*60}")
        print("MIGRATION SUMMARY")
        print(f"{'='*60}")
        print(f"Total tasks:      {self.stats['total_tasks']}")
        print(f"Completed tasks:  {self.stats['completed_tasks']}")
        print(f"Failed tasks:     {self.stats['failed_tasks']}")
        print(f"Total rows:       {self.stats['total_rows']}")
        print(f"Inserted rows:    {self.stats['inserted_rows']}")
        print(f"Updated rows:     {self.stats['updated_rows']}")
        print(f"Unchanged rows:   {self.stats['unchanged_rows']}")
        
        if self.stats['errors']:
            print(f"\nErrors ({len(self.stats['errors'])}):")
            for i, error in enumerate(self.stats['errors'][:10], 1):
                print(f"  {i}. {error}")
            if len(self.stats['errors']) > 10:
                print(f"  ... and {len(self.stats['errors']) - 10} more errors")
        
        print(f"{'='*60}\n")
