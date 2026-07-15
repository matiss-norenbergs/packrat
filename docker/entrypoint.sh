#!/bin/sh
set -e

# yt-dlp lives in a venv under the volume-mounted data dir (not baked into
# the image) so that "Update yt-dlp" in Settings, and the version it lands
# on, both survive container recreation instead of reverting to whatever was
# installed at image build time. Bootstrap it on first run only — a later
# restart with the same volume just reuses what's already there.
VENV_DIR="/app/data/ytdlp-venv"

if [ ! -x "$VENV_DIR/bin/yt-dlp" ]; then
    echo "entrypoint: no yt-dlp found in $VENV_DIR, installing..."
    python3 -m venv "$VENV_DIR"
    "$VENV_DIR/bin/pip" install --no-cache-dir --upgrade pip yt-dlp
fi

exec /app/packrat
