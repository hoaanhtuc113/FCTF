import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, MetaData, text
from sqlalchemy.orm import sessionmaker
import json

# Load environment variables
load_dotenv()

class DatabaseConfig:
    """Database configuration and connection manager"""
    
    def __init__(self):
        self.fctf_url = os.getenv('DB_FCTF_URL')
        self.ctfd_url = os.getenv('DB_CTFD_URL')
        self.mapping_fctf_to_ctfd = os.getenv('MAPPING_FCTF_TO_CTFD', './mapping_fctf_to_ctfd.json')
        self.mapping_ctfd_to_fctf = os.getenv('MAPPING_CTFD_TO_FCTF', './mapping_ctfd_to_fctf.json')
        
        # Validate configuration
        if not self.fctf_url:
            raise ValueError("DB_FCTF_URL not found in environment variables")
        if not self.ctfd_url:
            raise ValueError("DB_CTFD_URL not found in environment variables")
        
        # Create engines with timeout settings
        self.fctf_engine = create_engine(
            self.fctf_url, 
            echo=False,
            pool_pre_ping=True,  # Test connection before using
            pool_recycle=3600,   # Recycle connections after 1 hour
            connect_args={
                'connect_timeout': 10,  # Connection timeout: 10 seconds
                'read_timeout': 60,     # Read timeout: 30 seconds
                'write_timeout': 60     # Write timeout: 30 seconds
            }
        )
        self.ctfd_engine = create_engine(
            self.ctfd_url, 
            echo=False,
            pool_pre_ping=True,
            pool_recycle=3600,
            connect_args={
                'connect_timeout': 10,
                'read_timeout': 60,
                'write_timeout': 60
            }
        )
        
        # Create session makers
        self.FCTFSession = sessionmaker(bind=self.fctf_engine)
        self.CTFdSession = sessionmaker(bind=self.ctfd_engine)
        
        # Metadata for reflection
        self.fctf_metadata = MetaData()
        self.ctfd_metadata = MetaData()
    
    def get_fctf_session(self):
        """Get FCTF database session"""
        return self.FCTFSession()
    
    def get_ctfd_session(self):
        """Get CTFd database session"""
        return self.CTFdSession()
    
    def load_mapping(self, direction):
        """Load mapping configuration based on direction"""
        if direction == 'fctf_to_ctfd':
            mapping_file = self.mapping_fctf_to_ctfd
        elif direction == 'ctfd_to_fctf':
            mapping_file = self.mapping_ctfd_to_fctf
        else:
            raise ValueError(f"Invalid direction: {direction}")
        
        if not os.path.exists(mapping_file):
            raise FileNotFoundError(f"Mapping file not found: {mapping_file}")
        
        with open(mapping_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def test_connections(self):
        """Test database connections"""
        try:
            with self.fctf_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("✓ FCTF database connection successful")
        except Exception as e:
            print(f"✗ FCTF database connection failed: {e}")
            return False
        
        try:
            with self.ctfd_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("✓ CTFd database connection successful")
        except Exception as e:
            print(f"✗ CTFd database connection failed: {e}")
            return False
        
        return True
    
    def close(self):
        """Close database connections"""
        self.fctf_engine.dispose()
        self.ctfd_engine.dispose()
