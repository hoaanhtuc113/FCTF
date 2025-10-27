# import os

# API_URL_CONTROLSERVER = os.environ["API_URL_CONTROLSERVER"]
# API_URL_ADMINSERVER = os.environ["API_URL_ADMINSERVER"]
# HOST_CACHE = os.environ["HOST_CACHE"]
# PRIVATE_KEY = os.environ["PRIVATE_KEY"]
import os

# Sử dụng os.environ.get để lấy giá trị hoặc dùng giá trị mặc định
API_URL_CONTROLSERVER = os.environ.get("API_URL_CONTROLSERVER", "http://controlserver:5000")
API_URL_ADMINSERVER = os.environ.get("API_URL_ADMINSERVER", "http://adminserver:5000")
DEPLOYMENT_SERVICE_API = os.environ.get("DEPLOYMENT_SERVICE_API", "http://deploymentservice:5020")
HOST_CACHE = os.environ.get("HOST_CACHE", None)  # Giá trị mặc định là None nếu không được cung cấp
PRIVATE_KEY = os.environ.get("PRIVATE_KEY", None)  # Giá trị mặc định là None nếu không được cung cấp
ARGO_WORKFLOWS_URL = os.environ.get("ARGO_WORKFLOWS_URL", None)
ARGO_WORKFLOWS_TOKEN = os.environ.get("ARGO_WORKFLOWS_TOKEN", None)

# Redis
REDIS_HOST = os.environ.get("REDIS_HOST", "localhost")
REDIS_PORT = int(os.environ.get("REDIS_PORT", 6379))
REDIS_PASS = os.environ.get("REDIS_PASS", None)
REDIS_DB = int(os.environ.get("REDIS_DB", 0))

# Database
DATABASE_PORT = int(os.environ.get("DATABASE_PORT", 3306))

# NFS Configuration - Path to store challenge folders
NFS_MOUNT_PATH = os.environ.get("NFS_MOUNT_PATH", "/mnt/nfs/data")
UPLOAD_PROVIDER = os.environ.get("UPLOAD_PROVIDER", "filesystem")
