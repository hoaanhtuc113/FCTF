from flask import Blueprint, Flask
from CTFd.plugins import register_plugin_assets_directory
from .routes import file_app


def load(app):
    #app = Flask(__name__)
    app.register_blueprint(file_app, url_prefix='/api/v1')

    # CSRFProtect(app)
