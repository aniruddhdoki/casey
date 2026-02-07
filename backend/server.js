/**
 * Interview backend: WebSocket signaling + WebRTC.
 * Receives client mic over WebRTC, runs STT -> LLM -> TTS, streams audio + visemes back over DataChannel.
 * WebRTC (@roamhq/wrtc) is required; the server will not start if it cannot load.
 */

import express from 'express';
import { WebSocketServer } from 'ws';
import { runAgent } from './agent.js';
import { createVAD } from './vad.js';
import { runSTT } from './stt.js';

let RTCPeerConnection, RTCSessionDescription, RTCIceCandidate, wrtcModule;
try {
  const imported = await import('@roamhq/wrtc');
  // ESM interop: CJS module may be under .default
  wrtcModule = imported.default ?? imported;
  RTCPeerConnection = wrtcModule.RTCPeerConnection;
  RTCSessionDescription = wrtcModule.RTCSessionDescription;
  RTCIceCandidate = wrtcModule.RTCIceCandidate;
  if (typeof RTCPeerConnection !== 'function') {
    throw new Error('@roamhq/wrtc did not export RTCPeerConnection correctly');
  }
} catch (e) {
  console.error('[Backend] Failed to load WebRTC (@roamhq/wrtc). This is required for the interview connection.');
  console.error('[Backend] Install with: npm install @roamhq/wrtc');
  console.error('[Backend] Error:', e.message);
  process.exit(1);
}
console.log('[Backend] WebRTC (@roamhq/wrtc) loaded successfully');

const app = express();
app.use(express.static('public'));
const PORT = process.env.PORT || 3001;

const server = app.listen(PORT, () => {
  console.log(`[Backend] HTTP server listening on ${PORT}`);
});

const wss = new WebSocketServer({ server, path: '/ws' });

// Viseme codes that match frontend Avatar's corresponding map
const VISEME_CODES = ['p', 't', 'S', 'i', 'u', 'a', '@', 'e', 'E', 'o'];

function randomViseme() {
  return VISEME_CODES[Math.floor(Math.random() * VISEME_CODES.length)];
}

function generateRandomVisemeSequence(durationMs, intervalMs = 80) {
  const out = [];
  for (let t = 0; t < durationMs; t += intervalMs) {
    out.push({ time: t, value: randomViseme() });
  }
  return out;
}

wss.on('connection', (ws, req) => {
  console.log('[Backend] --- Data intake: WebSocket connection opened ---');

  let pc = null;
  let dataChannel = null;
  let audioSink = null;
  let vadStarted = false;
  const conversationHistory = [];

  function getAgentOptions(userTranscript) {
    return {
      conversationHistory,
      userTranscript: userTranscript ?? '',
      sendAudioChunk(buf) {
        if (!dataChannel || dataChannel.readyState !== 'open') {
          console.log('[Backend] sendAudioChunk: skip (channel not open)');
          return;
        }
        const toSend = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
        console.log('[Backend] Sending audio chunk to client: size=', toSend.length, 'bytes');
        dataChannel.send(toSend);
      },
      sendViseme(timeMs, value) {
        if (dataChannel && dataChannel.readyState === 'open') {
          const payload = JSON.stringify({ type: 'viseme', time: timeMs, value });
          dataChannel.send(payload);
        }
      },
      sendEnd() {
        if (dataChannel && dataChannel.readyState === 'open') {
          dataChannel.send(JSON.stringify({ type: 'end' }));
        }
      },
      generateRandomVisemeSequence,
    };
  }

  function tryStartVAD() {
    if (vadStarted || !audioSink || !dataChannel || dataChannel.readyState !== 'open') return;
    vadStarted = true;
    console.log('[Backend] --- VAD: starting (wait for user to speak, then 3s silence) ---');
    const vad = createVAD(async (utteranceChunks, sampleRate) => {
      console.log('[Backend] VAD triggered — running STT on utterance...');
      let userTranscript = '';
      try {
        userTranscript = await runSTT(utteranceChunks, sampleRate);
      } catch (e) {
        console.error('[Backend] STT error:', e.message);
      }
      console.log('[Backend] Starting agent with transcript and history...');
      runAgent(getAgentOptions(userTranscript))
        .then(() => {
          vad.reset();
        })
        .catch((err) => {
          console.error('[Backend] Agent error:', err);
          vad.reset();
        });
    });
    audioSink.ondata = (data) => {
      vad.feed(data);
    };
  }

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      console.log('[Backend] Signaling message received: type=', msg.type);

      if (msg.type === 'offer') {
        console.log('[Backend] --- Data intake: received SDP offer, creating PeerConnection ---');
        pc = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
        });

        pc.ontrack = (ev) => {
          console.log('[Backend] --- Data intake: received remote track ---', ev.track.kind);
          if (ev.track.kind === 'audio' && wrtcModule.nonstandard?.RTCAudioSink) {
            try {
              audioSink = new wrtcModule.nonstandard.RTCAudioSink(ev.track);
              console.log('[Backend] RTCAudioSink created; waiting for 3s silence to start agent');
              tryStartVAD();
            } catch (e) {
              console.log('[Backend] RTCAudioSink setup failed:', e.message);
            }
          }
        };

        pc.ondatachannel = (ev) => {
          dataChannel = ev.channel;
          console.log('[Backend] --- Data intake: DataChannel opened ---', dataChannel.label, 'readyState=', dataChannel.readyState);
          dataChannel.onclose = () => console.log('[Backend] DataChannel closed');
          dataChannel.onerror = (e) => console.error('[Backend] DataChannel error:', e);
          tryStartVAD();
        };

        pc.onicecandidate = (ev) => {
          if (ev.candidate) {
            console.log('[Backend] Sending ICE candidate to client');
            ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate }));
          }
        };

        await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        console.log('[Backend] Sending answer to client');
        ws.send(JSON.stringify({ type: 'answer', sdp: pc.localDescription }));
      } else if (msg.type === 'ice' && msg.candidate && pc) {
        console.log('[Backend] Adding ICE candidate');
        await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
      }
    } catch (err) {
      console.error('[Backend] Signaling error:', err);
      try {
        ws.send(JSON.stringify({
          type: 'error',
          message: err.message || String(err),
        }));
      } catch (_) {}
    }
  });

  ws.on('close', () => {
    if (audioSink) {
      try {
        audioSink.stop();
      } catch (_) {}
    }
    if (pc) pc.close();
    console.log('[Backend] WebSocket closed');
  });
});
