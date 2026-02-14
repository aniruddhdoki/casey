#!/usr/bin/env bash
# Quick backend container update (assumes infrastructure already exists)
# For full deployment including Terraform, use ../deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TERRAFORM_DIR="${REPO_ROOT}/terraform"
BACKEND_DIR="${REPO_ROOT}/backend"

# Use admin account (casey_aniruddh) from terraform/.env when present
if [ -f "${TERRAFORM_DIR}/.env" ]; then
  set -a
  # shellcheck source=../terraform/.env
  source "${TERRAFORM_DIR}/.env"
  set +a
fi

IMAGE_TAG="${1:-latest}"

cd "$TERRAFORM_DIR"

# Get outputs
ECR_REPO_URL=$(terraform output -raw ecr_repository_url)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name)
ECS_SERVICE=$(terraform output -raw ecs_service_name)
AWS_REGION=$(terraform output -raw aws_region)

# Authenticate
ECR_REGISTRY="${ECR_REPO_URL%/*}"
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY"

# Build and push
IMAGE_URI="${ECR_REPO_URL}:${IMAGE_TAG}"
cd "$BACKEND_DIR"
docker build --platform linux/amd64 -t "$IMAGE_URI" .
docker push "$IMAGE_URI"

# Update service
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --region "$AWS_REGION" > /dev/null

echo "✓ Backend updated. Deployment in progress..."
