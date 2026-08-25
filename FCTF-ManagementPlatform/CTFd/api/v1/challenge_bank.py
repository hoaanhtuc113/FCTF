import datetime

from flask import request, session
from flask_restx import Namespace, Resource
from sqlalchemy.exc import IntegrityError, OperationalError

from CTFd.models import (
    ChallengeBank,
    ChallengeBankFiles,
    ChallengeBankFlags,
    ChallengeBankHints,
    ChallengeBankTags,
    ChallengeBankTopics,
    Challenges,
    ChallengeFiles,
    ChallengeTopics,
    Contests,
    Flags,
    Hints,
    Tags,
    Topics,
    db,
)
from CTFd.utils.decorators import admin_or_challenge_writer_only_or_jury, admins_only
from CTFd.utils.logging.action_logger import CREATE_CHALLENGE, log_action
from CTFd.utils.logging.audit_logger import log_audit
from CTFd.utils.uploads import get_uploader, hash_file, upload_file
from CTFd.utils.user import can_write_challenges_for_contest

challenge_bank_namespace = Namespace(
    "challenge_bank",
    description="Endpoint to manage the shared Challenge Bank (Management Hub)",
)

# Columns owned by ChallengeBank that a create/update call may set directly.
_BANK_FIELDS = (
    "name",
    "description",
    "category",
    "type",
    "difficulty",
    "require_deploy",
    "deploy_status",
    "deploy_file",
    "image_link",
    "connection_info",
    "connection_protocol",
    "cpu_limit",
    "cpu_request",
    "memory_limit",
    "memory_request",
    "use_gvisor",
    "harden_container",
    "shared_instant",
    "max_deploy_count",
)


def _bank_to_dict(bank):
    data = {field: getattr(bank, field) for field in _BANK_FIELDS}
    data["id"] = bank.id
    data["last_update"] = bank.last_update.isoformat() if bank.last_update else None
    data["created_by"] = bank.created_by
    return data


def _bank_detail_dict(bank):
    data = _bank_to_dict(bank)
    data["flags"] = [
        {"id": f.id, "type": f.type, "content": f.content, "data": f.data}
        for f in ChallengeBankFlags.query.filter_by(challenge_bank_id=bank.id).all()
    ]
    data["hints"] = [
        {"id": h.id, "type": h.type, "content": h.content, "cost": h.cost, "requirements": h.requirements}
        for h in ChallengeBankHints.query.filter_by(challenge_bank_id=bank.id).all()
    ]
    data["tags"] = [
        {"id": t.id, "value": t.value}
        for t in ChallengeBankTags.query.filter_by(challenge_bank_id=bank.id).all()
    ]
    data["topics"] = [
        {"id": t.id, "topic_id": t.topic_id, "value": t.topic.value if t.topic else None}
        for t in ChallengeBankTopics.query.filter_by(challenge_bank_id=bank.id).all()
    ]
    data["files"] = [
        {"id": f.id, "location": f.location}
        for f in ChallengeBankFiles.query.filter_by(challenge_bank_id=bank.id).all()
    ]
    return data


@challenge_bank_namespace.route("")
class ChallengeBankList(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self):
        """List/search bank challenges. Anyone who may write challenges
        somewhere (or review as jury) can browse the bank to clone from it."""
        q = request.args.get("q", "").strip()
        category = request.args.get("category", "")
        type_ = request.args.get("type", "")
        difficulty = request.args.get("difficulty", "")
        page = abs(request.args.get("page", 1, type=int))
        per_page = min(abs(request.args.get("per_page", 50, type=int)), 200)

        query = ChallengeBank.query
        if q:
            query = query.filter(
                db.or_(
                    ChallengeBank.name.ilike(f"%{q}%"),
                    ChallengeBank.category.ilike(f"%{q}%"),
                )
            )
        if category:
            query = query.filter(ChallengeBank.category == category)
        if type_:
            query = query.filter(ChallengeBank.type == type_)
        if difficulty:
            try:
                query = query.filter(ChallengeBank.difficulty == int(difficulty))
            except ValueError:
                pass

        paginated = query.order_by(ChallengeBank.id.desc()).paginate(
            page=page, per_page=per_page, error_out=False
        )

        return {
            "success": True,
            "data": [_bank_to_dict(b) for b in paginated.items],
            "meta": {
                "page": paginated.page,
                "pages": paginated.pages,
                "per_page": per_page,
                "total": paginated.total,
            },
        }

    @admins_only
    def post(self):
        """Create a new bank challenge (content lives here, independent of
        any contest — see ChallengeBankList.clone / ChallengeBankClone for
        how a contest pulls a copy of it in)."""
        data = request.get_json(force=True, silent=True) or {}
        if not (data.get("name") or "").strip():
            return {"success": False, "errors": {"name": ["Required"]}}, 400

        bank = ChallengeBank(
            **{k: data[k] for k in _BANK_FIELDS if k in data},
            last_update=datetime.datetime.utcnow(),
            created_by=session.get("id"),
        )
        db.session.add(bank)
        try:
            db.session.commit()
        except (IntegrityError, OperationalError) as e:
            db.session.rollback()
            return {"success": False, "errors": {"database": [str(e)]}}, 400

        log_audit(
            "challenge_bank_create",
            after={"challenge_bank_id": bank.id, "name": bank.name, "category": bank.category, "type": bank.type},
        )

        return {"success": True, "data": _bank_to_dict(bank)}, 200


