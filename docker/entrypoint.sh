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
    # curl_cffi enables yt-dlp's browser-impersonation mode, required by
    # some extractors (e.g. Dailymotion) to get past anti-bot checks. Pinned
    # below 0.16: yt-dlp's impersonation module only supports curl_cffi
    # 0.5.10 or 0.10.x-0.15.x, and silently reports every impersonate target
    # as unavailable (no error) against a newer/unsupported version.
    "$VENV_DIR/bin/pip" install --no-cache-dir "curl_cffi<0.16,>=0.10"
fi

exec /app/packrat
