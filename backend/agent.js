/**
 * Agent: STT transcript + conversation history -> Bedrock LLM -> Polly TTS.
 * Streams audio and visemes to client in real-time.
 */

import { logRequest, logResponse, logError, logInfo } from './cloudwatch.js';

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
// Llama 4 Scout: use inference profile ARN (foundation model ID returns "Operation not allowed" / on-demand not supported)
const BEDROCK_MODEL_ID = `amazon.nova-2-lite-v1:0`;
const POLLY_VOICE_ID = 'Joanna';
const SYSTEM_PROMPT =
  'You are an interview coach. Respond concisely and naturally. One or two short sentences per turn.';

function hasAWSCredentials() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_ROLE_ARN
  );
}

export async function runAgent({
  conversationHistory,
  userTranscript,
  sendAudioChunk,
  sendViseme,
  sendEnd,
}) {
  console.log('[Agent] --- Step 1: Agent started ---');
  console.log('[Agent] User transcript:', userTranscript || '(empty)');
  console.log('[Agent] History length:', conversationHistory?.length ?? 0);
  console.log('[Agent] AWS credentials present:', hasAWSCredentials());

  const text = hasAWSCredentials()
    ? await getLLMResponse(conversationHistory, userTranscript)
    : 'Hello. This is a test response from the interview platform.';

  console.log('[Agent] Response to speak:', text);

  if (hasAWSCredentials()) {
    await streamTTS(text, sendAudioChunk, sendViseme, sendEnd);
  } else {
    await sendTestResponse(sendViseme, sendEnd);
  }
}

async function getLLMResponse(conversationHistory, userTranscript) {
  if (!hasAWSCredentials()) return 'Test response.';

  console.log('[Agent] --- Step 2: Response generation (Bedrock) ---');
  const { BedrockRuntimeClient, ConverseCommand } = await import(
    '@aws-sdk/client-bedrock-runtime'
  );

  const client = new BedrockRuntimeClient({ region: AWS_REGION });

  const messages = [
    ...(conversationHistory || []).map((m) => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: [{ text: m.content || '' }],
    })),
    {
      role: 'user',
      content: [{ text: userTranscript?.trim() || '(no speech detected)' }],
    },
  ];

  const startTime = Date.now();
  const requestData = {
    modelId: BEDROCK_MODEL_ID,
    region: AWS_REGION,
    messageCount: messages.length,
    systemPromptLength: SYSTEM_PROMPT.length,
    userTranscriptLength: userTranscript?.trim()?.length || 0,
    maxTokens: 150,
    temperature: 0.7,
  };

  try {
    console.log('[Agent] Bedrock request:', requestData);
    
    // Log request
    await logRequest('Bedrock', 'Converse', requestData);

    const response = await client.send(
      new ConverseCommand({
        modelId: BEDROCK_MODEL_ID,
        messages,
        system: [{ text: SYSTEM_PROMPT }],
        inferenceConfig: {
          maxTokens: 150,
          temperature: 0.7,
        },
      })
    );

    const responseText =
      response.output?.message?.content
        ?.map((c) => c.text)
        ?.join('')
        ?.trim() || 'Okay.';

    const duration = Date.now() - startTime;
    const inputTokens = response.usage?.inputTokens || 0;
    const outputTokens = response.usage?.outputTokens || 0;
    const totalTokens = response.usage?.totalTokens || 0;

    console.log('[Agent] LLM output:', responseText);

    // Log successful response
    await logResponse('Bedrock', 'Converse', {
      responseLength: responseText.length,
      inputTokens,
      outputTokens,
      totalTokens,
      durationMs: duration,
      modelId: BEDROCK_MODEL_ID,
    });

    // Log response text (truncated)
    await logInfo('Bedrock', 'ResponseText', {
      responseText: responseText.substring(0, 500), // Log first 500 chars
      fullLength: responseText.length,
    });

    conversationHistory.push({
      role: 'user',
      content: userTranscript?.trim() || '(no speech detected)',
    });
    conversationHistory.push({ role: 'assistant', content: responseText });

    return responseText;
  } catch (e) {
    const duration = Date.now() - startTime;
    console.error('[Agent] Bedrock error (message):', e.message);
    console.error('[Agent] Bedrock error (name):', e.name);
    console.error('[Agent] Bedrock error (code):', e.code);
    if (e.$metadata) console.error('[Agent] Bedrock error ($metadata):', JSON.stringify(e.$metadata, null, 2));
    console.error('[Agent] Bedrock error (full):', e);
    
    // Log error
    await logError('Bedrock', 'Converse', e, {
      durationMs: duration,
      modelId: BEDROCK_MODEL_ID,
      messageCount: messages.length,
    });
    
    return 'I apologize, I had trouble processing that.';
  }
}