@challenge_bank_namespace.route("/<int:bank_id>")
class ChallengeBankDetail(Resource):
    @admin_or_challenge_writer_only_or_jury
    def get(self, bank_id):
        bank = ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        return {"success": True, "data": _bank_detail_dict(bank)}

    @admins_only
    def patch(self, bank_id):
        bank = ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        data = request.get_json(force=True, silent=True) or {}

        before = _bank_to_dict(bank)
        for field in _BANK_FIELDS:
            if field in data:
                setattr(bank, field, data[field])
        bank.last_update = datetime.datetime.utcnow()

        try:
            db.session.commit()
        except (IntegrityError, OperationalError) as e:
            db.session.rollback()
            return {"success": False, "errors": {"database": [str(e)]}}, 400

        log_audit(
            "challenge_bank_update",
            before=before,
            after=_bank_to_dict(bank),
            data={"challenge_bank_id": bank.id},
        )

        return {"success": True, "data": _bank_to_dict(bank)}

    @admins_only
    def delete(self, bank_id):
        bank = ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        bank_info = {"challenge_bank_id": bank.id, "name": bank.name, "category": bank.category}

        # Detach (not delete) any already-cloned contest challenges — they are
        # independent rows and must keep working; only the traceability link
        # is cleared. ON DELETE SET NULL on challenges.source_bank_id already
        # does this at the DB level, but SQLAlchemy's ORM session may not see
        # rows it hasn't loaded, so this is belt-and-suspenders for anyone
        # relying on the in-memory objects within this request.
        Challenges.query.filter_by(source_bank_id=bank.id).update({"source_bank_id": None})

        db.session.delete(bank)
        db.session.commit()

        log_audit("challenge_bank_delete", before=bank_info, data={"challenge_bank_id": bank_info["challenge_bank_id"]})

        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/flags")
class ChallengeBankFlagList(Resource):
    @admins_only
    def get(self, bank_id):
        flags = ChallengeBankFlags.query.filter_by(challenge_bank_id=bank_id).all()
        return {
            "success": True,
            "data": [{"id": f.id, "type": f.type, "content": f.content, "data": f.data} for f in flags],
        }

    @admins_only
    def post(self, bank_id):
        ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        req = request.get_json(force=True, silent=True) or {}
        flag = ChallengeBankFlags(
            challenge_bank_id=bank_id,
            type=req.get("type", "static"),
            content=req.get("content"),
            data=req.get("data"),
        )
        db.session.add(flag)
        db.session.commit()
        return {"success": True, "data": {"id": flag.id, "type": flag.type, "content": flag.content, "data": flag.data}}


@challenge_bank_namespace.route("/<int:bank_id>/flags/<int:flag_id>")
class ChallengeBankFlagDetail(Resource):
    @admins_only
    def delete(self, bank_id, flag_id):
        flag = ChallengeBankFlags.query.filter_by(id=flag_id, challenge_bank_id=bank_id).first_or_404()
        db.session.delete(flag)
        db.session.commit()
        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/hints")
class ChallengeBankHintList(Resource):
    @admins_only
    def get(self, bank_id):
        hints = ChallengeBankHints.query.filter_by(challenge_bank_id=bank_id).all()
        return {
            "success": True,
            "data": [
                {"id": h.id, "type": h.type, "content": h.content, "cost": h.cost, "requirements": h.requirements}
                for h in hints
            ],
        }

    @admins_only
    def post(self, bank_id):
        ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        req = request.get_json(force=True, silent=True) or {}
        cost = req.get("cost") or 0
        if cost < 0:
            return {"success": False, "errors": {"cost": ["Cost must be a positive number"]}}, 400
        hint = ChallengeBankHints(
            challenge_bank_id=bank_id,
            type=req.get("type", "standard"),
            content=req.get("content"),
            cost=cost,
            requirements=req.get("requirements"),
        )
        db.session.add(hint)
        db.session.commit()
        return {
            "success": True,
            "data": {"id": hint.id, "type": hint.type, "content": hint.content, "cost": hint.cost, "requirements": hint.requirements},
        }


