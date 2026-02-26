#!/bin/bash

# Start Helix Router
# Usage: ./start.sh [--port PORT]

PORT="${1:-8403}"

echo "Starting Helix Router on port $PORT..."

# Kill any existing process on the port
lsof -ti :$PORT | xargs kill -9 2>/dev/null || true

# Start in background
cd "$(dirname "$0")"
nohup node helix-router.js > /tmp/helix-router.log 2>&1 &

# Wait for startup
sleep 2

# Check health
if curl -s "http://127.0.0.1:$PORT/health" | grep -q '"status":"ok"'; then
    echo "✓ Helix Router started successfully on port $PORT"
    echo ""
    echo "Endpoints:"
    echo "  • http://127.0.0.1:$PORT/v1/chat/completions"
    echo "  • http://127.0.0.1:$PORT/v1/models"
    echo "  • http://127.0.0.1:$PORT/stats"
    echo ""
    echo "View logs: tail -f /tmp/helix-router.log"
else
    echo "✗ Failed to start Helix Router"
    tail -f /tmp/helix-router.log
    exit 1
fi