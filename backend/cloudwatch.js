/**
 * CloudWatch Logs utility for structured logging of AWS service usage.
 * Logs all interactions with AWS services (Transcribe, Bedrock, Polly).
 */

const AWS_REGION = process.env.AWS_REGION || 'us-east-1';
const LOG_GROUP_NAME = process.env.CLOUDWATCH_LOG_GROUP || 'casey-backend-aws-usage';
const LOG_STREAM_PREFIX = 'aws-services';

let cloudwatchClient = null;
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
 * Initialize CloudWatch Logs client
 */
async function initCloudWatch() {
  if (!hasAWSCredentials()) {
    return false;
  }

  if (cloudwatchClient) {
    return true;
  }

  try {
    const { CloudWatchLogsClient } = await import('@aws-sdk/client-cloudwatch-logs');
    cloudwatchClient = new CloudWatchLogsClient({ region: AWS_REGION });
    
    // Create log stream with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    logStreamName = `${LOG_STREAM_PREFIX}-${timestamp}`;
    
    // Ensure log group exists
    await ensureLogGroup();
    
    // Create log stream
    await createLogStream();
    
    return true;
  } catch (e) {
    console.error('[CloudWatch] Failed to initialize:', e.message);
    return false;
  }
}

/**
 * Ensure the log group exists
 */
async function ensureLogGroup() {
  try {
    const { CreateLogGroupCommand, DescribeLogGroupsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
    
    // Check if log group exists
    const describeResponse = await cloudwatchClient.send(
      new DescribeLogGroupsCommand({
        logGroupNamePrefix: LOG_GROUP_NAME,
      })
    );
    
    const exists = describeResponse.logGroups?.some(
      (lg) => lg.logGroupName === LOG_GROUP_NAME
    );
    
    if (!exists) {
      // Create log group
      await cloudwatchClient.send(
        new CreateLogGroupCommand({
          logGroupName: LOG_GROUP_NAME,
        })
      );
      console.log(`[CloudWatch] Created log group: ${LOG_GROUP_NAME}`);
    }
  } catch (e) {
    // Log group might already exist or we might not have permissions
    // Continue anyway - the PutLogEvents will fail gracefully if needed
    console.warn('[CloudWatch] Could not ensure log group exists:', e.message);
  }
}

/**
 * Create a new log stream
 */
async function createLogStream() {
  try {
    const { CreateLogStreamCommand } = await import('@aws-sdk/client-cloudwatch-logs');
    await cloudwatchClient.send(
      new CreateLogStreamCommand({
        logGroupName: LOG_GROUP_NAME,
        logStreamName: logStreamName,
      })
    );
    sequenceToken = undefined; // First event doesn't need sequence token
    console.log(`[CloudWatch] Created log stream: ${logStreamName}`);
  } catch (e) {
    // Stream might already exist
    if (e.name !== 'ResourceAlreadyExistsException') {
      console.warn('[CloudWatch] Could not create log stream:', e.message);
    }
  }
}

/**
 * Log an event to CloudWatch
 * @param {string} service - AWS service name (e.g., 'Transcribe', 'Bedrock', 'Polly')
 * @param {string} operation - Operation name (e.g., 'StartStreamTranscription', 'Converse', 'SynthesizeSpeech')
 * @param {string} eventType - Event type (e.g., 'request', 'response', 'error', 'info')
 * @param {object} data - Additional data to log
 */
export async function logToCloudWatch(service, operation, eventType, data = {}) {
  if (!hasAWSCredentials()) {
    return;
  }

  // Initialize if needed
  if (!cloudwatchClient) {
    const initialized = await initCloudWatch();
    if (!initialized) {
      return;
    }
  }

  const timestamp = Date.now();
  const logMessage = {
    service,
    operation,
    eventType,
    timestamp: new Date().toISOString(),
    ...data,
  };

  try {
    const { PutLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
    
    const params = {
      logGroupName: LOG_GROUP_NAME,
      logStreamName: logStreamName,
      logEvents: [
        {
          timestamp,
          message: JSON.stringify(logMessage),
        },
      ],
    };

    if (sequenceToken) {
      params.sequenceToken = sequenceToken;
    }

    const response = await cloudwatchClient.send(new PutLogEventsCommand(params));
    sequenceToken = response.nextSequenceToken;
  } catch (e) {
    // Don't throw - logging failures shouldn't break the app
    // But log to console for debugging
    console.warn(`[CloudWatch] Failed to log ${service}/${operation}/${eventType}:`, e.message);
  }
}

/**
 * Helper to log AWS service requests
 */
export async function logRequest(service, operation, requestData = {}) {
  await logToCloudWatch(service, operation, 'request', {
    ...requestData,
  });
}

/**
 * Helper to log AWS service responses
 */
export async function logResponse(service, operation, responseData = {}) {
  await logToCloudWatch(service, operation, 'response', {
    ...responseData,
  });
}

/**
 * Helper to log AWS service errors
 */
export async function logError(service, operation, error, context = {}) {
  await logToCloudWatch(service, operation, 'error', {
    error: {
      name: error?.name,
      message: error?.message,
      code: error?.code,
      statusCode: error?.$metadata?.httpStatusCode,
    },
    ...context,
  });
}

/**
 * Helper to log informational events
 */
export async function logInfo(service, operation, infoData = {}) {
  await logToCloudWatch(service, operation, 'info', infoData);
}
