#!/usr/bin/env bash
# Resolve the current ECS task public IP and print backend/WebSocket URLs.
# Use when enable_alb is false. Run from repo root after deploy.
# Exports BACKEND_IP, BACKEND_HTTP_URL, BACKEND_WS_URL for use by deploy.sh or manually.

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
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name)
ECS_SERVICE=$(terraform output -raw ecs_service_name)
AWS_REGION=$(terraform output -raw aws_region)
BACKEND_PORT="${BACKEND_PORT:-3001}"

TASK_ARN=$(aws ecs list-tasks \
  --cluster "$ECS_CLUSTER" \
  --service-name "$ECS_SERVICE" \
  --desired-status RUNNING \
  --query 'taskArns[0]' \
  --output text \
  --region "$AWS_REGION")

if [ -z "$TASK_ARN" ] || [ "$TASK_ARN" = "None" ]; then
  echo "No running task found for service $ECS_SERVICE. Start the service or wait for it to stabilize." >&2
  exit 1
fi

ENI_ID=$(aws ecs describe-tasks \
  --cluster "$ECS_CLUSTER" \
  --tasks "$TASK_ARN" \
  --query 'tasks[0].attachments[0].details[?name==`networkInterfaceId`].value | [0]' \
  --output text \
  --region "$AWS_REGION")

if [ -z "$ENI_ID" ] || [ "$ENI_ID" = "None" ]; then
  echo "Could not get network interface for task." >&2
  exit 1
fi

BACKEND_IP=$(aws ec2 describe-network-interfaces \
  --network-interface-ids "$ENI_ID" \
  --query 'NetworkInterfaces[0].Association.PublicIp' \
  --output text \
  --region "$AWS_REGION")

if [ -z "$BACKEND_IP" ] || [ "$BACKEND_IP" = "None" ]; then
  echo "Task has no public IP (e.g. in private subnet). assign_public_ip must be true for no-ALB mode." >&2
  exit 1
fi

export BACKEND_IP
export BACKEND_HTTP_URL="http://${BACKEND_IP}:${BACKEND_PORT}"
export BACKEND_WS_URL="ws://${BACKEND_IP}:${BACKEND_PORT}/ws"

echo "BACKEND_IP=$BACKEND_IP"
echo "BACKEND_HTTP_URL=$BACKEND_HTTP_URL"
echo "BACKEND_WS_URL=$BACKEND_WS_URL"
echo ""
echo "Set in your frontend deployment:"
echo "  NEXT_PUBLIC_WS_URL=$BACKEND_WS_URL"
echo ""
echo "Health check: ${BACKEND_HTTP_URL}/health"
