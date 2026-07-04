# syntax=docker/dockerfile:1

# ---- Stage 1: frontend build ----
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: backend build ----
FROM golang:1-alpine AS backend-builder
WORKDIR /app/backend
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
# CGO_ENABLED=0 works because modernc.org/sqlite is pure Go — no C toolchain
# needed in this stage, and the resulting binary is statically linked.
RUN CGO_ENABLED=0 GOOS=linux go build -o /packrat ./cmd/server

# ---- Stage 3: runtime ----
FROM python:3.12-alpine AS runtime
RUN apk add --no-cache ffmpeg ca-certificates tzdata wget \
    && pip install --no-cache-dir --break-system-packages yt-dlp

RUN addgroup -S packrat && adduser -S packrat -G packrat

WORKDIR /app
COPY --from=backend-builder /packrat /app/packrat
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist
COPY database/migrations /app/database/migrations

RUN mkdir -p /app/data/db /app/data/media && chown -R packrat:packrat /app

USER packrat

ENV PORT=8080 \
    DB_PATH=/app/data/db/packrat.db \
    MEDIA_ROOT=/app/data/media \
    MAX_CONCURRENT_DOWNLOADS=2 \
    YTDLP_PATH=yt-dlp \
    FFMPEG_PATH=ffmpeg \
    MIGRATIONS_DIR=/app/database/migrations \
    STATIC_DIR=/app/frontend/dist

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:8080/api/health || exit 1

ENTRYPOINT ["/app/packrat"]
