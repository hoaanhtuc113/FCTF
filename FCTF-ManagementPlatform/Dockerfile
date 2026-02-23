##############################
# Stage 1: Build frontend themes (admin + core-beta) with Node.js
##############################
FROM node:18-slim AS theme-build

# Build admin theme
WORKDIR /themes/admin
COPY CTFd/themes/admin/package.json CTFd/themes/admin/package-lock.json* CTFd/themes/admin/yarn.lock* ./
RUN npm install
COPY CTFd/themes/admin/ ./
COPY CTFd/themes/core/assets/ /themes/core/assets/
RUN npm run build

# Build core-beta theme
WORKDIR /themes/core-beta
COPY CTFd/themes/core-beta/package.json CTFd/themes/core-beta/package-lock.json* CTFd/themes/core-beta/yarn.lock* ./
RUN npm install
COPY CTFd/themes/core-beta/ ./
RUN npm run build \
    && if [ -f static/.vite/manifest.json ] && [ ! -f static/manifest.json ]; then \
    cp static/.vite/manifest.json static/manifest.json; \
    fi

##############################
# Stage 2: Install Python dependencies
##############################
FROM python:3.11-slim-bookworm AS build

WORKDIR /opt/CTFd

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    build-essential \
    libffi-dev \
    libssl-dev \
    git \
    gcc \
    g++ \
    python3-dev \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && python -m venv /opt/venv

ENV PATH="/opt/venv/bin:$PATH"

COPY . /opt/CTFd

RUN pip install --no-cache-dir -r requirements.txt \
    && for d in CTFd/plugins/*; do \
    if [ -f "$d/requirements.txt" ]; then \
    pip install --no-cache-dir -r "$d/requirements.txt";\
    fi; \
    done;

##############################
# Stage 3: Final release image
##############################
FROM python:3.11-slim-bookworm AS release
WORKDIR /opt/CTFd

# hadolint ignore=DL3008
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    libffi8 \
    libssl3 \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

COPY --chown=1001:1001 . /opt/CTFd

# Copy built theme assets from theme-build stage
COPY --chown=1001:1001 --from=theme-build /themes/admin/static /opt/CTFd/CTFd/themes/admin/static
COPY --chown=1001:1001 --from=theme-build /themes/core-beta/static /opt/CTFd/CTFd/themes/core-beta/static

RUN useradd \
    --no-log-init \
    --shell /bin/bash \
    -u 1001 \
    ctfd \
    && mkdir -p /var/log/CTFd /var/uploads \
    && mkdir -p /var/log/CTFd /var/template_challenge \
    && chown -R 1001:1001 /var/template_challenge /var/log/CTFd /var/uploads /opt/CTFd \
    && chmod +x /opt/CTFd/docker-entrypoint.sh 

COPY --chown=1001:1001 --from=build /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

USER 1001
EXPOSE 8000
ENTRYPOINT ["/opt/CTFd/docker-entrypoint.sh"]