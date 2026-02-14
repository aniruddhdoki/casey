#!/usr/bin/env bash
# Deploy casey backend to AWS ECS Fargate
# This script handles Terraform infrastructure, Docker build/push, and ECS service updates

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/terraform"
BACKEND_DIR="${SCRIPT_DIR}/backend"

# Load Terraform/admin credentials (casey_aniruddh) from terraform/.env when present
if [ -f "${TERRAFORM_DIR}/.env" ]; then
  set -a
  # shellcheck source=terraform/.env
  source "${TERRAFORM_DIR}/.env"
  set +a
fi

# Defaults
SKIP_TERRAFORM=false
IMAGE_TAG="latest"
TERRAFORM_AUTO_APPROVE=false

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --skip-terraform)
      SKIP_TERRAFORM=true
      shift
      ;;
    --image-tag)
      IMAGE_TAG="$2"
      shift 2
      ;;
    --auto-approve)
      TERRAFORM_AUTO_APPROVE=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --skip-terraform    Skip Terraform apply (use existing infrastructure)"
      echo "  --image-tag TAG     Docker image tag (default: latest)"
      echo "  --auto-approve      Auto-approve Terraform apply (no confirmation prompt)"
      echo "  --help              Show this help message"
      exit 0
      ;;
    *)
      echo -e "${RED}Unknown option: $1${NC}"
      echo "Run $0 --help for usage"
      exit 1
      ;;
  esac
done

# Check prerequisites
echo -e "${BLUE}Checking prerequisites...${NC}"

check_command() {
  if ! command -v "$1" &> /dev/null; then
    echo -e "${RED}Error: $1 is not installed${NC}"
    exit 1
  fi
}

check_command terraform
check_command aws
check_command docker

# Check AWS credentials and show which account is used for Terraform
if ! aws sts get-caller-identity &> /dev/null; then
  echo -e "${RED}Error: AWS credentials not configured${NC}"
  echo "Terraform and this script use the administrative account (casey_aniruddh)."
  echo "Copy terraform/.env.example to terraform/.env and set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY,"
  echo "or configure with: aws configure / AWS_PROFILE"
  exit 1
fi

CALLER_ARN=$(aws sts get-caller-identity --query Arn --output text)
CALLER_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
CALLER_USER=$(aws sts get-caller-identity --query UserId --output text)
echo -e "${GREEN}✓ Prerequisites check passed${NC}"
echo -e "${BLUE}Terraform/AWS operations will use:${NC}"
echo -e "  Account: ${CALLER_ACCOUNT}"
echo -e "  ARN:     ${CALLER_ARN}"
echo -e "  UserId:  ${CALLER_USER}"

# Step 1: Terraform apply (if not skipped)
if [ "$SKIP_TERRAFORM" = false ]; then
  echo -e "\n${BLUE}Step 1: Applying Terraform infrastructure...${NC}"
  cd "$TERRAFORM_DIR"
  
  if [ ! -d ".terraform" ]; then
    echo "Initializing Terraform..."
    terraform init
  fi

  echo "Refreshing Terraform state..."
  terraform refresh -input=false

  echo "Planning Terraform changes..."
  terraform plan -out=tfplan
  
  if [ "$TERRAFORM_AUTO_APPROVE" = true ]; then
    echo "Applying Terraform changes (auto-approved)..."
    terraform apply tfplan
  else
    echo -e "${YELLOW}Review the plan above. Apply? (y/N)${NC}"
    read -r response
    if [[ "$response" =~ ^[Yy]$ ]]; then
      terraform apply tfplan
    else
      echo "Terraform apply cancelled"
      exit 1
    fi
  fi
  
  rm -f tfplan
else
  echo -e "\n${YELLOW}Step 1: Skipping Terraform (using existing infrastructure)${NC}"
fi

# Step 2: Get Terraform outputs
echo -e "\n${BLUE}Step 2: Reading Terraform outputs...${NC}"
cd "$TERRAFORM_DIR"

ECR_REPO_URL=$(terraform output -raw ecr_repository_url)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name)
ECS_SERVICE=$(terraform output -raw ecs_service_name)
AWS_REGION=$(terraform output -raw aws_region)
ENABLE_ALB=$(terraform output -raw enable_alb)

echo -e "${GREEN}✓ ECR Repository: ${ECR_REPO_URL}${NC}"
echo -e "${GREEN}✓ ECS Cluster: ${ECS_CLUSTER}${NC}"
echo -e "${GREEN}✓ ECS Service: ${ECS_SERVICE}${NC}"
echo -e "${GREEN}✓ AWS Region: ${AWS_REGION}${NC}"
echo -e "${GREEN}✓ ALB enabled: ${ENABLE_ALB}${NC}"

if [ "$ENABLE_ALB" = "true" ]; then
  ALB_DNS=$(terraform output -raw alb_dns_name)
  WS_URL=$(terraform output -raw recommended_ws_url)
