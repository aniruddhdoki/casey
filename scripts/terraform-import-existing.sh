#!/usr/bin/env bash
# Import existing AWS resources into Terraform state so apply can succeed.
# Run from repo root after a failed apply due to ResourceAlreadyExistsException or EntityAlreadyExists.
# Usage: ./scripts/terraform-import-existing.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/terraform"

if [ -f "${TERRAFORM_DIR}/.env" ]; then
  set -a
  source "${TERRAFORM_DIR}/.env"
  set +a
fi

cd "$TERRAFORM_DIR"

echo "Importing existing resources into Terraform state..."

# CloudWatch log group (if it exists in AWS and is not in state)
if terraform state show aws_cloudwatch_log_group.casey_backend_aws_usage &>/dev/null; then
  echo "  casey_backend_aws_usage already in state, skip."
else
  if aws logs describe-log-groups --log-group-name-prefix casey-backend-aws-usage --query 'logGroups[?logGroupName==`casey-backend-aws-usage`].logGroupName' --output text 2>/dev/null | grep -q casey-backend-aws-usage; then
    echo "  Importing aws_cloudwatch_log_group.casey_backend_aws_usage..."
    terraform import aws_cloudwatch_log_group.casey_backend_aws_usage casey-backend-aws-usage
  else
    echo "  Log group casey-backend-aws-usage not found in AWS, skip."
  fi
fi

# IAM policy casey-backend-ai (if it exists in AWS and is not in state)
if terraform state show aws_iam_policy.casey_backend &>/dev/null; then
  echo "  casey_backend (policy) already in state, skip."
else
  POLICY_ARN=$(aws iam list-policies --scope Local --query "Policies[?PolicyName=='casey-backend-ai'].Arn" --output text 2>/dev/null || true)
  if [ -n "$POLICY_ARN" ]; then
    echo "  Importing aws_iam_policy.casey_backend..."
    terraform import aws_iam_policy.casey_backend "$POLICY_ARN"
  else
    echo "  IAM policy casey-backend-ai not found in AWS, skip."
  fi
fi

echo "Done. Run ./deploy.sh or terraform plan/apply again."
