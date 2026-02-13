# CloudWatch Log Group for AWS service usage logging
resource "aws_cloudwatch_log_group" "casey_backend_aws_usage" {
  name              = "casey-backend-aws-usage"
  retention_in_days = 30 # Keep logs for 30 days (adjust as needed)

  tags = {
    Name        = "casey-backend-aws-usage"
    Environment = "development"
    Service     = "casey-backend"
  }
}