async function streamTTS(text, sendAudioChunk, sendViseme, sendEnd) {
  if (!hasAWSCredentials()) {
    sendEnd();
    return;
  }

  console.log('[Agent] --- Step 3: Text-to-speech (Polly Neural) ---');

  const { PollyClient, SynthesizeSpeechCommand } = await import(
    '@aws-sdk/client-polly'
  );

  const polly = new PollyClient({ region: AWS_REGION });

  async function streamAudio() {
    const startTime = Date.now();
    let totalBytes = 0;
    let chunkCount = 0;
    
    try {
      const requestData = {
        engine: 'neural',
        voiceId: POLLY_VOICE_ID,
        outputFormat: 'mp3',
        sampleRate: '24000',
        textLength: text.length,
      };

      // Log request
      await logRequest('Polly', 'SynthesizeSpeech', {
        ...requestData,
        purpose: 'audio',
      });

      const response = await polly.send(
        new SynthesizeSpeechCommand({
          Engine: 'neural',
          VoiceId: POLLY_VOICE_ID,
          OutputFormat: 'mp3',
          SampleRate: '24000',
          Text: text,
          TextType: 'text',
        })
      );
      const stream = response.AudioStream;
      if (stream) {
        for await (const chunk of stream) {
          const buf = chunk instanceof Uint8Array ? Buffer.from(chunk) : Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          if (buf.length > 0) {
            chunkCount++;
            totalBytes += buf.length;
            sendAudioChunk(buf);
          }
        }
      }

      const duration = Date.now() - startTime;
      
      // Log successful response
      await logResponse('Polly', 'SynthesizeSpeech', {
        purpose: 'audio',
        audioBytes: totalBytes,
        chunkCount,
        durationMs: duration,
        voiceId: POLLY_VOICE_ID,
        textLength: text.length,
      });
    } catch (e) {
      const duration = Date.now() - startTime;
      console.error('[Agent] Polly audio failed:', e.message);
      
      // Log error
      await logError('Polly', 'SynthesizeSpeech', e, {
        purpose: 'audio',
        durationMs: duration,
        voiceId: POLLY_VOICE_ID,
        textLength: text.length,
      });
    }
  }

  async function streamVisemes() {
    const startTime = Date.now();
    let visemeCount = 0;
    
    try {
      const requestData = {
        engine: 'neural',
        voiceId: POLLY_VOICE_ID,
        outputFormat: 'json',
        speechMarkTypes: ['viseme'],
        textLength: text.length,
      };

      // Log request
      await logRequest('Polly', 'SynthesizeSpeech', {
        ...requestData,
        purpose: 'visemes',
      });

      const response = await polly.send(
        new SynthesizeSpeechCommand({
          Engine: 'neural',
          VoiceId: POLLY_VOICE_ID,
          OutputFormat: 'json',
          SpeechMarkTypes: ['viseme'],
          Text: text,
          TextType: 'text',
        })
      );
      const stream = response.AudioStream;
      if (stream) {
        let body = '';
        for await (const chunk of stream) {
          body += typeof chunk === 'string' ? chunk : chunk.toString();
        }
        for (const line of body.split('\n').filter(Boolean)) {
          try {
            const mark = JSON.parse(line);
            if (mark.type === 'viseme' && mark.value != null) {
              visemeCount++;
              sendViseme(mark.time, mark.value);
            }
          } catch (_) {}
        }
      }

      const duration = Date.now() - startTime;
      
      // Log successful response
      await logResponse('Polly', 'SynthesizeSpeech', {
        purpose: 'visemes',
        visemeCount,
        durationMs: duration,
        voiceId: POLLY_VOICE_ID,
        textLength: text.length,
      });
    } catch (e) {
      const duration = Date.now() - startTime;
      console.error('[Agent] Polly visemes failed:', e.message);
      
      // Log error
      await logError('Polly', 'SynthesizeSpeech', e, {
        purpose: 'visemes',
        durationMs: duration,
        voiceId: POLLY_VOICE_ID,
        textLength: text.length,
      });
    }
  }

  await Promise.all([streamAudio(), streamVisemes()]);
  sendEnd();
}

async function sendTestResponse(sendViseme, sendEnd) {
  const VISEME_CODES = ['p', 't', 'S', 'i', 'u', 'a', '@', 'e', 'E', 'o'];
  const durationMs = 2000;
  const intervalMs = 80;
  for (let t = 0; t < durationMs; t += intervalMs) {
    const value = VISEME_CODES[Math.floor(Math.random() * VISEME_CODES.length)];
    sendViseme(t, value);
  }
  sendEnd();
}
