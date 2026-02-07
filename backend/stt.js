/**
 * Speech-to-text: Amazon Transcribe streaming.
 * Option A: Stream audio to Transcribe in real-time as VAD feeds chunks.
 */

const DEFAULT_SAMPLE_RATE = 48000;
const END_SENTINEL = Symbol('end');

function hasAWSCredentials() {
  return !!(process.env.AWS_ACCESS_KEY_ID || process.env.AWS_PROFILE || process.env.AWS_ROLE_ARN);
}

/**
 * Create a streaming STT session. Feed audio via feed(), call end() to get transcript.
 * @param {number} sampleRate - PCM sample rate (8000, 16000, 44100, or 48000)
 * @returns {{ feed: (buf: Buffer) => void, end: () => Promise<string> }}
 */
export function createStreamingSTT(sampleRate = DEFAULT_SAMPLE_RATE) {
  if (!hasAWSCredentials()) {
    return {
      feed() {},
      async end() {
        console.log('[STT] No AWS credentials, skipping Transcribe');
        return '';
      },
    };
  }

  const queue = [];
  let ended = false;
  let transcriptPromise = null;
  let transcriptResolve = null;

  async function runTranscribe() {
    const region = process.env.AWS_REGION || 'us-east-1';
    const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = await import(
      '@aws-sdk/client-transcribe-streaming'
    );

    const client = new TranscribeStreamingClient({ region });

    async function* audioGenerator() {
      while (!ended || queue.length > 0) {
        if (queue.length > 0) {
          const item = queue.shift();
          if (item === END_SENTINEL) break;
          const chunk = Buffer.isBuffer(item) ? new Uint8Array(item) : new Uint8Array(item);
          if (chunk.length > 0) {
            yield { AudioEvent: { AudioChunk: chunk } };
          }
        } else {
          await new Promise((r) => setTimeout(r, 10));
        }
      }
    }

    let fullTranscript = '';

    try {
      const command = new StartStreamTranscriptionCommand({
        LanguageCode: 'en-US',
        MediaSampleRateHertz: sampleRate,
        MediaEncoding: 'pcm',
        AudioStream: audioGenerator(),
      });

      const response = await client.send(command);

      if (response.TranscriptResultStream) {
        for await (const event of response.TranscriptResultStream) {
          if (event.TranscriptEvent?.Transcript?.Results) {
            for (const result of event.TranscriptEvent.Transcript.Results) {
              if (!result.IsPartial && result.Alternatives?.[0]?.Transcript) {
                fullTranscript += result.Alternatives[0].Transcript;
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[STT] Transcribe streaming failed:', e.message);
    }

    return fullTranscript.trim();
  }

  return {
    feed(buf) {
      if (ended) return;
      if (!transcriptPromise) {
        transcriptPromise = runTranscribe();
      }
      if (buf && (Buffer.isBuffer(buf) ? buf.length : buf?.byteLength)) {
        queue.push(buf);
      }
    },

    async end() {
      ended = true;
      queue.push(END_SENTINEL);
      if (!transcriptPromise) {
        transcriptPromise = runTranscribe();
      }
      const text = await transcriptPromise;
      console.log('[STT] Transcript:', text || '(empty)');
      return text;
    },
  };
}