@challenge_bank_namespace.route("/<int:bank_id>/hints/<int:hint_id>")
class ChallengeBankHintDetail(Resource):
    @admins_only
    def delete(self, bank_id, hint_id):
        hint = ChallengeBankHints.query.filter_by(id=hint_id, challenge_bank_id=bank_id).first_or_404()
        db.session.delete(hint)
        db.session.commit()
        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/tags")
class ChallengeBankTagList(Resource):
    @admins_only
    def get(self, bank_id):
        tags = ChallengeBankTags.query.filter_by(challenge_bank_id=bank_id).all()
        return {"success": True, "data": [{"id": t.id, "value": t.value} for t in tags]}

    @admins_only
    def post(self, bank_id):
        ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        req = request.get_json(force=True, silent=True) or {}
        value = (req.get("value") or "").strip()
        if not value:
            return {"success": False, "errors": {"value": ["Required"]}}, 400
        tag = ChallengeBankTags(challenge_bank_id=bank_id, value=value)
        db.session.add(tag)
        db.session.commit()
        return {"success": True, "data": {"id": tag.id, "value": tag.value}}


@challenge_bank_namespace.route("/<int:bank_id>/tags/<int:tag_id>")
class ChallengeBankTagDetail(Resource):
    @admins_only
    def delete(self, bank_id, tag_id):
        tag = ChallengeBankTags.query.filter_by(id=tag_id, challenge_bank_id=bank_id).first_or_404()
        db.session.delete(tag)
        db.session.commit()
        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/topics")
class ChallengeBankTopicList(Resource):
    @admins_only
    def get(self, bank_id):
        links = ChallengeBankTopics.query.filter_by(challenge_bank_id=bank_id).all()
        return {
            "success": True,
            "data": [{"id": t.id, "topic_id": t.topic_id, "value": t.topic.value if t.topic else None} for t in links],
        }

    @admins_only
    def post(self, bank_id):
        ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        req = request.get_json(force=True, silent=True) or {}
        value = (req.get("value") or "").strip()
        topic_id = req.get("topic_id")

        if value:
            topic = Topics.query.filter_by(value=value).first()
            if topic is None:
                topic = Topics(value=value)
                db.session.add(topic)
                db.session.flush()
        elif topic_id:
            topic = Topics.query.filter_by(id=topic_id).first_or_404()
        else:
            return {"success": False, "errors": {"value": ["Required"]}}, 400

        link = ChallengeBankTopics(challenge_bank_id=bank_id, topic_id=topic.id)
        db.session.add(link)
        db.session.commit()
        return {"success": True, "data": {"id": link.id, "topic_id": topic.id, "value": topic.value}}


@challenge_bank_namespace.route("/<int:bank_id>/topics/<int:link_id>")
class ChallengeBankTopicDetail(Resource):
    @admins_only
    def delete(self, bank_id, link_id):
        link = ChallengeBankTopics.query.filter_by(id=link_id, challenge_bank_id=bank_id).first_or_404()
        db.session.delete(link)
        db.session.commit()
        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/files")
class ChallengeBankFileList(Resource):
    @admins_only
    def get(self, bank_id):
        files = ChallengeBankFiles.query.filter_by(challenge_bank_id=bank_id).all()
        return {"success": True, "data": [{"id": f.id, "location": f.location} for f in files]}

    @admins_only
    def post(self, bank_id):
        ChallengeBank.query.filter_by(id=bank_id).first_or_404()
        if "file" not in request.files:
            return {"success": False, "errors": {"file": ["Required"]}}, 400
        file_obj = request.files["file"]
        file_row = upload_file(file=file_obj, type="challenge_bank", challenge_bank_id=bank_id)
        return {"success": True, "data": {"id": file_row.id, "location": file_row.location}}


@challenge_bank_namespace.route("/<int:bank_id>/files/<int:file_id>")
class ChallengeBankFileDetail(Resource):
    @admins_only
    def delete(self, bank_id, file_id):
        f = ChallengeBankFiles.query.filter_by(id=file_id, challenge_bank_id=bank_id).first_or_404()
        uploader = get_uploader()
        uploader.delete(filename=f.location)
        db.session.delete(f)
        db.session.commit()
        return {"success": True}


