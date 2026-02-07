# case.ly

AI-powered interview coaching platform. A 3D avatar conducts mock interviews using real-time voice — your mic audio is streamed via WebRTC to a Node.js backend that runs speech-to-text (Whisper), generates responses (GPT-4o-mini), and speaks back via text-to-speech, all while driving lip-sync visemes on the avatar.

## Prerequisites

- **Node.js** >= 18 (tested on v25)
- **npm** (comes with Node)
- An **OpenAI API key** (optional for basic testing — the backend falls back to a test mode without one, but STT/LLM/TTS won't work)

## Project structure

```
case.ly/
  frontend/   # Next.js app — 3D avatar + WebRTC client
  backend/    # Express + WebSocket signaling + WebRTC server
```

## Setup

### 1. Backend

```bash
cd backend
npm install
```

Create a `.env` file in `backend/`:

```
OPENAI_API_KEY=sk-your-key-here
```

If you skip this, the backend will still start but will use placeholder responses instead of real STT/LLM/TTS.

Start the server:

```bash
npm run dev
```

This runs on **http://localhost:3001** (WebSocket at `ws://localhost:3001/ws`). You can change the port with the `PORT` env var.

### 2. Frontend

```bash
cd frontend
npm install
npm run dev
```

This runs on **http://localhost:3000** by default (Next.js dev server).

## Usage

1. Open **http://localhost:3000/interview** in your browser
2. Click **Start interview** — your browser will ask for microphone permission
3. Speak naturally — after 3 seconds of speech followed by 3 seconds of silence, the backend will:
   - Transcribe your speech (Whisper)
   - Generate a coaching response (GPT-4o-mini)
   - Speak it back (TTS) while the avatar lip-syncs
4. The cycle repeats — speak again after the avatar finishes
5. Click **Disconnect** to end the session
6. Click **Download recording** to save a `.webm` file of your mic audio

## Environment variables

| Variable | Where | Required | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | `backend/.env` | No (but needed for real AI) | OpenAI API key for Whisper, GPT-4o-mini, and TTS |
| `PORT` | `backend/.env` | No | Backend port (default: `3001`) |

## Scripts

### Backend (`backend/`)

| Command | Description |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart on changes) |
| `npm start` | Start without auto-restart |
| `npm run run` | Install deps + start |

### Frontend (`frontend/`)

| Command | Description |
|---|---|
| `npm run dev` | Next.js dev server with hot reload |
| `npm run build` | Production build |
| `npm start` | Serve production build |
| `npm run lint` | Run ESLint |

## Troubleshooting

- **Backend `npm install` fails on `wrtc`** — This project uses `@roamhq/wrtc` (a maintained fork). If you see errors about the original `wrtc` package, make sure `package.json` lists `@roamhq/wrtc`, not `wrtc`.
- **No audio response from avatar** — Check that `OPENAI_API_KEY` is set in `backend/.env`. Without it the backend runs in test mode (visemes only, no audio).
- **WebSocket connection refused** — Make sure the backend is running on port 3001 before opening the frontend.
- **Microphone not working** — Ensure you're accessing the frontend over `localhost` (not a raw IP), as browsers require a secure context for `getUserMedia`.
