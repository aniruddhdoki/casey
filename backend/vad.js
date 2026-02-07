/**
 * Voice Activity Detection: triggers only after user has spoken for at least
 * MIN_SPEECH_DURATION_MS, then SILENCE_DURATION_MS of silence. Buffers utterance
 * from first voice until trigger for STT.
 */

const SILENCE_DURATION_MS = 3000;
const MIN_SPEECH_DURATION_MS = 3000;
const ENERGY_THRESHOLD = 300;
const DEFAULT_SAMPLE_RATE = 48000;

/**
 * @param {Function} onSilenceDetected - (utteranceChunks, sampleRate) => void
 * @param {{ onAudioChunk?: (buffer: ArrayBuffer|Buffer, sampleRate: number) => void }} [options]
 */
export function createVAD(onSilenceDetected, options = {}) {
  const { onAudioChunk } = options;
  let totalSilenceMs = 0;
  let totalVoiceMs = 0;
  let agentTriggered = false;
  let armed = false; // true once user has spoken for at least MIN_SPEECH_DURATION_MS
  let lastLog = 0;
  let hasSeenVoiceThisRound = false;
  const utteranceBuffer = [];

  function computeRMS(samplesBuffer) {
    if (!samplesBuffer) return 0;
    const buf = samplesBuffer.buffer || samplesBuffer;
    const byteLen = buf.byteLength ?? samplesBuffer.byteLength ?? 0;
    if (byteLen < 2) return 0;
    const view = new Int16Array(buf, samplesBuffer.byteOffset || 0, byteLen / 2);
    let sum = 0;
    for (let i = 0; i < view.length; i++) {
      const s = view[i];
      sum += s * s;
    }
    return view.length ? Math.sqrt(sum / view.length) : 0;
  }

  function feed(data) {
    if (agentTriggered) return;

    const samples = data?.samples ?? data;
    const buffer = samples?.buffer ?? samples;
    const byteLength = buffer?.byteLength ?? samples?.byteLength ?? 0;
    if (byteLength < 2) return;
    const sampleRate = data?.sampleRate ?? DEFAULT_SAMPLE_RATE;
    const durationMs = (byteLength / 2 / sampleRate) * 1000;

    const rms = computeRMS(buffer ?? samples);
    const isVoice = rms > ENERGY_THRESHOLD;

    if (isVoice) {
      hasSeenVoiceThisRound = true;
      totalVoiceMs += durationMs;
      totalSilenceMs = 0;
      if (totalVoiceMs >= MIN_SPEECH_DURATION_MS && !armed) {
        armed = true;
        console.log('[VAD] Armed — user has spoken for', MIN_SPEECH_DURATION_MS, 'ms; waiting for', SILENCE_DURATION_MS, 'ms silence');
      }
    } else {
      totalSilenceMs += durationMs;
    }

    if (hasSeenVoiceThisRound) {
      const raw = buffer ?? samples;
      utteranceBuffer.push({ data: raw, sampleRate, byteLength });
      if (onAudioChunk) {
        const buf = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
        onAudioChunk(buf, sampleRate);
      }
    }

    const now = Date.now();
    if (now - lastLog > 2000) {
      console.log('[VAD] rms=', Math.round(rms), 'isVoice=', isVoice, 'totalVoiceMs=', Math.round(totalVoiceMs), 'totalSilenceMs=', Math.round(totalSilenceMs), 'armed=', armed);
      lastLog = now;
    }

    if (armed && totalSilenceMs >= SILENCE_DURATION_MS) {
      agentTriggered = true;
      console.log('[VAD] Silence for', SILENCE_DURATION_MS, 'ms after speech — triggering agent');
      onSilenceDetected(utteranceBuffer, sampleRate);
    }
  }

  function reset() {
    agentTriggered = false;
    armed = false;
    totalSilenceMs = 0;
    totalVoiceMs = 0;
    hasSeenVoiceThisRound = false;
    utteranceBuffer.length = 0;
    console.log('[VAD] Reset — waiting for user to speak for', MIN_SPEECH_DURATION_MS, 'ms, then', SILENCE_DURATION_MS, 'ms silence');
  }

  return { feed, reset };
}
