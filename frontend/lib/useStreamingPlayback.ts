'use client';

import { useRef, useEffect, useCallback, useState } from 'react';

/**
 * Consumes streamed audio chunks, decodes and plays them live via Web Audio API.
 * Exposes refs for current playback time and duration so the Avatar can sync visemes.
 */
export function useStreamingPlayback(
  streamedChunks: ArrayBuffer[],
  streamEnded: boolean,
  onStreamingEnd: () => void
) {
  const audioContextRef = useRef<AudioContext | null>(null);
  const pendingRef = useRef<Uint8Array>(new Uint8Array(0));
  const nextStartTimeRef = useRef(0);
  const streamStartTimeRef = useRef(0);
  const lastProcessedIndexRef = useRef(0);
  const streamingDurationRef = useRef(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const streamingTimeRef = useRef(0);
  const rafRef = useRef<number>(0);
  const onStreamingEndRef = useRef(onStreamingEnd);
  const decodingInProgressRef = useRef(false);
  onStreamingEndRef.current = onStreamingEnd;

  const ensureContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;
    const ctx = new AudioContext();
    audioContextRef.current = ctx;
    return ctx;
  }, []);

  // Reset internal state when stream is cleared (e.g. after onStreamingEnd) so next response is played
  useEffect(() => {
    if (streamedChunks.length === 0) {
      lastProcessedIndexRef.current = 0;
      pendingRef.current = new Uint8Array(0);
      nextStartTimeRef.current = 0;
      streamStartTimeRef.current = 0;
      streamingDurationRef.current = 0;
      decodingInProgressRef.current = false;
      return;
    }
    const from = lastProcessedIndexRef.current;
    if (from >= streamedChunks.length) return;

    console.log('[Frontend] StreamingPlayback: processing new chunks, from=', from, 'count=', streamedChunks.length - from);
    const ctx = ensureContext();
    const newChunks = streamedChunks.slice(from);
    lastProcessedIndexRef.current = streamedChunks.length;

    const totalNew = newChunks.reduce((acc, c) => acc + c.byteLength, 0);
    const prevPending = pendingRef.current;
    const combined = new Uint8Array(prevPending.length + totalNew);
    combined.set(prevPending);
    let offset = prevPending.length;
    for (const c of newChunks) {
      combined.set(new Uint8Array(c), offset);
      offset += c.byteLength;
    }
    pendingRef.current = combined;
    console.log('[Frontend] StreamingPlayback: pending size=', combined.length, 'bytes');

    const tryDecodeAndPlay = () => {
      const pending = pendingRef.current;
      if (pending.length === 0) return;
      if (decodingInProgressRef.current) return;

      decodingInProgressRef.current = true;
      const buffer = pending.buffer.slice(pending.byteOffset, pending.byteOffset + pending.byteLength);
      ctx.decodeAudioData(buffer as ArrayBuffer)
        .then((decoded) => {
          if (nextStartTimeRef.current === 0) {
            console.log('[Frontend] --- Backend audio playback START ---');
            streamStartTimeRef.current = ctx.currentTime;
            nextStartTimeRef.current = ctx.currentTime;
            setIsStreaming(true);
          }
          const source = ctx.createBufferSource();
          source.buffer = decoded;
          source.connect(ctx.destination);
          const start = nextStartTimeRef.current;
          source.start(start);
          nextStartTimeRef.current = start + decoded.duration;
          streamingDurationRef.current = (nextStartTimeRef.current - streamStartTimeRef.current) * 1000;
          pendingRef.current = new Uint8Array(0);
          const durationMs = Math.round(decoded.duration * 1000);
          console.log('[Frontend] Playback buffer loaded: ', durationMs, 'ms (source: chunks)');
          console.log('[Frontend] StreamingPlayback: playing audio, duration=', decoded.duration.toFixed(2), 's');
        })
        .catch((e) => {
          console.log('[Frontend] StreamingPlayback: decode failed (need more data?), pending=', pending.length, 'bytes', e?.message || '');
        })
        .finally(() => {
          decodingInProgressRef.current = false;
        });
    };

    tryDecodeAndPlay();
  }, [streamedChunks, ensureContext]);

  // On stream end: decode any remaining pending (only if chunk effect didn't already take it)
  useEffect(() => {
    if (!streamEnded) return;
    const pending = pendingRef.current;
    console.log('[Frontend] StreamingPlayback: stream ended, pending size=', pending.length, 'decodingInProgress=', decodingInProgressRef.current);
    if (pending.length === 0) return;
    if (decodingInProgressRef.current) return;

    const ctx = audioContextRef.current;
    if (!ctx) {
      console.log('[Frontend] StreamingPlayback: no AudioContext, decoding remaining when context exists');
      return;
    }

    decodingInProgressRef.current = true;
    const buffer = pending.buffer.slice(pending.byteOffset, pending.byteOffset + pending.byteLength);
    ctx.decodeAudioData(buffer as ArrayBuffer)
      .then((decoded) => {
        if (nextStartTimeRef.current === 0) {
          console.log('[Frontend] --- Backend audio playback START ---');
          streamStartTimeRef.current = ctx.currentTime;
          nextStartTimeRef.current = ctx.currentTime;
          setIsStreaming(true);
        }
        const source = ctx.createBufferSource();
        source.buffer = decoded;
        source.connect(ctx.destination);
        const start = nextStartTimeRef.current;
        source.start(start);
        nextStartTimeRef.current = start + decoded.duration;
        streamingDurationRef.current = (nextStartTimeRef.current - streamStartTimeRef.current) * 1000;
        pendingRef.current = new Uint8Array(0);
        const durationMs = Math.round(decoded.duration * 1000);
        console.log('[Frontend] Playback buffer loaded: ', durationMs, 'ms (source: stream-end)');
        console.log('[Frontend] StreamingPlayback: final buffer scheduled, duration=', decoded.duration.toFixed(2), 's');
      })
      .catch((e) => {
        console.warn('[Frontend] StreamingPlayback: final decode failed', e?.message || e);
      })
      .finally(() => {
        decodingInProgressRef.current = false;
      });
  }, [streamEnded]);

  // Update streamingTimeRef every frame and check for end
  useEffect(() => {
    if (!isStreaming) return;
    const ctx = audioContextRef.current;
    if (!ctx) return;

    const tick = () => {
      const now = ctx.currentTime;
      const start = streamStartTimeRef.current;
      const durationSec = (streamingDurationRef.current || 0) / 1000;
      streamingTimeRef.current = Math.max(0, (now - start) * 1000);
      if (streamEnded && streamingTimeRef.current >= streamingDurationRef.current && durationSec > 0) {
        console.log('[Frontend] --- Backend audio playback END ---');
        setIsStreaming(false);
        onStreamingEndRef.current();
        return;
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isStreaming, streamEnded]);

  return {
    isStreaming,
    streamingTimeRef,
    streamingDurationRef,
  };
}
