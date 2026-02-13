# IAM policy for casey backend: Transcribe, Bedrock, Polly
resource "aws_iam_policy" "casey_backend" {
  name        = "casey-backend-ai"
  description = "Allows casey backend to use Transcribe, Bedrock, and Polly"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "TranscribeStreaming"
        Effect = "Allow"
        Action = [
          "transcribe:StartStreamTranscription"
        ]
        Resource = "*"
      },
      {
        Sid    = "BedrockInvoke"
        Effect = "Allow"
        Action = [
          "bedrock:InvokeModel",
          "bedrock:InvokeModelWithResponseStream"
        ]
        Resource = "*"
      },
      {
        Sid    = "PollySynthesize"
        Effect = "Allow"
        Action = [
          "polly:SynthesizeSpeech"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents",
          "logs:DescribeLogGroups",
          "logs:DescribeLogStreams"
        ]
        Resource = [
          "arn:aws:logs:*:*:log-group:casey-backend-aws-usage",
          "arn:aws:logs:*:*:log-group:casey-backend-aws-usage:*"
        ]
      }
    ]
  })
}

# Attach policy to existing local development service account
data "aws_iam_user" "casey_localdev_service" {
  user_name = "casey_localdev_service"
}

resource "aws_iam_user_policy_attachment" "casey_localdev_service" {
  user       = data.aws_iam_user.casey_localdev_service.user_name
  policy_arn = aws_iam_policy.casey_backend.arn
}
