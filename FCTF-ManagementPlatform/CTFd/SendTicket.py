# routes/sendticket.py

from difflib import SequenceMatcher
from flask import Blueprint, jsonify, request, flash, render_template, abort, session
from CTFd.utils.decorators import require_verified_emails, during_ctf_time_only
from CTFd.utils.user import authed
from CTFd.models import Tickets, Tokens, Users, db
from CTFd.plugins import bypass_csrf_protection
from CTFd.StartChallenge import get_token_from_header
from sqlalchemy.orm import aliased
import datetime


sendticket = Blueprint("sendticket", __name__)


@sendticket.route("/sendticket")
@require_verified_emails
@during_ctf_time_only
def send_ticket():
    if not authed():
        abort(403)

        return render_template("send_ticket.html")

    return render_template("send_ticket.html")

@sendticket.route("/api/sendticket", methods=['POST'])
@require_verified_emails
@bypass_csrf_protection
@during_ctf_time_only
def send_ticket_from_user():
    data = request.get_json() or request.form.to_dict()
    generatedToken= get_token_from_header()
   
    if not generatedToken:
        return jsonify({"error": "generatedToken is required"}), 400
    token = Tokens.query.filter_by(value=generatedToken).first()
    if token is None:
        return jsonify({"error": "Token not found"}), 404
    user = Users.query.filter_by(id=token.user_id).first()
    if user is None:
        return jsonify({"error": "User not found"}), 404
    if  not data.get('title') or not data.get('type') or not data.get('description'):
        return jsonify({'message': 'Missing information'}), 400

    new_ticket = Tickets(
        author_id= user.id,
        title=data['title'],
        type=data['type'],
        description=data['description'],
        create_at= datetime.datetime.now()
    )

    tickets = Tickets.query.filter_by(author_id=new_ticket.author_id).all()
    
    for ticket in tickets:
        similarity = SequenceMatcher(
            None, ticket.description, new_ticket.description).ratio()
        if similarity >= 0.3:
            return jsonify({'message': 'You have already sent a similar ticket', 'status': False}), 400

    db.session.add(new_ticket)
    db.session.commit()
    return jsonify({'message': 'Send ticket successfully', 'status': True}), 201


@sendticket.route("/api/tickets/<int:ticket_id>", methods=['GET'])
@during_ctf_time_only
@bypass_csrf_protection
def get_ticket_by_id(ticket_id):
    try:
        Author = aliased(Users)
        Replier = aliased(Users)

        result = db.session.query(
            Tickets,
            Author.name.label('author_name'),
            Replier.name.label('replier_name')
        ).join(Author, Tickets.author_id == Author.id) \
        .outerjoin(Replier, Tickets.replier_id == Replier.id) \
        .filter(Tickets.id == ticket_id) \
        .first()

        ticket, author_name, replier_name = result

        # Chuẩn bị dữ liệu để trả về
        ticket_data = {
            'id': ticket.id,
            'author_name': author_name,
            'status':ticket.status,
            'title': ticket.title,
            'date':ticket.create_at,
            'type': ticket.type,
            'description': ticket.description,
            'replier_name': replier_name,
            'replier_message': ticket.replier_message
        }

        return {'ticket': ticket_data}, 200
    except Exception as e:
        return jsonify({'message': 'An error occurred while retrieving ticket', 'error': str(e)}), 500


@sendticket.route("/api/tickets", methods=['GET'])
@bypass_csrf_protection
@during_ctf_time_only
def get_all_tickets():
    try:
        Author = aliased(Users)
        Replier = aliased(Users)

        tickets = db.session.query(
            Tickets,
            Author.name.label('author_name'),
            Replier.name.label('replier_name')
        ).join(Author, Tickets.author_id == Author.id) \
        .outerjoin(Replier, Tickets.replier_id == Replier.id) \
        .all()

        tickets_data = []
        for ticket, author_name, replier_name in tickets:
            tickets_data.append({
                'author_name': author_name,
                'status': ticket.status,
                'id':ticket.id,
                'title': ticket.title,
                'type': ticket.type,
                'date':ticket.create_at,
                'description': ticket.description,
                'replier_name': replier_name,
                'replier_message': ticket.replier_message
            })

        return {'tickets': tickets_data}, 200  # Return as a dict and status code
    except Exception as e:
        return {'message': 'An error occurred while retrieving tickets', 'error': str(e)}, 500


def send_ticket_from_relier(ticket_id, data):
    try:
        if not data.get('replier_id') or not data.get('replier_message'):
            return jsonify({'message': 'Missing information'}), 400

        ticket = db.session.query(Tickets).filter(Tickets.id == ticket_id).first()

        if not ticket:
            return jsonify({'message': 'Ticket not found'}), 404

        ticket.replier_id = data['replier_id']
        ticket.replier_message = data['replier_message']
        ticket.status="Closed"

        # Commit the changes to the database
        db.session.commit()

        # Fetch author and replier names if needed
        Author = aliased(Users)
        Replier = aliased(Users)
        ticket_info = db.session.query(
            Tickets,
            Author.name.label('author_name'),
            Replier.name.label('replier_name')
        ).join(Author, Tickets.author_id == Author.id) \
        .outerjoin(Replier, Tickets.replier_id == Replier.id) \
        .filter(Tickets.id == ticket_id) \
        .first()

        return {
            'message': 'Ticket updated successfully',
        }, 200
    except Exception as e:
        return {
            'message': 'Ticket updated failed',
        }, 400


@sendticket.route("/api/tickets-user", methods=['GET'])
@bypass_csrf_protection
@during_ctf_time_only
def get_user_tickets():
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Authorization missing'}), 400

        # Extract the token from the header (assuming it's a Bearer token)
        token_value = auth_header.split(" ")[1]
        token = Tokens.query.filter_by(value=token_value).first_or_404()

        user = Users.query.filter_by(id=token.user_id).first()
        if not user:
            return jsonify({'message': 'User not found'}), 404

        current_user_id = user.id
        print(current_user_id)
        Author = aliased(Users)
        Replier = aliased(Users)


        tickets = db.session.query(
            Tickets,
            Author.name.label('author_name'),
            Replier.name.label('replier_name')
        ).join(Author, Tickets.author_id == Author.id) \
        .outerjoin(Replier, Tickets.replier_id == Replier.id) \
        .filter(Tickets.author_id == token.user_id) \
        .all()

        tickets_data = []
        for ticket, author_name, replier_name in tickets:
            tickets_data.append({
                'author_name': author_name,
                'status': ticket.status,
                'id': ticket.id,
                'title': ticket.title,
                'type': ticket.type,
                'date': ticket.create_at,
                'description': ticket.description,
                'replier_name': replier_name,
                'replier_message': ticket.replier_message
            })

        return {'tickets': tickets_data}, 200
    except Exception as e:
        return {'message': 'An error occurred while retrieving tickets', 'error': str(e)}, 500