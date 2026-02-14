'use client';

import { useCallback, useRef, useState } from 'react';

function normalizeWsUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  const withWsProtocol = trimmed.replace(/^http/i, 'ws');
  // Allow host-only values like "wss://api.casey.com" and normalize to /ws.
  if (!/\/ws(?:[/?#]|$)/.test(withWsProtocol)) {
    return `${withWsProtocol.replace(/\/+$/, '')}/ws`;
  }
  return withWsProtocol;
}

const configuredWsUrl = process.env.NEXT_PUBLIC_WS_URL?.trim();
const sameOriginWsBase =
  typeof window !== 'undefined' && window.location.origin
    ? window.location.origin.replace(/^http/, 'ws')
    : '';

const WS_URL = configuredWsUrl
  ? normalizeWsUrl(configuredWsUrl)
  : process.env.NODE_ENV === 'development'
    ? 'ws://localhost:3001/ws'
    : `${sameOriginWsBase}/ws`;

export type InterviewWebRTCState = {
  status: 'idle' | 'connecting' | 'connected' | 'error';
  error: string | null;
  /** Accumulated audio chunks (binary) from backend */
  streamedAudioChunks: ArrayBuffer[];
  /** Viseme events received (time in ms, value = viseme code) */
  streamedSpeechMarks: { time: number; value: string }[];
  /** True when backend sent stream end */
  streamEnded: boolean;
};

export function useInterviewWebRTC() {
  const [state, setState] = useState<InterviewWebRTCState>({
    status: 'idle',
    error: null,
    streamedAudioChunks: [],
    streamedSpeechMarks: [],
    streamEnded: false,
  });

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioTrackRef = useRef<MediaStreamTrack | null>(null);
  const connectedRef = useRef(false);
  const rejectRef = useRef<((reason: Error) => void) | null>(null);

  const setMicEnabled = useCallback((enabled: boolean) => {
    if (audioTrackRef.current) {
      audioTrackRef.current.enabled = enabled;
      console.log('[Frontend WebRTC] Mic', enabled ? 'unmuted' : 'muted (backend playing)');
    }
  }, []);

  const resetStreamed = useCallback(() => {
    setState((s) => ({
      ...s,
      streamedAudioChunks: [],
      streamedSpeechMarks: [],
      streamEnded: false,
    }));
  }, []);

  const connect = useCallback(
    async (mediaStream: MediaStream) => {
      connectedRef.current = false;
      resetStreamed();
      setState((s) => ({ ...s, status: 'connecting', error: null }));

      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;
      streamRef.current = mediaStream;

      ws.onerror = (e) => {
        console.error('[Frontend WebRTC] WebSocket error', e);
        setState((s) => ({ ...s, status: 'error', error: 'WebSocket error' }));
      };

      ws.onclose = () => {
        console.log('[Frontend WebRTC] WebSocket closed');
        wsRef.current = null;
      };

      ws.onmessage = async (event) => {
        try {
          const msg = JSON.parse(event.data as string);
          console.log('[Frontend WebRTC] Signaling received:', msg.type);

          if (msg.type === 'error') {
            const errorMessage = (msg as { message?: string }).message ?? 'Unknown backend error';
            console.error('[Frontend WebRTC] Backend sent error:', errorMessage);
            setState((s) => ({ ...s, status: 'error', error: errorMessage }));
            if (rejectRef.current) {
              rejectRef.current(new Error(errorMessage));
              rejectRef.current = null;
            }
            return;
          }

          if (msg.type === 'answer' && pcRef.current) {
            await pcRef.current.setRemoteDescription(new RTCSessionDescription(msg.sdp));
            console.log('[Frontend WebRTC] Remote description set');
          } else if (msg.type === 'ice' && msg.candidate && pcRef.current) {
            await pcRef.current.addIceCandidate(new RTCIceCandidate(msg.candidate));
            console.log('[Frontend WebRTC] ICE candidate added');
          }
        } catch (err) {
          console.error('[Frontend WebRTC] Signaling message error', err);
        }
      };

      return new Promise<void>((resolve, reject) => {
        rejectRef.current = reject;
        ws.onopen = () => {
          console.log('[Frontend WebRTC] WebSocket open');
          console.log('[Frontend WebRTC] Creating PeerConnection and sending offer');
          const pc = new RTCPeerConnection({
            iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
          });
          pcRef.current = pc;

          const audioTrack = mediaStream.getAudioTracks()[0];
          audioTrackRef.current = audioTrack;
          pc.addTrack(audioTrack, mediaStream);
          console.log('[Frontend WebRTC] Added local audio track');

          const dc = pc.createDataChannel('downstream', { ordered: true });
          console.log('[Frontend WebRTC] DataChannel created');

          dc.onopen = () => {
            connectedRef.current = true;
            rejectRef.current = null;
            console.log('[Frontend WebRTC] DataChannel open');
            setState((s) => ({ ...s, status: 'connected' }));
            resolve();
          };

          dc.onmessage = (event) => {
            if (typeof event.data === 'string') {
              try {
                const payload = JSON.parse(event.data);
                if (payload.type === 'viseme') {
                  // Process viseme events as they stream in
                  // Visemes arrive in chronological order from Polly, so we can append directly
                  setState((s) => {
                    const newViseme = { time: payload.time, value: payload.value };
                    const updatedMarks = [...s.streamedSpeechMarks, newViseme];
                    
                    // Log first few visemes for debugging
                    if (updatedMarks.length <= 3) {
                      console.log('[Frontend WebRTC] Viseme received:', newViseme, `(total: ${updatedMarks.length})`);
                    }
                    
                    return {
                      ...s,
                      streamedSpeechMarks: updatedMarks,
                    };
                  });
                } else if (payload.type === 'end') {
                  console.log('[Frontend WebRTC] Stream end received');
                  setState((s) => ({ ...s, streamEnded: true }));
                } else {
                  console.log('[Frontend WebRTC] DataChannel text:', payload);
                }
              } catch (e) {
                console.warn('[Frontend WebRTC] Failed to parse DataChannel message:', e);
              }
            } else {
              const data = event.data;
              const p =
                data instanceof ArrayBuffer
                  ? Promise.resolve(data)
                  : data instanceof Blob
                    ? data.arrayBuffer()
                    : Promise.resolve(new Uint8Array(data).buffer);
              p.then((arrayBuffer: ArrayBuffer) => {
                setState((s) => {
                  console.log('[Frontend] Audio from backend: binary chunk received, size=', arrayBuffer.byteLength, 'total chunks=', s.streamedAudioChunks.length + 1);
                  return {
                    ...s,
                    streamedAudioChunks: [...s.streamedAudioChunks, arrayBuffer],
                  };
                });
              });
            }
          };

          dc.onclose = () => console.log('[Frontend WebRTC] DataChannel closed');
          dc.onerror = (e) => console.error('[Frontend WebRTC] DataChannel error', e);

          pc.onicecandidate = (ev) => {
            if (ev.candidate) {
              console.log('[Frontend WebRTC] Sending ICE candidate to backend');
              ws.send(JSON.stringify({ type: 'ice', candidate: ev.candidate }));
            }
          };

          pc.createOffer()
            .then((offer) => {
              return pc.setLocalDescription(offer);
            })
            .then(() => {
              console.log('[Frontend WebRTC] Sending offer to backend');
              ws.send(JSON.stringify({ type: 'offer', sdp: pc.localDescription }));
            })
            .catch((err) => {
              console.error('[Frontend WebRTC] Create offer error', err);
              setState((s) => ({ ...s, status: 'error', error: String(err) }));
              reject(err);
            });
        };

        ws.onerror = () => reject(new Error('WebSocket failed'));
        ws.onclose = () => {
          if (!connectedRef.current) reject(new Error('WebSocket closed before connected'));
        };
      });
    },
    [resetStreamed]
  );

  const disconnect = useCallback(() => {
    audioTrackRef.current = null;
    if (pcRef.current) {
      pcRef.current.close();
      pcRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setState((s) => ({ ...s, status: 'idle', error: null }));
  }, []);

  return {
    state,
    connect,
    disconnect,
    resetStreamed,
    setMicEnabled,
  };
}
