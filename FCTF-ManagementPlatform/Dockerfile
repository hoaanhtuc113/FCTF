##############################
# Stage 1: Build frontend themes (admin + core-beta)
##############################
FROM node:18-slim AS theme-build

# Build admin theme with lockfile-based install for deterministic/cached CI builds.
WORKDIR /themes/admin
COPY CTFd/themes/admin/package.json CTFd/themes/admin/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY CTFd/themes/admin/ ./
RUN npm run build

# Build core-beta theme.
WORKDIR /themes/core-beta
COPY CTFd/themes/core-beta/package.json CTFd/themes/core-beta/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY CTFd/themes/core-beta/ ./
RUN npm run build \
    && if [ -f static/.vite/manifest.json ] && [ ! -f static/manifest.json ]; then \
    cp static/.vite/manifest.json static/manifest.json; \
    fi

##############################
# Stage 2: Build Python virtualenv + app
##############################
FROM python:3.11-slim-bookworm AS py-build

WORKDIR /opt/CTFd

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PATH="/opt/venv/bin:$PATH"

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    gcc \
    g++ \
    libffi-dev \
    libssl-dev \
    python3-dev \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv

# Install base Python dependencies in a cache-friendly layer.
COPY requirements.txt ./
RUN pip install --default-timeout=1000 --no-cache-dir --prefer-binary -r requirements.txt

# Install plugin dependencies (if present).
COPY CTFd/plugins ./CTFd/plugins
RUN set -eux; \
    if [ -d CTFd/plugins ]; then \
      find CTFd/plugins -mindepth 2 -maxdepth 2 -name requirements.txt -print0 \
      | xargs -0 -r -I {} pip install --default-timeout=1000 --no-cache-dir --prefer-binary -r {}; \
    fi

# Copy application source after dependency install to preserve cache reuse.
COPY . .

##############################
# Stage 3: Runtime image
##############################
FROM python:3.11-slim-bookworm AS release
WORKDIR /opt/CTFd

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH"

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    libffi8 \
    libssl3 \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --gid 1001 ctfd \
    && useradd --uid 1001 --gid 1001 --create-home --no-log-init --shell /usr/sbin/nologin ctfd \
    && mkdir -p /var/log/CTFd /var/uploads /var/template_challenge

COPY --from=py-build /opt/venv /opt/venv
COPY --chown=1001:1001 --from=py-build /opt/CTFd /opt/CTFd

# Replace theme static assets with outputs from the frontend build stage.
COPY --chown=1001:1001 --from=theme-build /themes/admin/static /opt/CTFd/CTFd/themes/admin/static
COPY --chown=1001:1001 --from=theme-build /themes/core-beta/static /opt/CTFd/CTFd/themes/core-beta/static

RUN chmod +x /opt/CTFd/docker-entrypoint.sh \
    && chown -R 1001:1001 /opt/CTFd /var/log/CTFd /var/uploads /var/template_challenge

USER 1001:1001
EXPOSE 8000
ENTRYPOINT ["/opt/CTFd/docker-entrypoint.sh"]