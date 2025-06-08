from flask import Blueprint, Flask
from CTFd.plugins import register_plugin_assets_directory
from .routes import file_app
from flask_cors import CORS  # type: ignore


def load(app):
    #app = Flask(__name__)
    app.register_blueprint(file_app, url_prefix='/api/v1')
    CORS(app)  # Enable CORS for the entire app

    # CSRFProtect(app)
