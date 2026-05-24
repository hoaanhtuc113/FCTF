"""
CTFd/SendTicketRoute.py

User-facing blueprint for submitting support tickets.
Route: GET/POST /sendticket
"""

from flask import Blueprint, flash, redirect, render_template, request, url_for

from CTFd.models import Tickets, db
from CTFd.utils.decorators import authed_only
from CTFd.utils.user import get_current_user

sendticket = Blueprint("sendticket", __name__)


@sendticket.route("/sendticket", methods=["GET", "POST"])
@authed_only
def send_ticket():
    if request.method == "GET":
        contest_id = request.args.get("contest_id", type=int)
        return render_template("sendticket.html", contest_id=contest_id)

    # POST — create ticket
    current_user = get_current_user()
    if not current_user:
        flash("You must be logged in to submit a ticket.", "danger")
        return redirect(url_for("sendticket.send_ticket"))

    ticket_type    = request.form.get("ticket_type", "").strip()
    ticket_title   = request.form.get("ticket_title", "").strip()
    ticket_message = request.form.get("ticket_message", "").strip()
    contest_id     = request.form.get("contest_id", type=int)

    if not ticket_title or not ticket_message:
        flash("Title and message are required.", "danger")
        return redirect(url_for("sendticket.send_ticket"))

    try:
        ticket = Tickets(
            author_id  = current_user.id,
            title      = ticket_title,
            type       = ticket_type or "Question",
            description= ticket_message,
            status     = "Open",
            contest_id = contest_id,
        )
        db.session.add(ticket)
        db.session.commit()
        flash("Your ticket has been submitted successfully.", "success")
    except Exception as e:
        db.session.rollback()
        flash(f"Failed to submit ticket: {e}", "danger")

    return redirect(url_for("sendticket.send_ticket"))
