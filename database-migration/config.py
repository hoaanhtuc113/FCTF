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
        self.kctf_url = os.getenv('DB_KCTF_URL')
        self.ctfd_url = os.getenv('DB_CTFD_URL')
        self.mapping_kctf_to_ctfd = os.getenv('MAPPING_KCTF_TO_CTFD', './mapping_fctf_to_ctfd.json')
        self.mapping_ctfd_to_kctf = os.getenv('MAPPING_CTFD_TO_KCTF', './mapping_ctfd_to_fctf.json')
        
        # Validate configuration
        if not self.kctf_url:
            raise ValueError("DB_KCTF_URL not found in environment variables")
        if not self.ctfd_url:
            raise ValueError("DB_CTFD_URL not found in environment variables")
        
        # Create engines
        self.kctf_engine = create_engine(self.kctf_url, echo=False)
        self.ctfd_engine = create_engine(self.ctfd_url, echo=False)
        
        # Create session makers
        self.KCTFSession = sessionmaker(bind=self.kctf_engine)
        self.CTFdSession = sessionmaker(bind=self.ctfd_engine)
        
        # Metadata for reflection
        self.kctf_metadata = MetaData()
        self.ctfd_metadata = MetaData()
    
    def get_kctf_session(self):
        """Get KCTF database session"""
        return self.KCTFSession()
    
    def get_ctfd_session(self):
        """Get CTFd database session"""
        return self.CTFdSession()
    
    def load_mapping(self, direction):
        """Load mapping configuration based on direction"""
        if direction == 'kctf_to_ctfd':
            mapping_file = self.mapping_kctf_to_ctfd
        elif direction == 'ctfd_to_kctf':
            mapping_file = self.mapping_ctfd_to_kctf
        else:
            raise ValueError(f"Invalid direction: {direction}")
        
        if not os.path.exists(mapping_file):
            raise FileNotFoundError(f"Mapping file not found: {mapping_file}")
        
        with open(mapping_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def test_connections(self):
        """Test database connections"""
        try:
            with self.kctf_engine.connect() as conn:
                conn.execute(text("SELECT 1"))
            print("✓ KCTF database connection successful")
        except Exception as e:
            print(f"✗ KCTF database connection failed: {e}")
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
        self.kctf_engine.dispose()
        self.ctfd_engine.dispose()
