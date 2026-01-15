# syntax=docker/dockerfile:1

# --- Build stage -----------------------------------------------------------
FROM golang:1.22-alpine AS builder
WORKDIR /src

RUN apk add --no-cache build-base git

# Copy go.mod first to leverage Docker layer caching
COPY go.mod ./
RUN go mod download

# Copy the remaining source and build the static binary
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -o /out/challenge-gateway ./

# --- Runtime stage ---------------------------------------------------------
FROM alpine:3.20
RUN apk add --no-cache ca-certificates netcat-openbsd \
	&& addgroup -S app && adduser -S app -G app
WORKDIR /app

# Bring over the compiled binary (and optional env template for reference)
COPY --from=builder /out/challenge-gateway ./challenge-gateway
COPY .env.example ./

USER app
EXPOSE 1337
ENV LISTEN_PORT=:1337

HEALTHCHECK --interval=30s --timeout=3s --retries=3 CMD nc -z localhost 1337 || exit 1

CMD ["./challenge-gateway"]
