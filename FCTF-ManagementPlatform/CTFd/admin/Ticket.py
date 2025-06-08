import json
from flask import abort, flash, jsonify, redirect, render_template, request, session, url_for
import requests

from CTFd.admin import admin
from CTFd.SendTicket import get_all_tickets, get_ticket_by_id, send_ticket_from_relier
from CTFd.utils.decorators import admins_only
from CTFd.plugins import bypass_csrf_protection

@admin.route("/admin/viewticket")
def view_tickets():
    try:
        # Get all tickets from the API function
        response, status_code = get_all_tickets()  # Get both the response and status code

        # Check if the status code is 200 (OK)
        if  status_code == 200:
            tickets_data = response.get("tickets", [])
            print(tickets_data)
            return render_template("admin/Ticket/view_ticket.html", tickets=tickets_data)
        else:
            # If no tickets found or API error, pass an empty list
            return render_template("admin/Ticket/view_ticket.html", tickets=[])

    except Exception as e:
        # Handle any unexpected errors and return an error message
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