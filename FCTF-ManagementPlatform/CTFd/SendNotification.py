"""
Notification utility functions used by the admin panel (admin/contests.py).

Admin creates a Notification targeted at one or more teams or one or more
users within a contest. Each target becomes a NotificationRecipients row;
NotificationReads tracks which actual user has opened it (relevant for the
contestant-facing bell icon, built separately).
"""
from sqlalchemy import or_

from CTFd.models import (
    ContestParticipant,
    Contests,
    NotificationReads,
    NotificationRecipients,
    Notifications,
    Teams,
    UserTeamMember,
    Users,
    db,
)


def _string_or_empty(value):
    return value if value is not None else ""


def contest_participant_user_ids(contest_id):
    """Query of user ids that belong to the given contest, either via a team
    membership or a direct ContestParticipant record."""
    team_member_ids = (
        db.session.query(UserTeamMember.user_id)
        .join(Teams, Teams.id == UserTeamMember.team_id)
        .filter(Teams.contest_id == contest_id)
    )
    cp_user_ids = db.session.query(ContestParticipant.user_id).filter(
        ContestParticipant.contest_id == contest_id
    )
    return team_member_ids.union(cp_user_ids)


def search_contest_users(contest_id, q, limit=10):
    if not q:
        return []
    users_in_contest = contest_participant_user_ids(contest_id)
    users = (
        Users.query.filter(
            Users.id.in_(users_in_contest),
            or_(Users.name.ilike(f"%{q}%"), Users.email.ilike(f"%{q}%")),
        )
        .order_by(Users.name.asc())
        .limit(limit)
        .all()
    )
    return [{"id": u.id, "name": u.name, "email": u.email} for u in users]


def create_notification(contest_id, author_id, title, content, target_type, team_ids=None, user_ids=None):
    try:
        contest = Contests.query.filter_by(id=contest_id).first()
        if not contest:
            return {"success": False, "errors": {"contest_id": ["Contest not found."]}}, 404

        title = (title or "").strip()
        content = (content or "").strip()
        if not title or not content:
            return {"success": False, "errors": {"title": ["Title and message are required."]}}, 400

        target_type = (target_type or "").strip().lower()
        if target_type not in ("team", "user"):
            return {"success": False, "errors": {"target_type": ["target_type must be 'team' or 'user'."]}}, 400

        if target_type == "team":
            team_ids = sorted({int(t) for t in (team_ids or []) if str(t).strip()})
            if not team_ids:
                return {"success": False, "errors": {"team_ids": ["Select at least one team."]}}, 400
            valid_count = Teams.query.filter(
                Teams.id.in_(team_ids), Teams.contest_id == contest_id
            ).count()
            if valid_count != len(team_ids):
                return {
                    "success": False,
                    "errors": {"team_ids": ["One or more teams do not belong to this contest."]},
                }, 400
        else:
            user_ids = sorted({int(u) for u in (user_ids or []) if str(u).strip()})
            if not user_ids:
                return {"success": False, "errors": {"user_ids": ["Select at least one user."]}}, 400
            participant_ids = {uid for (uid,) in contest_participant_user_ids(contest_id).all()}
            if not set(user_ids).issubset(participant_ids):
                return {
                    "success": False,
                    "errors": {"user_ids": ["One or more users are not participants of this contest."]},
                }, 400

        notification = Notifications(
            contest_id=contest_id,
            author_id=author_id,
            title=title,
            content=content,
            target_type=target_type,
        )
        db.session.add(notification)
        db.session.flush()

        if target_type == "team":
            for team_id in team_ids:
                db.session.add(
                    NotificationRecipients(notification_id=notification.id, team_id=team_id)
                )
        else:
            for user_id in user_ids:
                db.session.add(
                    NotificationRecipients(notification_id=notification.id, user_id=user_id)
                )

        db.session.commit()
        return {"success": True, "data": {"id": notification.id}}, 200
    except Exception as e:
        db.session.rollback()
        return {"success": False, "errors": {"general": [str(e)]}}, 500