@challenge_bank_namespace.route("/<int:bank_id>/clone")
class ChallengeBankClone(Resource):
    @admins_only
    def post(self, bank_id):
        """Clone a bank challenge into a contest as an ordinary `challenges`
        row. Everything downstream (scoreboard, statistics, rewards,
        decorators, the C# deploy service, ContestantPortal) treats the
        result exactly like a hand-created challenge — this endpoint is the
        only place that knows the Challenge Bank exists."""
        bank = ChallengeBank.query.filter_by(id=bank_id).first_or_404()

        req = request.get_json(force=True, silent=True) or {}
        contest_id = req.get("contest_id")
        if not contest_id:
            return {"success": False, "errors": {"contest_id": ["Required"]}}, 400

        contest = Contests.query.filter_by(id=contest_id).first()
        if not contest:
            return {"success": False, "errors": {"contest_id": ["Contest not found"]}}, 404

        if not can_write_challenges_for_contest(contest_id):
            return {
                "success": False,
                "errors": {"contest_id": ["You do not have permission to add challenges to this contest"]},
            }, 403

        # v1 only clones challenges whose behavior is fully described by the
        # base `challenges` row (the "standard" type). A type registered with
        # extra columns on its own subtype table (e.g. "dynamic") would need
        # that subtype row created too, which the bank schema does not carry
        # data for yet — reject explicitly rather than produce a half-built
        # challenge that 500s the first time its plugin_class is touched.
        if bank.type not in (None, "standard"):
            return {
                "success": False,
                "errors": {"type": [f'Cloning "{bank.type}" challenges from the bank is not supported yet']},
            }, 400

        new_challenge = Challenges(
            name=bank.name,
            description=bank.description,
            category=bank.category,
            type=bank.type or "standard",
            difficulty=bank.difficulty,
            require_deploy=bank.require_deploy,
            deploy_status=bank.deploy_status,
            deploy_file=bank.deploy_file,
            image_link=bank.image_link,
            connection_info=bank.connection_info,
            connection_protocol=bank.connection_protocol,
            cpu_limit=bank.cpu_limit,
            cpu_request=bank.cpu_request,
            memory_limit=bank.memory_limit,
            memory_request=bank.memory_request,
            use_gvisor=bank.use_gvisor,
            harden_container=bank.harden_container,
            shared_instant=bank.shared_instant,
            max_deploy_count=bank.max_deploy_count,
            contest_id=contest_id,
            value=req.get("value"),
            state=req.get("state", "hidden"),
            max_attempts=req.get("max_attempts"),
            cooldown=req.get("cooldown"),
            time_limit=req.get("time_limit"),
            source_bank_id=bank.id,
            created_by=session.get("id"),
            last_update=datetime.datetime.utcnow(),
        )
        db.session.add(new_challenge)
        db.session.flush()  # assign new_challenge.id without committing yet

        for f in ChallengeBankFlags.query.filter_by(challenge_bank_id=bank.id).all():
            db.session.add(Flags(challenge_id=new_challenge.id, type=f.type, content=f.content, data=f.data))

        for h in ChallengeBankHints.query.filter_by(challenge_bank_id=bank.id).all():
            db.session.add(
                Hints(
                    challenge_id=new_challenge.id,
                    type=h.type,
                    content=h.content,
                    cost=h.cost,
                    requirements=h.requirements,
                )
            )

        for t in ChallengeBankTags.query.filter_by(challenge_bank_id=bank.id).all():
            db.session.add(Tags(challenge_id=new_challenge.id, value=t.value))

        for bt in ChallengeBankTopics.query.filter_by(challenge_bank_id=bank.id).all():
            db.session.add(ChallengeTopics(challenge_id=new_challenge.id, topic_id=bt.topic_id))

        # Files are physically duplicated (not shared by reference) so that
        # deleting the contest's clone, or the bank original, never risks the
        # other's attachment on disk/S3. Goes through the uploader directly
        # (not the upload_file() helper, which expects a Werkzeug FileStorage
        # with a .filename attribute — a plain reopened handle has none).
        uploader = get_uploader()
        for bf in ChallengeBankFiles.query.filter_by(challenge_bank_id=bank.id).all():
            try:
                filename = bf.location.split("/")[-1]
                with uploader.open(bf.location) as fp:
                    sha1sum = hash_file(fp=fp)
                    new_location = uploader.upload(file_obj=fp, filename=filename)
                db.session.add(
                    ChallengeFiles(
                        type="challenge",
                        location=new_location,
                        sha1sum=sha1sum,
                        challenge_id=new_challenge.id,
                    )
                )
            except Exception:
                # A missing/unreadable source file should not block the clone
                # of the rest of the challenge (flags/hints/scoring still work
                # without it) — the admin can re-upload it on the clone directly.
                continue

        try:
            db.session.commit()
        except (IntegrityError, OperationalError) as e:
            db.session.rollback()
            return {"success": False, "errors": {"database": [str(e)]}}, 400

        log_action(
            CREATE_CHALLENGE,
            f'Cloned "{new_challenge.name}" from the Challenge Bank',
            challenge_id=new_challenge.id,
            contest_id=contest_id,
            after={"challenge_id": new_challenge.id, "name": new_challenge.name, "source_bank_id": bank.id},
        )

        return {"success": True, "data": {"id": new_challenge.id, "contest_id": contest_id}}, 200