else
  echo -e "\n${BLUE}Resolving backend task public IP (ALB disabled)...${NC}"
  # Source the script to export BACKEND_IP, BACKEND_WS_URL, BACKEND_HTTP_URL
  set +e
  # shellcheck source=scripts/get-backend-url.sh
  source "${SCRIPT_DIR}/scripts/get-backend-url.sh"
  set -e
  if [ -z "${BACKEND_IP:-}" ]; then
    echo -e "${YELLOW}Could not get task IP yet (service may still be starting). Run: ./scripts/get-backend-url.sh${NC}"
    WS_URL=""
    ALB_DNS=""
  else
    WS_URL="$BACKEND_WS_URL"
    ALB_DNS="${BACKEND_IP}:3001"
  fi
fi

# Step 3: Authenticate Docker to ECR
echo -e "\n${BLUE}Step 3: Authenticating Docker to ECR...${NC}"
ECR_REGISTRY="${ECR_REPO_URL%/*}"
aws ecr get-login-password --region "$AWS_REGION" | \
  docker login --username AWS --password-stdin "$ECR_REGISTRY" || {
  echo -e "${RED}Error: Failed to authenticate Docker to ECR${NC}"
  exit 1
}
echo -e "${GREEN}✓ Docker authenticated to ECR${NC}"

# Step 4: Build Docker image
echo -e "\n${BLUE}Step 4: Building Docker image...${NC}"
IMAGE_URI="${ECR_REPO_URL}:${IMAGE_TAG}"
cd "$BACKEND_DIR"

echo "Building image: ${IMAGE_URI}"
docker build --platform linux/amd64 -t "$IMAGE_URI" . || {
  echo -e "${RED}Error: Docker build failed${NC}"
  exit 1
}
echo -e "${GREEN}✓ Docker image built successfully${NC}"

# Step 5: Push Docker image
echo -e "\n${BLUE}Step 5: Pushing Docker image to ECR...${NC}"
docker push "$IMAGE_URI" || {
  echo -e "${RED}Error: Docker push failed${NC}"
  exit 1
}
echo -e "${GREEN}✓ Docker image pushed to ECR${NC}"

# Step 6: Update ECS service
echo -e "\n${BLUE}Step 6: Updating ECS service...${NC}"
SERVICE_UPDATE=$(aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --region "$AWS_REGION" \
  --query 'service.{serviceName:serviceName,status:status,desiredCount:desiredCount,runningCount:runningCount}' \
  --output json) || {
  echo -e "${RED}Error: Failed to update ECS service${NC}"
  exit 1
}

echo -e "${GREEN}✓ ECS service update initiated${NC}"
echo "$SERVICE_UPDATE" | jq '.'

# Step 7: Wait for deployment to stabilize
echo -e "\n${BLUE}Step 7: Waiting for deployment to stabilize...${NC}"
echo "This may take a few minutes..."

aws ecs wait services-stable \
  --cluster "$ECS_CLUSTER" \
  --services "$ECS_SERVICE" \
  --region "$AWS_REGION" || {
  echo -e "${YELLOW}Warning: Deployment may still be in progress${NC}"
  echo "Check ECS console for status: https://console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/services/${ECS_SERVICE}"
}

echo -e "${GREEN}✓ Deployment stabilized${NC}"

# Step 8: Summary
echo -e "\n${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo -e "${GREEN}           Deployment Complete!${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}Backend Endpoints:${NC}"
if [ "$ENABLE_ALB" = "true" ]; then
  echo -e "  HTTP:  http://${ALB_DNS}"
  echo -e "  HTTPS: https://${ALB_DNS}"
  echo -e "  WS:    ${WS_URL}"
  echo ""
  echo -e "${BLUE}Health Check:${NC}"
  echo -e "  http://${ALB_DNS}/health"
else
  if [ -n "${WS_URL:-}" ] && [ -n "${BACKEND_HTTP_URL:-}" ]; then
    echo -e "  HTTP:  ${BACKEND_HTTP_URL}"
    echo -e "  WS:    ${WS_URL}"
    echo ""
    echo -e "${BLUE}Health Check:${NC}"
    echo -e "  ${BACKEND_HTTP_URL}/health"
  else
    echo -e "  Run ./scripts/get-backend-url.sh to get task IP and URLs"
  fi
fi
echo ""
echo -e "${BLUE}Frontend Configuration:${NC}"
if [ -n "${WS_URL:-}" ]; then
  echo -e "  Set NEXT_PUBLIC_WS_URL=${WS_URL} in your frontend deployment"
else
  echo -e "  After task is running: ./scripts/get-backend-url.sh then set NEXT_PUBLIC_WS_URL"
fi
echo ""
echo -e "${BLUE}ECS Console:${NC}"
echo -e "  https://console.aws.amazon.com/ecs/v2/clusters/${ECS_CLUSTER}/services/${ECS_SERVICE}"
echo ""
echo -e "${BLUE}CloudWatch Logs:${NC}"
echo -e "  https://console.aws.amazon.com/cloudwatch/home?region=${AWS_REGION}#logsV2:log-groups/log-group/\$252Fecs\$252F${ECS_CLUSTER%-cluster}-backend"
echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════════════${NC}"
