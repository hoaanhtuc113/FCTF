from flask import Blueprint
from CTFd.plugins import register_plugin_assets_directory
from .routes import resource_api

def load(app):
    # Register the API route for resource metrics
    app.register_blueprint(resource_api)