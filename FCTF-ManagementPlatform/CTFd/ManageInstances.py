import datetime
from flask import Blueprint, request, jsonify, render_template, redirect
from CTFd.cache import clear_user_session
from CTFd.models import Users, Teams, db
from CTFd.utils.decorators import admins_only

ManageInstance= Blueprint("instance", __name__)

@ManageInstance.route('/get-instances', methods= ['GET'])
@admins_only
def getListInstance():
    Startup_Time= datetime.time

    return render_template('admin/ManageInstance.html', Startup_Time= Startup_Time)

    
    