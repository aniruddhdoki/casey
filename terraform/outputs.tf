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
  value       = "Use ${var.service_account_iam_user_name} credentials (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY). Set AWS_REGION=${var.aws_region} in .env"
}

output "cloudwatch_log_group" {
  description = "CloudWatch log group name for AWS service usage logging"
  value       = aws_cloudwatch_log_group.casey_backend_aws_usage.name
}

output "cloudwatch_log_group_arn" {
  description = "ARN of the CloudWatch log group"
  value       = aws_cloudwatch_log_group.casey_backend_aws_usage.arn
}

output "ecr_repository_url" {
  description = "ECR repository URL for backend image"
  value       = aws_ecr_repository.backend.repository_url
}

output "ecs_cluster_name" {
  description = "ECS cluster name"
  value       = aws_ecs_cluster.backend.name
}

output "ecs_service_name" {
  description = "ECS service name"
  value       = aws_ecs_service.backend.name
}

output "enable_alb" {
  description = "Whether ALB is enabled (backend URL comes from ALB vs task IP)"
  value       = var.enable_alb
}

output "alb_dns_name" {
  description = "ALB DNS name for backend endpoint (only when enable_alb is true)"
  value       = var.enable_alb ? aws_lb.backend[0].dns_name : ""
}

output "alb_http_url" {
  description = "HTTP URL for backend (only when enable_alb is true)"
  value       = var.enable_alb ? "http://${aws_lb.backend[0].dns_name}" : ""
}

output "recommended_ws_url" {
  description = "Recommended WebSocket endpoint for NEXT_PUBLIC_WS_URL (when enable_alb: ALB; else run scripts/get-backend-url.sh)"
  value       = var.enable_alb ? "wss://${aws_lb.backend[0].dns_name}/ws" : ""
}

output "backend_url_instructions" {
  description = "When ALB is disabled: run ./scripts/get-backend-url.sh to get the current task IP and WebSocket URL"
  value       = var.enable_alb ? "" : "ALB disabled. Run ./scripts/get-backend-url.sh to get task public IP and set NEXT_PUBLIC_WS_URL=wss://<IP>:3001/ws"
}
