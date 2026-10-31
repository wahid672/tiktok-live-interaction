#!/usr/bin/env bash
# ==============================================================================
# TikTok LIVE Interaction - All-In-One Launcher
# ==============================================================================

set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "=================================================="
echo "⚡ TikTok LIVE Interaction Suite"
echo "=================================================="

# 1. Check & Ensure Math Game Service
if systemctl is-active --quiet tiktok-math-game; then
    echo "✓ Math Game Engine is running on port 3000"
else
    echo "Starting Math Game Server..."
    (cd "$DIR/game" && npm start &) > /dev/null 2>&1 || true
fi

# 2. Virtual Audio Check
export PULSE_SERVER="unix:/run/user/1000/pulse/native"
export DISPLAY="${DISPLAY:-:1}"

# 3. Virtual Environment Python
VENV_PY="/data/workspace/venv/bin/python3"
if [ ! -f "$VENV_PY" ]; then
    echo "Virtualenv not found, using system python3..."
    VENV_PY="python3"
fi

echo "✓ Launching Web Dashboard on http://localhost:8080..."
exec "$VENV_PY" "$DIR/server.py"
