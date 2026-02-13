# CloudWatch Logging Implementation Summary

## Overview
This document describes the CloudWatch logging implementation for all AWS service touchpoints in the case.ly project.

## AWS Touchpoints Identified

### 1. Amazon Transcribe Streaming (`backend/stt.js`)
- **Service**: Amazon Transcribe
- **Operation**: `StartStreamTranscription`
- **Purpose**: Real-time speech-to-text conversion
- **Logging Points**:
  - Request: Language code, sample rate, media encoding
  - Response: Transcript length, partial/final result counts, audio chunk metrics, duration
  - Transcript: First 500 characters of transcript (to avoid huge logs)
  - Errors: Error details with context
  - Session End: Summary of transcript session

### 2. Amazon Bedrock (`backend/agent.js`)
- **Service**: Amazon Bedrock
- **Operation**: `Converse`
- **Purpose**: LLM inference (Nova 2 Lite model)
- **Logging Points**:
  - Request: Model ID, message count, system prompt length, user transcript length, inference config
  - Response: Response length, input/output/total tokens, duration, model ID
  - Response Text: First 500 characters of LLM response
  - Errors: Error details with context and request metadata

### 3. Amazon Polly (`backend/agent.js`)
- **Service**: Amazon Polly
- **Operations**: `SynthesizeSpeech` (called twice per response)
  - Audio synthesis (MP3 output)
  - Viseme generation (JSON output for lip-sync)
- **Purpose**: Text-to-speech conversion and viseme generation for avatar animation
- **Logging Points**:
  - Request: Engine, voice ID, output format, sample rate, text length, purpose (audio/visemes)
  - Response: Audio bytes (for audio), viseme count (for visemes), chunk count, duration, voice ID
  - Errors: Error details with context

## Implementation Details

### CloudWatch Logging Utility (`backend/cloudwatch.js`)
- **Module**: Centralized logging utility for all AWS service interactions
- **Features**:
  - Automatic log group and stream creation
  - Structured JSON logging
  - Error handling that doesn't break application flow
  - Helper functions for different log types (request, response, error, info)
  - Configurable via environment variables:
    - `CLOUDWATCH_LOG_GROUP`: Log group name (default: `casey-backend-aws-usage`)
    - `AWS_REGION`: AWS region (default: `us-east-1`)

### Terraform Infrastructure

#### IAM Policy Updates (`terraform/iam.tf`)
Added CloudWatch Logs permissions to the `casey-backend-ai` IAM policy:
- `logs:CreateLogGroup`
- `logs:CreateLogStream`
- `logs:PutLogEvents`
- `logs:DescribeLogGroups`
- `logs:DescribeLogStreams`

#### CloudWatch Log Group (`terraform/cloudwatch.tf`)
- **Resource**: `aws_cloudwatch_log_group.casey_backend_aws_usage`
- **Name**: `casey-backend-aws-usage`
- **Retention**: 30 days (configurable)
- **Tags**: Environment, Service metadata

#### Outputs (`terraform/outputs.tf`)
Added outputs for:
- CloudWatch log group name
- CloudWatch log group ARN

### Dependencies
- Added `@aws-sdk/client-cloudwatch-logs` to `backend/package.json`

## Log Structure

All logs are structured JSON with the following base fields:
```json
{
  "service": "Transcribe|Bedrock|Polly",
  "operation": "Operation name",
  "eventType": "request|response|error|info",
  "timestamp": "ISO 8601 timestamp",
  ...additional context data
}
```

## Usage

### Automatic Logging
Logging happens automatically when AWS services are called. No code changes needed in application logic beyond the initial implementation.

### Viewing Logs
1. **AWS Console**: Navigate to CloudWatch → Log groups → `casey-backend-aws-usage`
2. **AWS CLI**: 
   ```bash
   aws logs tail casey-backend-aws-usage --follow
   ```
3. **Filtering**: Use CloudWatch Insights to query logs:
   ```
   fields @timestamp, service, operation, eventType
   | filter service = "Bedrock"
   | sort @timestamp desc
   ```

### Environment Variables
- `CLOUDWATCH_LOG_GROUP`: Override default log group name (optional)
- `AWS_REGION`: AWS region (required, defaults to `us-east-1`)
- AWS credentials: Required (via `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` or `AWS_PROFILE`)

## Deployment Steps

1. **Install dependencies**:
   ```bash
   cd backend
   npm install
   ```

2. **Apply Terraform**:
   ```bash
   cd terraform
   terraform init
   terraform plan
   terraform apply
   ```

3. **Configure environment**:
   - Ensure AWS credentials are configured
   - Set `AWS_REGION` if different from default

4. **Run application**:
   - Logging will start automatically when AWS services are used
   - Logs will appear in CloudWatch after first AWS service call

## Benefits

1. **Complete Visibility**: All AWS service interactions are logged with full context
2. **Performance Monitoring**: Duration, token counts, and byte metrics for optimization
3. **Error Tracking**: Detailed error logging for debugging
4. **Cost Analysis**: Track usage patterns for cost optimization
5. **Compliance**: Audit trail of all AWS service usage
6. **Non-intrusive**: Logging failures don't break application functionality

## Notes

- Logging is asynchronous and non-blocking
- Large text fields are truncated to 500 characters to avoid huge log entries
- Log stream names include timestamps for easy identification
- Log group retention is set to 30 days (adjust in `terraform/cloudwatch.tf` as needed)