def get_all_notifications(contest_id, target_type=None, search=None, page=1, per_page=50):
    try:
        page = max(int(page), 1)
        per_page = max(int(per_page), 1)

        Author = Users

        query = (
            db.session.query(Notifications, Author.name.label("author_name"))
            .outerjoin(Author, Notifications.author_id == Author.id)
            .filter(Notifications.contest_id == contest_id)
        )

        if target_type:
            query = query.filter(Notifications.target_type == target_type)
        if search:
            query = query.filter(Notifications.title.ilike(f"%{search}%"))

        total = query.count()
        rows = (
            query.order_by(Notifications.created_at.desc())
            .offset((page - 1) * per_page)
            .limit(per_page)
            .all()
        )

        notification_ids = [n.id for n, _ in rows]

        recipient_counts = {}
        read_counts = {}
        if notification_ids:
            recipient_counts = dict(
                db.session.query(
                    NotificationRecipients.notification_id, db.func.count(NotificationRecipients.id)
                )
                .filter(NotificationRecipients.notification_id.in_(notification_ids))
                .group_by(NotificationRecipients.notification_id)
                .all()
            )
            read_counts = dict(
                db.session.query(NotificationReads.notification_id, db.func.count(NotificationReads.id))
                .filter(NotificationReads.notification_id.in_(notification_ids))
                .group_by(NotificationReads.notification_id)
                .all()
            )

        notifications_data = []
        for n, author_name in rows:
            notifications_data.append(
                {
                    "id": n.id,
                    "title": _string_or_empty(n.title),
                    "content": _string_or_empty(n.content),
                    "target_type": _string_or_empty(n.target_type),
                    "author_name": _string_or_empty(author_name),
                    "created_at": n.created_at,
                    "recipient_count": recipient_counts.get(n.id, 0),
                    "read_count": read_counts.get(n.id, 0),
                }
            )

        return {"notifications": notifications_data, "total": total}, 200
    except Exception as e:
        return {"message": "An error occurred while retrieving notifications", "error": str(e)}, 500


def get_notification_by_id(notification_id, contest_id=None):
    try:
        query = Notifications.query.filter(Notifications.id == notification_id)
        if contest_id is not None:
            query = query.filter(Notifications.contest_id == contest_id)
        notification = query.first()

        if notification is None:
            return {"message": "Notification not found", "notification": None}, 404

        author = (
            Users.query.filter_by(id=notification.author_id).first()
            if notification.author_id
            else None
        )

        recipient_rows = (
            db.session.query(NotificationRecipients, Users.name, Teams.name)
            .outerjoin(Users, NotificationRecipients.user_id == Users.id)
            .outerjoin(Teams, NotificationRecipients.team_id == Teams.id)
            .filter(NotificationRecipients.notification_id == notification.id)
            .all()
        )
        recipients_data = [
            {
                "id": recipient.id,
                "type": "team" if recipient.team_id else "user",
                "name": _string_or_empty(team_name if recipient.team_id else user_name),
            }
            for recipient, user_name, team_name in recipient_rows
        ]

        read_rows = (
            db.session.query(NotificationReads, Users.name)
            .join(Users, NotificationReads.user_id == Users.id)
            .filter(NotificationReads.notification_id == notification.id)
            .order_by(NotificationReads.read_at.desc())
            .all()
        )
        reads_data = [
            {"user_name": _string_or_empty(name), "read_at": read.read_at}
            for read, name in read_rows
        ]

        notification_data = {
            "id": notification.id,
            "title": _string_or_empty(notification.title),
            "content": _string_or_empty(notification.content),
            "target_type": _string_or_empty(notification.target_type),
            "created_at": notification.created_at,
            "author_name": _string_or_empty(author.name if author else None),
            "contest_id": notification.contest_id,
            "recipients": recipients_data,
            "reads": reads_data,
            "recipient_count": len(recipients_data),
            "read_count": len(reads_data),
        }
        return {"notification": notification_data}, 200
    except Exception as e:
        return {"message": "An error occurred while retrieving notification", "error": str(e)}, 500


def delete_notifications(notification_ids, contest_id):
    deleted = 0
    for nid in notification_ids:
        try:
            nid_int = int(nid)
        except (TypeError, ValueError):
            continue
        notification = Notifications.query.filter_by(id=nid_int, contest_id=contest_id).first()
        if notification:
            db.session.delete(notification)
            deleted += 1
    db.session.commit()
    return deleted
