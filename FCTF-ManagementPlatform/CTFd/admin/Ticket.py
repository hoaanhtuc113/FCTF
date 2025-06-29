import json
from flask import abort, flash, jsonify, redirect, render_template, request, session, url_for
import requests

from CTFd.admin import admin
from CTFd.SendTicket import get_all_tickets, get_ticket_by_id, send_ticket_from_relier
from CTFd.utils.decorators import admins_only
from CTFd.plugins import bypass_csrf_protection


# View tickets with filter, search, pagination, and bulk delete
@admin.route("/admin/viewticket", methods=["GET"])
def view_tickets():
    try:
        page = int(request.args.get("page", 1))
        per_page = int(request.args.get("per_page", 10))
        user_id = request.args.get("user_id", type=int)
        status = request.args.get("status", type=str)
        type_ = request.args.get("type", type=str)
        search = request.args.get("search", type=str)

        response, status_code = get_all_tickets(
            user_id=user_id,
            status=status,
            type_=type_,
            search=search,
            page=page,
            per_page=per_page
        )

        tickets = response.get("tickets", []) if status_code == 200 else []
        total = response.get("total", 0) if status_code == 200 else 0


        # Lấy tất cả status/type từ model Tickets (distinct)
        all_status = ["Open", "Closed"]
        all_type = ["Question", "Error"]

        selected_status = status
        selected_type = type_

        return render_template(
            "admin/Ticket/view_ticket.html",
            tickets=tickets,
            total=total,
            per_page=per_page,
            page=page,
            status_options=all_status,
            type_options=all_type,
            selected_status=selected_status,
            selected_type=selected_type,
            search=search
        )
    except Exception as e:
        return jsonify({'message': 'An error occurred while retrieving tickets', 'error': str(e)}), 500



@admin.route("/admin/ticket-details/<int:ticket_id>", methods=['GET'])
def view_tickets_detail(ticket_id):
    try:
        user_id = session.get("id")

        (response, status_code) = get_ticket_by_id(ticket_id=ticket_id)
        ticket_data = response.get('ticket')

        print(ticket_data) 
        if(ticket_data):
            return render_template("admin/Ticket/ticket_details.html", ticket_data=ticket_data, userId=user_id)
        else:
            print("Error retrieving ticket:")
            return render_template("admin/Ticket/ticket_details.html", ticket_data={}, message="Error retrieving ticket")
    
    except Exception as e:
        print("Exception:", str(e))
        return render_template("admin/Ticket/ticket_details.html", ticket_data={}, message=f"An unexpected error occurred: {str(e)}")


@admin.route("/admin/send-ticket-response", methods=['POST'])
@bypass_csrf_protection
def send_response():
    try:
        ticket_id = request.form.get("ticket_id")
        replier_id = session["id"]
        response_content = request.form.get("response")

        if not ticket_id or not replier_id or not response_content:
            flash("All fields are required", "danger")
            return redirect(url_for('admin.view_tickets_detail', ticket_id=ticket_id))

        data = {
            "ticket_id": ticket_id,
            "replier_id": replier_id,
            "replier_message": response_content
        }
        
        (response, status_code) = send_ticket_from_relier(ticket_id,data)
        
        if status_code == 200:
            flash("Message sent successfully", "success")
        else:
            flash("Failed to submit the response. Please try again", "danger")
        
        return redirect(url_for('admin.view_tickets'))

    except Exception as e:
        flash(f"An unexpected error occurred: {str(e)}", "danger")
        return redirect(url_for('admin.view_tickets'))