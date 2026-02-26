from flask import render_template, request, url_for

from CTFd.admin import admin
from CTFd.models import Notifications
from CTFd.utils.decorators import admin_or_jury, admins_only


@admin.route("/admin/notifications")
@admin_or_jury
def notifications():
    page = abs(request.args.get("page", 1, type=int))
    per_page = request.args.get("per_page", 20, type=int)
    per_page = max(1, min(per_page, 100))
    
    notifs = (
        Notifications.query
        .order_by(Notifications.id.desc())
        .paginate(page=page, per_page=per_page, error_out=False)
    )
    
    args = dict(request.args)
    args.pop("page", None)
    
    return render_template(
        "admin/notifications.html",
        notifications=notifs,
        prev_page=url_for(request.endpoint, page=notifs.prev_num, **args),
        next_page=url_for(request.endpoint, page=notifs.next_num, **args),
        per_page=per_page,
    )
