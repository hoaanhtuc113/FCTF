"""Response policy for the management application, including plugin routes."""
import os
import re
import secrets

from flask import g, request, session
from jinja2.ext import Extension


def csp_nonce():
    if not getattr(g, "csp_nonce", None):
        g.csp_nonce = secrets.token_urlsafe(24)
    return g.csp_nonce


class ScriptNonceExtension(Extension):
    def preprocess(self, source, name, filename=None):
        # Add nonces only to script tags authored in templates, never to HTML
        # supplied by a user and inserted while rendering.
        return re.sub(r"<script\b(?![^>]*\bnonce\s*=)",
                      '<script nonce="{{ csp_nonce() }}"', source, flags=re.IGNORECASE)


def init_response_security(app):
    app.jinja_env.add_extension(ScriptNonceExtension)
    app.jinja_env.globals["csp_nonce"] = csp_nonce
    origins = app.config.get("CORS_ALLOWED_ORIGINS", os.environ.get("CORS_ALLOWED_ORIGINS", ""))
    origins = origins.split(",") if isinstance(origins, str) else origins
    origins = {origin.strip().rstrip("/") for origin in origins if origin.strip()}
    if "*" in origins:
        raise ValueError("CORS_ALLOWED_ORIGINS must contain explicit origins")

    @app.before_request
    def fresh_nonce():
        g.csp_nonce = secrets.token_urlsafe(24)
        # Trusted AJAX templates must use the embedding page's nonce. Never
        # accept a nonce from a URL or an unprotected cross-origin request.
        supplied = request.headers.get("CSP-Nonce", "")
        csrf = request.headers.get("CSRF-Token", "")
        expected = session.get("nonce")
        if (re.fullmatch(r"[A-Za-z0-9_-]{32}", supplied) and
                isinstance(expected, str) and expected and csrf and
                secrets.compare_digest(expected, csrf)):
            g.csp_nonce = supplied

    @app.after_request
    def secure_response(response):
        nonce = csp_nonce()
        # Vue's existing template compiler needs unsafe-eval; existing inline
        # event attributes remain supported. Inline script blocks require nonce.
        policy = (
            "default-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'; "
            "form-action 'self'; "
            "script-src 'self' 'nonce-" + nonce + "' 'unsafe-eval' https://cdn.jsdelivr.net "
            "https://cdnjs.cloudflare.com https://code.jquery.com https://stackpath.bootstrapcdn.com "
            "https://ajax.googleapis.com; "
            "script-src-attr 'unsafe-inline'; style-src 'self' 'unsafe-inline' https:; "
            "img-src 'self' data: blob: https:; font-src 'self' data: https:; "
            "connect-src 'self' https: wss:; frame-src 'self' https: blob:; worker-src 'self' blob:"
        )
        response.headers["Content-Security-Policy"] = app.config.get("CONTENT_SECURITY_POLICY", policy)
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if request.path.startswith(("/admin", "/api", "/login", "/reset_password", "/logout")):
            response.headers["Cache-Control"] = "no-store, private, max-age=0"
            response.headers["Pragma"] = "no-cache"
            response.headers["Expires"] = "0"
        origin = request.headers.get("Origin")
        if origins:
            response.vary.add("Origin")
        if origin in origins:
            response.headers["Access-Control-Allow-Origin"] = origin
            response.vary.add("Origin")
            if request.method == "OPTIONS":
                response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, PATCH, DELETE, OPTIONS"
                response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, CSRF-Token"
        return response
