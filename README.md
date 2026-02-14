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
| `NEXT_PUBLIC_WS_URL` | Frontend build env | No | WebSocket URL for signaling in production (for example `wss://api.casey.com/ws`). If omitted in development, frontend defaults to `ws://localhost:3001/ws`. |

### Production frontend wiring

When deploying the frontend (for example on Vercel), set `NEXT_PUBLIC_WS_URL` to your deployed backend WebSocket endpoint and redeploy the frontend build. Example:

```bash
NEXT_PUBLIC_WS_URL=wss://api.casey.com/ws
```

The interview page will then connect to the production backend instead of assuming same-origin `/ws`.

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

## Deployment

### Backend to AWS ECS

Deploy the backend to AWS ECS Fargate using the provided deployment script:

```bash
# Full deployment (Terraform + Docker + ECS)
./deploy.sh

# Skip Terraform if infrastructure already exists
./deploy.sh --skip-terraform

# Use a specific image tag
./deploy.sh --image-tag v1.0.0

# Auto-approve Terraform (no confirmation)
./deploy.sh --auto-approve
```

The script will:
1. Apply Terraform infrastructure (ECR, ECS; ALB only if enabled)
2. Build and push Docker image to ECR
3. Update ECS service with new image
4. Wait for deployment to stabilize
5. Output backend endpoints (or run `./scripts/get-backend-url.sh` when ALB is disabled)

**ALB vs direct task access:** By default Terraform does not create an ALB (`enable_alb=false`), so the backend is reached via the ECS task public IP. After deploy, run `./scripts/get-backend-url.sh` to get the current task IP and set `NEXT_PUBLIC_WS_URL=ws://<IP>:3001/ws`. When your AWS account supports load balancers, set `enable_alb=true` (e.g. in `terraform/variables.tf` or `-var="enable_alb=true"`) and redeploy to use a stable ALB URL.

**Prerequisites:**
- AWS CLI configured with admin credentials
- Terraform installed
- Docker installed
- AWS credentials with permissions to create ECR, ECS, IAM resources (and ALB when enable_alb=true)

See `terraform/README.md` for detailed infrastructure setup and configuration options.

### Quick backend update (infrastructure already exists)

```bash
# Update backend container only
./scripts/deploy-backend.sh [image-tag]
```

## Troubleshooting

- **Backend `npm install` fails on `wrtc`** — This project uses `@roamhq/wrtc` (a maintained fork). If you see errors about the original `wrtc` package, make sure `package.json` lists `@roamhq/wrtc`, not `wrtc`.
- **No audio response from avatar** — Check that `OPENAI_API_KEY` is set in `backend/.env`. Without it the backend runs in test mode (visemes only, no audio).
- **WebSocket connection refused** — Make sure the backend is running on port 3001 before opening the frontend.
- **Microphone not working** — Ensure you're accessing the frontend over `localhost` (not a raw IP), as browsers require a secure context for `getUserMedia`.
