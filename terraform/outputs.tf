output "aws_region" {
  description = "AWS region used for services"
  value       = var.aws_region
}

output "policy_arn" {
  description = "ARN of the IAM policy for casey backend"
  value       = aws_iam_policy.casey_backend.arn
}

output "credentials_instructions" {
  description = "Instructions for configuring credentials"
  value       = "Use casey_localdev_service credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). Set AWS_REGION=${var.aws_region} in .env"
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group for backend logging"
  value       = aws_cloudwatch_log_group.casey_backend_logs.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch log group for backend logging"
  value       = aws_cloudwatch_log_group.casey_backend_logs.arn
}

output "cloudwatch_log_group_name" {
  description = "Name of the CloudWatch log group for backend AWS service usage"
  value       = aws_cloudwatch_log_group.casey_backend_logs.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.casey_backend_logs.arn
}
