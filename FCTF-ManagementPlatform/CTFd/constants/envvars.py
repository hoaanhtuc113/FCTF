# import os

# API_URL_CONTROLSERVER = os.environ["API_URL_CONTROLSERVER"]
# API_URL_ADMINSERVER = os.environ["API_URL_ADMINSERVER"]
# HOST_CACHE = os.environ["HOST_CACHE"]
# PRIVATE_KEY = os.environ["PRIVATE_KEY"]
import os

# Sử dụng os.environ.get để lấy giá trị hoặc dùng giá trị mặc định
API_URL_CONTROLSERVER = os.environ.get("API_URL_CONTROLSERVER", "http://controlserver:5000")
API_URL_ADMINSERVER = os.environ.get("API_URL_ADMINSERVER", "http://adminserver:5000")
HOST_CACHE = os.environ.get("HOST_CACHE", None)  # Giá trị mặc định là None nếu không được cung cấp
PRIVATE_KEY = os.environ.get("PRIVATE_KEY", None)  # Giá trị mặc định là None nếu không được cung cấp
