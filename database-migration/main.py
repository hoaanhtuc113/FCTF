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
