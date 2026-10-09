"""Inspect and explicitly repair legacy discriminators without loading the ORM."""

import json

import click
from flask import current_app
from sqlalchemy import cast, select

from CTFd.cli import _cli
from CTFd.models import Challenges, Files, Flags, Users, db
from CTFd.utils.validators.model_types import missing_challenge_type_data, require_supported_type, supported_types

MODELS = {"users": Users, "challenges": Challenges, "flags": Flags, "files": Files}


def invalid_types():
    records = []
    for kind, model in MODELS.items():
        table = model.__table__
        rows = db.session.execute(select(table.c.id, cast(table.c.type, db.String))).all()
        for record_id, stored_type in rows:
            if stored_type not in supported_types(kind):
                records.append({"kind": kind, "id": record_id, "type": stored_type})
            elif kind == "challenges" and missing_challenge_type_data(stored_type, record_id):
                records.append({"kind": kind, "id": record_id, "type": stored_type, "reason": "missing_type_data"})
    return records


def repair_type(kind, record_id, target_type, apply=False):
    require_supported_type(kind, target_type)
    model = MODELS[kind]
    table = model.__table__
    row = db.session.execute(
        select(table, cast(table.c.type, db.String).label("stored_type"))
        .where(table.c.id == record_id)
    ).mappings().first()
    if row is None:
        raise ValueError("Record not found")
    if row["stored_type"] in supported_types(kind) and not (
        kind == "challenges" and missing_challenge_type_data(row["stored_type"], record_id)
    ):
        raise ValueError("Record already has a supported type")

    if kind == "files" and target_type == "challenge":
        if row.get("challenge_id") is None or db.session.execute(
            select(Challenges.id).where(Challenges.id == row["challenge_id"])
        ).first() is None:
            raise ValueError("A challenge file must reference an existing challenge")

    child_tables = []
    if kind == "challenges":
        from CTFd.plugins.challenges import CHALLENGE_CLASSES

        target_table = CHALLENGE_CLASSES[target_type].challenge_model.__table__
        if target_table is not table and db.session.execute(
            select(target_table.c.id).where(target_table.c.id == record_id)
        ).first() is None:
            raise ValueError("Missing data for this challenge type; restore the child record first")
        child_tables = {
            mapper.local_table for mapper in Challenges.__mapper__.self_and_descendants
            if mapper.local_table is not table and mapper.local_table is not target_table
        }

    result = {"kind": kind, "id": record_id, "from": row["stored_type"], "to": target_type, "applied": apply}
    if not apply:
        return result

    try:
        for child_table in child_tables:
            db.session.execute(child_table.delete().where(child_table.c.id == record_id))
        db.session.execute(table.update().where(table.c.id == record_id).values(type=target_type))
        if kind == "users":
            from CTFd.utils.security.auth import revoke_user_tokens

            revoke_user_tokens([record_id])
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    db.session.expire_all()
    from CTFd.cache import clear_auth_cache, clear_challenges, clear_standings, clear_user_session

    if kind == "users":
        clear_auth_cache(user_id=record_id)
        clear_user_session(user_id=record_id)
    clear_challenges()
    clear_standings()
    current_app.logger.warning("Repaired model type: %s", result)
    return result


@_cli.cli.command("audit-types")
def audit_types():
    """List unsupported types; never change database rows."""
    click.echo(json.dumps(invalid_types(), ensure_ascii=False, indent=2))


@_cli.cli.command("repair-type")
@click.argument("kind", type=click.Choice(tuple(MODELS)))
@click.argument("record_id", type=int)
@click.argument("target_type")
@click.option("--apply", is_flag=True, help="Commit the repair; otherwise preview only.")
def repair_type_command(kind, record_id, target_type, apply):
    """Repair one unsupported type using an explicitly selected target."""
    try:
        result = repair_type(kind, record_id, target_type, apply=apply)
    except ValueError as error:
        db.session.rollback()
        raise click.ClickException(str(error))
    click.echo(json.dumps(result, ensure_ascii=False))
