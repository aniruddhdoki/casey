terraform {
  required_version = ">= 1.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# CloudWatch log group for AWS service usage logging
resource "aws_cloudwatch_log_group" "casey_backend_logs" {
  name              = "/aws/casey/backend"
  retention_in_days = 30

  tags = {
    Name        = "casey-backend-logs"
    Environment = "development"
  }
}

# CloudWatch log group for AWS service usage logging
resource "aws_cloudwatch_log_group" "casey_backend_logs" {
  name              = "/aws/casey/backend"
  retention_in_days = 30

  tags = {
    Name        = "casey-backend-logs"
    Environment = "development"
  }
}
