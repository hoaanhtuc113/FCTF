from flask import Flask, Blueprint, jsonify
from CTFd.models import db, Configs

from CTFd.utils import get_config, _get_config
from CTFd.constants.config import ConfigTypes, RegistrationVisibilityTypes

get_registration_config= Blueprint("get_registration_config",__name__)

@get_registration_config.route("/api/get_register_config",methods= ['GET'])

def get():
    try: 
        regist_config= get_config(ConfigTypes.REGISTRATION_VISIBILITY)
        if regist_config== RegistrationVisibilityTypes.PUBLIC:
            return jsonify({"success": True, "Visibly": True}), 200
        else: 
            return jsonify({"success": True, "Visibly": False}), 200
    except Exception as e:
        return jsonify({"success":False, "error": e})