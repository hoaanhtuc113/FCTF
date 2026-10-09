"""Shared, atomic login budgets by client IP and normalized account identifier."""
import functools
import hashlib
import threading
import time

from flask import current_app, jsonify, request
from sqlalchemy import func, or_

from CTFd.cache import cache
from CTFd.models import Users
from CTFd.utils.user import get_ip


LOGIN_COUNTER_SCRIPT = """
local count = redis.call('INCR', KEYS[1])
if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
if ttl < 0 then
    redis.call('EXPIRE', KEYS[1], ARGV[1])
    ttl = tonumber(ARGV[1])
end
return {count, ttl}
"""
_local_lock = threading.Lock()


def consume_login_budget(identity, window=300):
    key = "fctf:management:security:login:" + hashlib.sha256(identity.encode()).hexdigest()
    backend = cache.cache
    redis = getattr(backend, "_write_client", None)
    if redis is not None:
        count, ttl = redis.eval(LOGIN_COUNTER_SCRIPT, 1, key, window)
        return int(count), max(1, int(ttl))
    # Development/test SimpleCache. Shared Redis is required for multiple workers.
    if type(backend).__name__ != "SimpleCache":
        raise RuntimeError("Login limiting requires Redis or SimpleCache")
    with _local_lock:
        now = time.time()
        entry = cache.get(key)
        count, expires = entry if entry and entry[1] > now else (0, now + window)
        count += 1
        ttl = max(1, int(expires - now + 0.999))
        cache.set(key, (count, expires), timeout=ttl)
        return count, ttl


def limit_login(f):
    @functools.wraps(f)
    def wrapped(*args, **kwargs):
        if request.method != "POST":
            return f(*args, **kwargs)
        name = request.form.get("name", "").strip().lower()
        try:
            def check(identity, limit):
                count, retry = consume_login_budget(identity)
                if count > limit:
                    response = jsonify(code=429, message="Too many login attempts. Try again later.")
                    response.status_code = 429
                    response.headers["Retry-After"] = str(retry)
                    return response
                return None

            blocked = check("ip:" + get_ip(), 20)
            if blocked is not None:
                return blocked
            if name:
                # Username and email aliases consume the same account budget.
                user = Users.query.filter(or_(func.lower(Users.name) == name,
                                              func.lower(Users.email) == name)).first()
                identity = "user:" + str(user.id) if user else "account:" + name
                blocked = check(identity, 5)
                if blocked is not None:
                    return blocked
        except Exception:
            current_app.logger.exception("Login rate limiter unavailable")
            response = jsonify(code=503, message="Login temporarily unavailable. Try again later.")
            response.status_code = 503
            return response
        return f(*args, **kwargs)
    return wrapped
