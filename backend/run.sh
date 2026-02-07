#!/usr/bin/env bash
# Run the interview backend. Uses PORT=3001 by default.
# Optional: OPENAI_API_KEY for real STT/LLM/TTS.

set -e
cd "$(dirname "$0")"

if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install
fi

PORT="${PORT:-3001}"
echo "Starting backend on http://localhost:$PORT (WebSocket: ws://localhost:$PORT/ws)"
exec node -r ./preload.cjs server.js
