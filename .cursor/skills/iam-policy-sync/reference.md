# AWS SDK Client → IAM Actions Reference

**Maintained by the iam-policy-sync skill.** After each run that touches IAM or backend AWS usage, this file must be updated so "This Project's Clients" reflects the current state of `backend/package.json` and `terraform/iam.tf`.

Map backend `@aws-sdk/client-*` usage to IAM policy actions. Use the service prefix and add the specific API name (e.g. `StartStreamTranscription` → `transcribe:StartStreamTranscription`).

## This Project’s Clients

| SDK client | IAM prefix | Typical actions |
|------------|------------|------------------|
| `@aws-sdk/client-transcribe-streaming` | `transcribe:` | `StartStreamTranscription` |
| `@aws-sdk/client-bedrock-runtime` | `bedrock:` | `InvokeModel`, `InvokeModelWithResponseStream`, `GetInferenceProfile` |
| `@aws-sdk/client-polly` | `polly:` | `SynthesizeSpeech` |
| `@aws-sdk/client-cloudwatch-logs` | `logs:` | `CreateLogGroup`, `CreateLogStream`, `PutLogEvents`, `DescribeLogStreams`, `DescribeLogGroups` |

## Adding a New AWS Service

1. **Identify the client** in `backend/package.json` (e.g. `@aws-sdk/client-dynamodb`).
2. **Find the IAM prefix**: usually the service name in lowercase (e.g. DynamoDB → `dynamodb:`). See [AWS IAM actions by service](https://docs.aws.amazon.com/service-authorization/latest/reference/reference_policies_actions-resources-contextkeys.html).
3. **Map method calls to actions**: SDK method names often match IAM action names (e.g. `GetItem` → `dynamodb:GetItem`). For batch or list APIs, include both (e.g. `BatchGetItem`, `Query`, `Scan`).
4. **Add one Statement** in `terraform/iam.tf` with a descriptive `Sid`, the new actions, and `Resource = "*"` (or specific ARNs if the project restricts resources).

## Common patterns

- **Streaming / real-time**: often one action (e.g. `transcribe:StartStreamTranscription`).
- **Invoke / run**: e.g. `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`, `lambda:InvokeFunction`.
- **Logs**: scope `CreateLogStream`, `PutLogEvents`, `DescribeLogStreams` to the log group ARNs used in the app; `DescribeLogGroups` can stay `*` if used for discovery.
