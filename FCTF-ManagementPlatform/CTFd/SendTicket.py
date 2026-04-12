"""
Ticket utility functions used by the admin panel (admin/Ticket.py).

All contestant-facing HTTP routes have been removed.
This module is now admin-only.
"""
from flask import jsonify
from CTFd.models import Tickets, Users, Teams, db
from sqlalchemy.orm import aliased


def _string_or_empty(value):
    return value if value is not None else ""


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

        if result is None:
            return {'message': 'Ticket not found', 'ticket': None}, 404

        ticket, author_name, replier_name = result

        ticket_data = {
            'id': ticket.id,
            'author_name': _string_or_empty(author_name),
            'status': _string_or_empty(ticket.status),
            'title': _string_or_empty(ticket.title),
            'date': ticket.create_at,
            'type': _string_or_empty(ticket.type),
            'description': _string_or_empty(ticket.description),
            'replier_name': _string_or_empty(replier_name),
            'replier_message': _string_or_empty(ticket.replier_message)
        }

        return {'ticket': ticket_data}, 200
    except Exception as e:
        return {'message': 'An error occurred while retrieving ticket', 'error': str(e)}, 500


def get_all_tickets(user_id=None, status=None, type_=None, search=None, page=1, per_page=50):
    try:
        page = max(int(page), 1)
        per_page = max(int(per_page), 1)

        Author = aliased(Users)
        Replier = aliased(Users)
        Team = aliased(Teams)
        query = db.session.query(
            Tickets,
            Author.name.label('author_name'),
            Replier.name.label('replier_name'),
            Team.name.label('team_name')
        ).join(Author, Tickets.author_id == Author.id) \
        .outerjoin(Replier, Tickets.replier_id == Replier.id) \
        .outerjoin(Team, Author.team_id == Team.id)

        if user_id:
            query = query.filter(Tickets.author_id == user_id)
        if status:
            query = query.filter(Tickets.status.ilike(status))
        if type_:
            query = query.filter(Tickets.type.ilike(type_))
        if search:
            query = query.filter(Tickets.title.ilike(f"%{search}%"))

        total = query.count()
        tickets = query.order_by(Tickets.create_at.desc()).offset((page-1)*per_page).limit(per_page).all()

        tickets_data = []
        for ticket, author_name, replier_name, team_name in tickets:
            tickets_data.append({
                'author_name': _string_or_empty(author_name),
                'team_name': _string_or_empty(team_name),
                'status': _string_or_empty(ticket.status),
                'id': ticket.id,
                'title': _string_or_empty(ticket.title),
                'type': _string_or_empty(ticket.type),
                'date': ticket.create_at,
                'description': _string_or_empty(ticket.description),
                'replier_name': _string_or_empty(replier_name),
                'replier_message': _string_or_empty(ticket.replier_message)
            })

        return {'tickets': tickets_data, 'total': total}, 200
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
        ticket.status = "Closed"

        db.session.commit()

        return {
            'message': 'Ticket updated successfully',
        }, 200
    except Exception as e:
        return {
            'message': 'Ticket updated failed',
        }, 400

