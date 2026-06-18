import os
os.environ.setdefault('REDIS_TLS', 'false')
os.environ.setdefault('REDIS_HOST', 'localhost')
os.environ.setdefault('REDIS_PORT', '6379')
os.environ.setdefault('REDIS_PASS', 'redis_password')
os.environ.setdefault('REDIS_URL', 'redis://:redis_password@localhost:6379')

from CTFd import create_app
app = create_app()

with app.app_context():
    from CTFd.models import KypoChallengeConfig, KypoTeamAccount, Teams, Solves, db
    from CTFd.utils.kypo_poller import (
        _get_admin_token, _service_base, _fetch_progress,
        _calc_status_and_score, _get_level_score, _clear_scoreboard_cache
    )

    # ── Build username → team_id map ─────────────────────────────────────────
    accounts = KypoTeamAccount.query.all()
    username_to_team = {}
    print("=== Username mapping ===")
    for acc in accounts:
        team = Teams.query.get(acc.team_id)
        username_to_team[acc.kypo_username] = acc.team_id
        if team:
            display = f"{team.name} FCTF Team"
            username_to_team[display] = acc.team_id
            print(f"  '{acc.kypo_username}' → {acc.team_id}")
            print(f"  '{display}' → {acc.team_id}")
    print()

    # ── Lấy token ────────────────────────────────────────────────────────────
    try:
        token = _get_admin_token()
        print("✅ Token OK")
    except Exception as e:
        print(f"❌ Token failed: {e}")
        exit(1)

    # ── Check từng instance ──────────────────────────────────────────────────
    configs = KypoChallengeConfig.query.all()
    # Chỉ kiểm tra instance 36 (challenge AAAA)
    instance_36_configs = [c for c in configs if c.kypo_instance_id == 36]

    for cfg in instance_36_configs:
        print(f"\n=== Instance 36 / Challenge {cfg.challenge_id} ===")

        # Đếm unsolved
        all_team_ids = list(set(username_to_team.values()))
        solved = {s.team_id for s in Solves.query.filter(
            Solves.challenge_id == cfg.challenge_id,
            Solves.team_id.in_(all_team_ids)
        ).all()}
        unsolved_ids = set(all_team_ids) - solved
        print(f"  All teams: {sorted(all_team_ids)}")
        print(f"  Already solved: {sorted(solved)}")
        print(f"  Unsolved: {sorted(unsolved_ids)}")

        if not unsolved_ids:
            print("  ⚠️  Tất cả đã solve → SKIP")
            continue

        # Fetch KYPO progress
        try:
            base = _service_base(cfg.kypo_instance_type or "linear")
            data = _fetch_progress(token, base, cfg.kypo_instance_id)
        except Exception as e:
            print(f"  ❌ Fetch failed: {e}")
            continue

        participants = data.get("progress", [])
        print(f"  KYPO trả về {len(participants)} participant(s)")

        for p in participants:
            name = p.get("name", "")
            levels = p.get("levels", [])
            team_id = username_to_team.get(name)
            status, score = _calc_status_and_score(levels)

            print(f"\n  Participant: '{name}'")
            print(f"    → team_id: {team_id}")
            print(f"    → status: {status}, score: {score}")
            for lv in levels:
                lv_score = _get_level_score(lv)
                print(f"    Level {lv['id']}: state={lv.get('state')} score={lv_score}")

            if team_id is None:
                print(f"    ❌ Không map được username!")
                continue
            if score == 0:
                print(f"    ⚠️  Score = 0, không ghi Solve")
                continue
            print(f"    ✅ Sẽ ghi Solve: challenge={cfg.challenge_id} team={team_id} score={score}")

    print("\n=== Chạy _run_poll_cycle để ghi DB ===")
    from CTFd.utils.kypo_poller import _run_poll_cycle
    _run_poll_cycle(app)
    print("Done!")

    print("\n=== Solves sau poll (challenge 11) ===")
    db.session.expire_all()
    for s in Solves.query.filter_by(challenge_id=11).all():
        t = Teams.query.get(s.team_id)
        print(f"  team={t.name if t else s.team_id}  value={s.value}")
