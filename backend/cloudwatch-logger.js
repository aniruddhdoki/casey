/**
 * CloudWatch logging utility for AWS service usage tracking.
 * Logs all AWS service calls with request/response metadata, timing, and errors.
 */

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const LOG_GROUP_NAME = process.env.CLOUDWATCH_LOG_GROUP || '/aws/casey/backend';

let cloudwatchLogsClient = null;
let logStreamName = null;
let sequenceToken = null;

function hasAWSCredentials() {
  return !!(
    process.env.AWS_ACCESS_KEY_ID ||
    process.env.AWS_PROFILE ||
    process.env.AWS_ROLE_ARN
  );
}

/**
 * Initialize CloudWatch Logs client and create log stream
 */
async function initializeLogger() {
  if (!hasAWSCredentials()) {
    console.log('[CloudWatch] No AWS credentials, skipping CloudWatch logging');
    return false;
  }

  try {
    const { CloudWatchLogsClient, CreateLogStreamCommand, DescribeLogStreamsCommand } = await import(
      '@aws-sdk/client-cloudwatch-logs'
    );

    cloudwatchLogsClient = new CloudWatchLogsClient({ region: AWS_REGION });

    // Generate unique log stream name with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    logStreamName = `backend-${timestamp}-${Math.random().toString(36).substring(7)}`;

    // Check if log stream exists, create if not
    try {
      const describeCmd = new DescribeLogStreamsCommand({
        logGroupName: LOG_GROUP_NAME,
        logStreamNamePrefix: logStreamName,
      });
      await cloudwatchLogsClient.send(describeCmd);
    } catch (e) {
      // Log group or stream doesn't exist, try to create stream
      try {
        const createCmd = new CreateLogStreamCommand({
          logGroupName: LOG_GROUP_NAME,
          logStreamName,
        });
        await cloudwatchLogsClient.send(createCmd);
      } catch (createErr) {
        // If log group doesn't exist, we'll just log to console
        console.warn('[CloudWatch] Could not create log stream:', createErr.message);
        return false;
      }
    }

    console.log(`[CloudWatch] Logger initialized - log stream: ${logStreamName}`);
    return true;
  } catch (e) {
    console.warn('[CloudWatch] Failed to initialize logger:', e.message);
    return false;
  }
}

/**
 * Send log events to CloudWatch
 */
async function sendLogEvents(events) {
  if (!cloudwatchLogsClient || !logStreamName) {
    return;
  }

  try {
    const { PutLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');

    const command = new PutLogEventsCommand({
      logGroupName: LOG_GROUP_NAME,
      logStreamName,
      logEvents: events,
      sequenceToken,
    });

    const response = await cloudwatchLogsClient.send(command);
    sequenceToken = response.nextSequenceToken;
  } catch (e) {
    // If sequence token is invalid, reset it and retry once
    if (e.name === 'InvalidSequenceTokenException' && e.expectedSequenceToken) {
      sequenceToken = e.expectedSequenceToken;
      try {
        const { PutLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
        const command = new PutLogEventsCommand({
          logGroupName: LOG_GROUP_NAME,
          logStreamName,
          logEvents: events,
          sequenceToken,
        });
        const response = await cloudwatchLogsClient.send(command);
        sequenceToken = response.nextSequenceToken;
      } catch (retryErr) {
        console.warn('[CloudWatch] Failed to send log events after retry:', retryErr.message);
      }
    } else {
      console.warn('[CloudWatch] Failed to send log events:', e.message);
    }
  }
}

/**
 * Log AWS service usage
 * @param {string} service - Service name (e.g., 'Transcribe', 'Bedrock', 'Polly')
 * @param {string} operation - Operation name (e.g., 'StartStreamTranscription', 'Converse', 'SynthesizeSpeech')
 * @param {object} metadata - Additional metadata (request params, response data, timing, errors, etc.)
 */
export async function logAWSUsage(service, operation, metadata = {}) {
  const timestamp = Date.now();
  const logEntry = {
    timestamp: new Date().toISOString(),
    service,
    operation,
    ...metadata,
  };

  const logMessage = JSON.stringify(logEntry);

  // Always log to console for local debugging
  console.log(`[CloudWatch] ${service}.${operation}:`, logMessage);

  // Send to CloudWatch if initialized
  if (cloudwatchLogsClient && logStreamName) {
    await sendLogEvents([
      {
        timestamp,
        message: logMessage,
      },
    ]);
  }
}

/**
 * Create a wrapper function that logs AWS service calls
 * @param {string} service - Service name
 * @param {string} operation - Operation name
 * @param {Function} awsCall - The AWS SDK call function
 * @param {Function} [requestSerializer] - Optional function to serialize request for logging
 * @param {Function} [responseSerializer] - Optional function to serialize response for logging
 */
export function withCloudWatchLogging(service, operation, awsCall, requestSerializer, responseSerializer) {
  return async function (...args) {
    const startTime = Date.now();
    const request = args[0] || {};
    let requestData = request;

    // Serialize request if serializer provided
    if (requestSerializer) {
      try {
        requestData = requestSerializer(request);
      } catch (e) {
        requestData = { error: 'Failed to serialize request', message: e.message };
      }
    }

    // Log request
    await logAWSUsage(service, operation, {
      event: 'request',
      request: requestData,
    });

    try {
      const response = await awsCall.apply(this, args);
      const duration = Date.now() - startTime;
      let responseData = response;

      // Serialize response if serializer provided
      if (responseSerializer) {
        try {
          responseData = responseSerializer(response);
        } catch (e) {
          responseData = { error: 'Failed to serialize response', message: e.message };
        }
      }

      // Log successful response
      await logAWSUsage(service, operation, {
        event: 'response',
        status: 'success',
        durationMs: duration,
        request: requestData,
        response: responseData,
      });

      return response;
    } catch (error) {
      const duration = Date.now() - startTime;

      // Log error
      await logAWSUsage(service, operation, {
        event: 'error',
        status: 'error',
        durationMs: duration,
        request: requestData,
        error: {
          name: error.name,
          message: error.message,
          code: error.code,
          $metadata: error.$metadata,
        },
      });

      throw error;
    }
  };
}

// Initialize logger on module load
let initialized = false;
export async function ensureInitialized() {
  if (!initialized) {
    initialized = await initializeLogger();
  }
  return initialized;
}

// Auto-initialize if credentials are available
if (hasAWSCredentials()) {
  ensureInitialized().catch((e) => {
    console.warn('[CloudWatch] Auto-initialization failed:', e.message);
  });
}
