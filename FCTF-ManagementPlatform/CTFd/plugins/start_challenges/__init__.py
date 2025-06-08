from flask import Blueprint
from CTFd.plugins import register_plugin_assets_directory
from .routes import start_challenge_api
from flask_cors import CORS # type: ignore
#from flask_wtf.csrf import CSRFProtect

def load(app):
    app.register_blueprint(start_challenge_api)
    
    CORS(app)

    #CSRFProtect(app)
    
