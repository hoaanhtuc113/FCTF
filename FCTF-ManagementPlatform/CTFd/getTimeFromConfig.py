from flask import Flask, Blueprint, jsonify
from CTFd.models import db, Configs
from CTFd.utils import get_config, _get_config
from CTFd.utils.dates import ctftime, ctf_ended


get_date_config= Blueprint("get_date_config", __name__)


@get_date_config.route("/api/get_date_config")

def get_date_timr_config():
    try:    
        # Retrieve start and end dates from configuration
        start_date_from_config = get_config("start")
        end_date_from_config = get_config("end")
        
        # Print the retrieved dates for debugging
        print(f"Start Date: {start_date_from_config}")
        print(f"End Date: {end_date_from_config}")
        
        if ctf_ended():
            return jsonify({"message":"CTFd has ended", "isSuccess": True}), 200
        # Return the dates as a JSON response
        if ctftime():
            return jsonify({
            "isSuccess":True,
            "message":"CTFd has been started",
            "start_date": start_date_from_config,
            "end_date": end_date_from_config
        }), 200
        else: 
            return jsonify({
            "isSuccess":True,
            "message":"CTFd is coming...",
            "start_date": start_date_from_config,
        }), 200

    except Exception as e: 
        print(f"Error: {e}")  
        return jsonify({e}), 500
