from datetime import datetime
import hashlib
import random
import time
from flask import Flask, render_template, request, jsonify
import requests
from CTFd.plugins import bypass_csrf_protection
from CTFd.admin import admin
from CTFd.constants.envvars import API_URL_CONTROLSERVER, PRIVATE_KEY
from CTFd.models import Challenges, Teams
import json

from CTFd.utils.decorators import admin_or_jury
from CTFd.utils.connector.multiservice_connector import estimate_server

@admin.route("/admin/estimate", methods=["GET", "POST"])
@admin_or_jury
@bypass_csrf_protection
def estimate():
    if request.method == "GET":
        return render_template("admin/estimation.html")
    elif request.method == "POST":
        return estimate_server()
