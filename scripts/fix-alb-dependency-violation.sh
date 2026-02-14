#!/usr/bin/env bash
# Fix DependencyViolation when switching from enable_alb=true to false
# This script performs a two-step Terraform apply to resolve the issue

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TERRAFORM_DIR="${SCRIPT_DIR}/../terraform"

# Load Terraform/admin credentials from terraform/.env when present
if [ -f "${TERRAFORM_DIR}/.env" ]; then
  set -a
  # shellcheck source=terraform/.env
  source "${TERRAFORM_DIR}/.env"
  set +a
fi

echo -e "${BLUE}Fixing ALB DependencyViolation issue...${NC}"
echo -e "${YELLOW}This script performs a two-step apply:${NC}"
echo -e "${YELLOW}  1. Update ECS security group (removes ALB reference)${NC}"
echo -e "${YELLOW}  2. Apply remaining changes (destroys ALB resources)${NC}"
echo ""

cd "$TERRAFORM_DIR"

if [ ! -d ".terraform" ]; then
  echo "Initializing Terraform..."
  terraform init
fi

echo "Refreshing Terraform state..."
terraform refresh -input=false

echo -e "\n${BLUE}Step 1: Updating ECS security group first...${NC}"
echo -e "${YELLOW}This removes the reference to the ALB security group${NC}"
terraform apply -target=aws_security_group.ecs

echo -e "\n${BLUE}Step 2: Applying remaining changes...${NC}"
echo -e "${YELLOW}This will destroy ALB resources now that the dependency is removed${NC}"
terraform apply

echo -e "\n${GREEN}✓ DependencyViolation issue resolved!${NC}"
