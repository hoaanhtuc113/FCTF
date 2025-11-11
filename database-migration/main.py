#!/usr/bin/env python3
"""
Database Migration Console
Migrate data between KCTF and CTFd databases
"""

import sys
from config import DatabaseConfig
from migrator import DataMigrator

def print_banner():
    """Print application banner"""
    banner = """
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║          DATABASE MIGRATION TOOL                          ║
║          KCTF ↔ CTFd Data Transfer                        ║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
    """
    print(banner)

def print_menu():
    """Print main menu"""
    menu = """
┌───────────────────────────────────────────────────────────┐
│  Please select migration direction:                      │
├───────────────────────────────────────────────────────────┤
│  [1] KCTF → CTFd                                          │
│  [2] CTFd → KCTF                                          │
│  [3] Test Database Connections                            │
│  [4] Clean CTFd Database (DROP ALL TABLES)                │
│  [0] Exit                                                 │
└───────────────────────────────────────────────────────────┘
    """
    print(menu)

def test_connections(db_config):
    """Test database connections"""
    print("\n" + "="*60)
    print("TESTING DATABASE CONNECTIONS")
    print("="*60 + "\n")
    
    success = db_config.test_connections()
    
    if success:
        print("\n✓ All database connections are working!")
    else:
        print("\n✗ Some database connections failed!")
    
    input("\nPress Enter to continue...")

def clean_ctfd_database(db_config):
    """Drop CTFd database"""
    print(f"\n{'='*60}")
    print(f"⚠️  DANGER: DROP CTFd DATABASE")
    print(f"{'='*60}")
    print("\nThis operation will:")
    print("  • DROP the entire CTFd database")
    print("  • DELETE ALL TABLES and DATA permanently")
    print("  • This action CANNOT be undone!")
    print("\n⚠️  WARNING: Make sure you have backed up your database!")
    
    # Triple confirmation
    print("\nType 'DROP DATABASE' to confirm (case-sensitive):")
    confirm1 = input("> ").strip()
    
    if confirm1 != 'DROP DATABASE':
        print("\n✗ Operation cancelled - confirmation text did not match")
        input("\nPress Enter to continue...")
        return
    
    print("\nAre you absolutely sure? Type 'YES' to proceed:")
    confirm2 = input("> ").strip().upper()
    
    if confirm2 != 'YES':
        print("\n✗ Operation cancelled by user")
        input("\nPress Enter to continue...")
        return
    
    try:
        print("\n" + "="*60)
        print("DROPPING CTFd DATABASE")
        print("="*60 + "\n")
        
        # Get database name from URL
        from sqlalchemy.engine.url import make_url
        db_url = make_url(db_config.ctfd_url)
        db_name = db_url.database
        
        print(f"Database: {db_name}")
        print(f"Host: {db_url.host}:{db_url.port}")
        print("\nDropping database...")
        
        # Create connection without database selection
        from sqlalchemy import create_engine, text
        base_url = f"{db_url.drivername}://{db_url.username}:{db_url.password}@{db_url.host}:{db_url.port}/"
        engine = create_engine(base_url)
        
        with engine.connect() as conn:
            # Drop database
            conn.execute(text(f"DROP DATABASE IF EXISTS `{db_name}`"))
            conn.commit()
            print(f"✓ Database '{db_name}' dropped successfully")
            
            # Recreate empty database
           
        
        engine.dispose()
        
        print("\n✓ CTFd database cleaned successfully!")
        
    except Exception as e:
        print(f"\n✗ Error cleaning database: {e}")
    
    input("\nPress Enter to continue...")

def confirm_migration(direction):
    """Ask for confirmation before migration"""
    direction_text = "KCTF → CTFd" if direction == 'kctf_to_ctfd' else "CTFd → KCTF"
    
    print(f"\n{'='*60}")
    print(f"⚠  WARNING: You are about to migrate data")
    print(f"   Direction: {direction_text}")
    print(f"{'='*60}")
    print("\nThis operation will:")
    print("  • Read data from source database")
    print("  • Insert/Update data in target database")
    print("  • May modify existing records")
    print("\nPlease make sure you have:")
    print("  ✓ Backed up your databases")
    print("  ✓ Reviewed the mapping configuration")
    print("  ✓ Tested on a non-production environment first")
    
    while True:
        response = input("\nDo you want to proceed? (yes/no): ").strip().lower()
        if response in ['yes', 'y']:
            return True
        elif response in ['no', 'n']:
            return False
        else:
            print("Please enter 'yes' or 'no'")

def run_migration(db_config, direction):
    """Run the migration process"""
    if not confirm_migration(direction):
        print("\n✗ Migration cancelled by user")
        input("\nPress Enter to continue...")
        return
    
    migrator = DataMigrator(db_config)
    success = migrator.migrate(direction)
    
    if success:
        print("\n✓ Migration completed successfully!")
    else:
        print("\n✗ Migration completed with errors")
    
    input("\nPress Enter to continue...")

def main():
    """Main application loop"""
    try:
        # Initialize database configuration
        print("Loading configuration...")
        db_config = DatabaseConfig()
        print("✓ Configuration loaded\n")
        
    except Exception as e:
        print(f"\n✗ Configuration error: {e}")
        print("\nPlease check:")
        print("  • .env file exists and contains DB_KCTF_URL and DB_CTFD_URL")
        print("  • Mapping files exist (mapping_fctf_to_ctfd.json, mapping_ctfd_to_fctf.json)")
        sys.exit(1)
    
    try:
        while True:
            print_banner()
            print_menu()
            
            choice = input("Enter your choice: ").strip()
            
            if choice == '1':
                # KCTF to CTFd
                run_migration(db_config, 'kctf_to_ctfd')
                
            elif choice == '2':
                # CTFd to KCTF
                run_migration(db_config, 'ctfd_to_kctf')
                
            elif choice == '3':
                # Test connections
                test_connections(db_config)
                
            elif choice == '4':
                # Clean CTFd database
                clean_ctfd_database(db_config)
                
            elif choice == '0':
                # Exit
                print("\nExiting... Goodbye!")
                break
                
            else:
                print("\n✗ Invalid choice. Please try again.")
                input("\nPress Enter to continue...")
    
    except KeyboardInterrupt:
        print("\n\nInterrupted by user. Exiting...")
    
    except Exception as e:
        print(f"\n✗ Unexpected error: {e}")
    
    finally:
        # Clean up
        db_config.close()
        print("\n✓ Database connections closed")

if __name__ == "__main__":
    main()
