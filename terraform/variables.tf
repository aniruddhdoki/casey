variable "aws_region" {
  description = "AWS region for Transcribe, Bedrock, Polly"
  type        = string
  default     = "us-east-1"
}

variable "service_account_iam_user_name" {
  description = "IAM user name for the service account that runs the backend (e.g. casey_localdev_service, casey_prod_service)"
  type        = string
  default     = "casey_localdev_service"
}

variable "terraform_admin_iam_user_name" {
  description = "IAM user name for the Terraform admin (e.g. casey_aniruddh). This user runs Terraform and deploy.sh and must be able to create ECR, ECS, ALB, IAM, and related resources."
  type        = string
  default     = "casey_aniruddh"
}

variable "project_name" {
  description = "Project name used in resource naming"
  type        = string
  default     = "casey"
}

variable "environment" {
  description = "Environment name (e.g. development, staging, production)"
  type        = string
  default     = "production"
}

variable "vpc_id" {
  description = "VPC ID for ALB/ECS. Leave empty to use default VPC."
  type        = string
  default     = ""
}

variable "subnet_ids" {
  description = "Subnet IDs for ALB/ECS. Leave empty to use all subnets in the selected VPC."
  type        = list(string)
  default     = []
}

variable "alb_allowed_cidrs" {
  description = "CIDR blocks allowed to access the ALB"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

variable "enable_alb" {
  description = "Create Application Load Balancer in front of ECS. Set to false if your AWS account does not support ALB yet; backend will be reachable via ECS task public IP (run scripts/get-backend-url.sh to get URL)."
  type        = bool
  default     = false
}

variable "alb_certificate_arn" {
  description = "ACM certificate ARN for HTTPS on ALB. Leave empty to run HTTP only. Only used when enable_alb is true."
  type        = string
  default     = ""
}

variable "backend_container_port" {
  description = "Container port exposed by backend service"
  type        = number
  default     = 3001
}

variable "backend_healthcheck_path" {
  description = "Health check path for ALB target group"
  type        = string
  default     = "/health"
}

variable "ecs_task_cpu" {
  description = "Fargate task CPU units"
  type        = number
  default     = 512
}

variable "ecs_task_memory" {
  description = "Fargate task memory (MiB)"
  type        = number
  default     = 1024
}

variable "ecs_service_desired_count" {
  description = "Desired task count for ECS service"
  type        = number
  default     = 1
}

variable "ecs_assign_public_ip" {
  description = "Whether to assign public IPs to ECS tasks"
  type        = bool
  default     = true
}

variable "backend_container_image" {
  description = "Optional full container image URI (including tag). Leave empty to use ECR latest."
  type        = string
  default     = ""
}

variable "enable_autoscaling" {
  description = "Enable ECS service autoscaling based on CPU"
  type        = bool
  default     = true
}

variable "autoscaling_min_capacity" {
  description = "Minimum ECS service desired count when autoscaling is enabled"
  type        = number
  default     = 1
}

variable "autoscaling_max_capacity" {
  description = "Maximum ECS service desired count when autoscaling is enabled"
  type        = number
  default     = 5
}

variable "autoscaling_cpu_target" {
  description = "Target CPU utilization percentage for ECS autoscaling"
  type        = number
  default     = 60
}
