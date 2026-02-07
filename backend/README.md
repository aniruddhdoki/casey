# Interview backend

WebRTC + WebSocket signaling server. Receives client microphone over WebRTC, runs STT → LLM → TTS, and streams audio + visemes back over a DataChannel.

## Run

From the repo root or from `backend/`:

```bash
cd backend
npm install          # first time (or use npm run run)
npm run dev          # start server
# or
npm start
# or install + start in one go:
npm run run
```

Or use the shell script:

```bash
cd backend
./run.sh
```

**Environment:**

- `PORT` – port to listen on (default: 3001)
- `AWS_REGION` – AWS region (default: us-east-1)
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` – for local dev; or use `AWS_PROFILE` / IAM role

Without AWS credentials, the backend sends only a viseme test (no audio). Use Terraform to provision IAM policy:

```bash
cd ../terraform
terraform init && terraform plan && terraform apply
# Use casey_localdev_service credentials (or a profile that uses them), then set AWS_REGION in .env
```

**WebRTC (wrtc):** The server requires the `wrtc` package. The backend lists `node-pre-gyp` as a dependency so that `wrtc`’s install script can find it; if you previously saw `node-pre-gyp: command not found`, run `npm install` again. On startup you should see `[Backend] WebRTC (wrtc) loaded successfully` before the HTTP server message. If you see "WebRTC not available" in the frontend, the backend process is likely an old one—stop it and start again with `npm run dev` from the `backend` folder. If the backend exits immediately with "Failed to load WebRTC", install build tools and run `npm install wrtc` again; see [node-webrtc](https://github.com/node-webrtc/node-webrtc) for details.

**VAD & multi-turn:** The agent runs after **3 seconds of continuous silence**. Once it finishes sending audio back, it resets and listens again. Loop: you speak → 3s silence → agent responds with audio → you speak again → 3s silence → agent responds again, and so on.

Server listens on **http://localhost:3001**. WebSocket path: **ws://localhost:3001/ws**.

## Flow

1. Client connects via WebSocket and sends an SDP offer (with mic track + DataChannel).
2. Server creates an answer and exchanges ICE candidates.
3. Server receives the client’s audio track (and optionally uses it for STT).
4. When the DataChannel opens, the server runs the agent: LLM → TTS → stream MP3 chunks + viseme JSON over the DataChannel.
5. Client buffers chunks and visemes; on stream end it plays the combined audio and drives the avatar with the visemes.
