from flask import Blueprint, jsonify

# Define the API route for getting resource metrics
resource_api = Blueprint('resource_api', __name__, url_prefix='/api/v1')

# config= config.load_kube_config()
