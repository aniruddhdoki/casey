# Terraform: casey AWS Resources

Provisions IAM, CloudWatch, ECR, ECS Fargate, and ALB resources for running the backend in production, while still supporting local development with a service account.

## Admin vs Service Account

Terraform uses two distinct AWS principals:

| Account | Purpose | When used |
|---------|---------|-----------|
| **casey_aniruddh** (admin) | Runs `terraform plan` and `terraform apply`; creates IAM policies, ECR, ECS, ALB, CloudWatch, etc. | Only when applying Terraform and when running `deploy.sh` |
| **casey_localdev_service** (service account) | Runs the casey backend at runtime; calls Transcribe, Bedrock, Polly, CloudWatch Logs | Only when the backend is running (ECS tasks or local dev) |

**Important:** The service account must never be used to run Terraform. The admin account must never be used by the backend. Keep these credentials separate.

Terraform manages an IAM policy (`casey-terraform-admin`) that is attached to **casey_aniruddh**, granting the ability to create and manage ECR, ECS, **Application Load Balancers**, security groups, IAM policies/roles, CloudWatch log groups, and Application Auto Scaling. The first time you run Terraform, casey_aniruddh must already have permission to create IAM policies and attach them to users (e.g. via a broad policy or one-time manual attach); after that, Terraform keeps the admin policy up to date.

## Prerequisites

- Terraform installed
- AWS CLI configured with credentials for a principal that can create IAM policies, attach them to users, and create CloudWatch log groups (your admin IAM user)

## Configure AWS credentials for Terraform

Use the **casey_aniruddh** (admin) IAM user credentials when running Terraform. Choose one:

### Option A: .env file (recommended; used by deploy.sh)

1. Copy `.env.example` to `.env` in the `terraform/` directory:
   ```bash
   cp .env.example .env
   ```
2. Edit `.env` and add your **casey_aniruddh** AWS credentials:
   ```bash
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=<casey_aniruddh access key>
   AWS_SECRET_ACCESS_KEY=<casey_aniruddh secret key>
   ```
3. When running Terraform manually, source the file first:
   ```bash
   source .env
   terraform plan
   terraform apply
   ```
   The root `deploy.sh` script automatically sources `terraform/.env` if it exists, so you do not need to source it when using `./deploy.sh`.

**Note:** The `.env` file is gitignored and will not be committed to the repository.

### Option B: AWS CLI default profile

```bash
aws configure
# Enter your admin IAM user's Access Key ID and Secret Access Key
# Default region: us-east-1
```

### Option C: Named profile

```bash
aws configure --profile casey-admin
# Enter your admin IAM user's Access Key ID and Secret Access Key
```

Then when running Terraform:

```bash
export AWS_PROFILE=casey-admin
```

### Option D: Environment variables

```bash
export AWS_ACCESS_KEY_ID=your_admin_access_key
export AWS_SECRET_ACCESS_KEY=your_admin_secret_key
export AWS_REGION=us-east-1
```

## Deploy

From the repo root, `./deploy.sh` runs Terraform with state refresh and shows which AWS account is used. Manually:

```bash
cd terraform
source .env   # or use AWS_PROFILE for casey_aniruddh
terraform init
terraform refresh -input=false   # Update local state from AWS
terraform plan                   # Review changes
terraform apply                  # Type 'yes' to confirm
```

### Important deployment variables

- **enable_alb** (default: `false`) – When your AWS account does not support creating load balancers yet, keep this false. The backend is then reachable via the ECS task public IP; after deploy, run `./scripts/get-backend-url.sh` to get the current task IP and set `NEXT_PUBLIC_WS_URL=ws://<IP>:3001/ws`. When your account is approved for ALB, set `enable_alb=true` and apply to create the ALB and use its stable URL.

You can override defaults as needed:

```bash
# With ALB (once account supports it)
terraform apply -var="enable_alb=true" \
  -var="environment=production" \
  -var="alb_certificate_arn=arn:aws:acm:us-east-1:123456789012:certificate/your-cert-id"

# Without ALB (default)
terraform apply   # then run ./scripts/get-backend-url.sh to get task IP
```

Optional network overrides:

- `vpc_id` (default: uses default VPC)
- `subnet_ids` (default: uses all subnets in selected/default VPC)

## What gets created

- **IAM policy** `casey-backend-ai` – Transcribe, Bedrock, Polly, CloudWatch Logs permissions (including `bedrock:GetInferenceProfile` for inference profiles)
- **Policy attachment** – Attached to the service account IAM user (default: `casey_localdev_service`)
- **IAM policy** `casey-terraform-admin` – ECR, ECS, **Application Load Balancers**, security groups, IAM, CloudWatch, Application Auto Scaling; attached to the Terraform admin user (default: `casey_aniruddh`)
- **CloudWatch log group** `casey-backend-aws-usage`
- **ECR repository** for backend Docker images
- **ECS cluster + Fargate service** for running backend tasks
- **Task roles** (execution role + backend task role attached to `casey-backend-ai`)
- **Application Load Balancer** (only when `enable_alb` is true) with sticky sessions
- **Security groups** for ECS tasks (and for ALB when enabled)
- **ECS CloudWatch log group** (`/ecs/casey-backend` by default)

`terraform output` includes:

- `ecr_repository_url`
- `ecs_cluster_name`
- `ecs_service_name`
- `alb_dns_name`
- `recommended_ws_url`

The service account IAM user must already exist. Terraform does not create it. Override the default with `-var="service_account_iam_user_name=your_service_user"` if needed.

## Local development (backend)

After `terraform apply`, run the backend with the **service account** credentials (not the admin credentials):

```bash
# In backend/.env or environment
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<service account access key>
AWS_SECRET_ACCESS_KEY=<service account secret key>
```

Or configure an AWS profile that uses the service account credentials and set `AWS_PROFILE` to that profile name.

**Credentials separation:** Do not use the same credentials for Terraform and for the backend. Terraform should use admin credentials; the backend should use the service account credentials.

## Container build and ECS deploy flow

After Terraform creates infrastructure, deploy backend images with this minimal flow:

```bash
# 1) Read outputs
ECR_REPO_URL=$(terraform output -raw ecr_repository_url)
ECS_CLUSTER=$(terraform output -raw ecs_cluster_name)
ECS_SERVICE=$(terraform output -raw ecs_service_name)
AWS_REGION=$(terraform output -raw aws_region)

# 2) Authenticate Docker to ECR
aws ecr get-login-password --region "$AWS_REGION" \
  | docker login --username AWS --password-stdin "${ECR_REPO_URL%/*}"

# 3) Build and push backend image
docker build --platform linux/amd64 -t "$ECR_REPO_URL:latest" ../backend
docker push "$ECR_REPO_URL:latest"

# 4) Force ECS service rollout to pick up latest image tag
aws ecs update-service \
  --cluster "$ECS_CLUSTER" \
  --service "$ECS_SERVICE" \
  --force-new-deployment \
  --region "$AWS_REGION"
```

You can replace `latest` with immutable tags and pass `-var="backend_container_image=<repo>:<tag>"` in Terraform for stricter versioning.

## Frontend production wiring

Use the backend endpoint from ALB/custom domain for frontend builds:

```bash
NEXT_PUBLIC_WS_URL=wss://api.casey.com/ws
```

If you are testing before DNS setup, you can temporarily use:

```bash
NEXT_PUBLIC_WS_URL=wss://$(terraform output -raw alb_dns_name)/ws
```

Set this variable in your frontend deployment platform (for example Vercel) and redeploy the frontend so the build points to the production backend.

### When ALB is disabled (enable_alb = false)

Backend URL is the current ECS task public IP (it can change after each deploy). After deploying, run from repo root:

```bash
./scripts/get-backend-url.sh
```

Use the printed `BACKEND_WS_URL` (e.g. `ws://1.2.3.4:3001/ws`) as `NEXT_PUBLIC_WS_URL` in your frontend. Re-run the script after each deploy to get the new IP if the task was replaced.

## Troubleshooting

### Resources already exist (log group, IAM policy)

If apply fails because the log group or IAM policy already exists, you can import them in one go:

```bash
./scripts/terraform-import-existing.sh
```

Then run `./deploy.sh` or `terraform apply` again. Or import manually as below.

### ResourceAlreadyExistsException: log group already exists

If `casey-backend-aws-usage` was created outside Terraform (or by a previous partial apply), import it:

```bash
cd terraform
source .env   # or use AWS_PROFILE
terraform import aws_cloudwatch_log_group.casey_backend_aws_usage casey-backend-aws-usage
```

Then run `terraform plan` / `terraform apply` again.

### EntityAlreadyExists: IAM policy casey-backend-ai already exists

If the policy was created outside Terraform, import it (replace `ACCOUNT_ID` with your AWS account ID, e.g. `640641419062`):

```bash
terraform import aws_iam_policy.casey_backend arn:aws:iam::ACCOUNT_ID:policy/casey-backend-ai
```

To get the ARN: `aws iam list-policies --scope Local --query "Policies[?PolicyName=='casey-backend-ai'].Arn" --output text`

### OperationNotPermitted: This AWS account currently does not support creating load balancers

This is an **account-level** restriction from AWS, not an IAM permission issue. New or restricted accounts may have ELB/ALB disabled.

- **Fix:** Open a case with [AWS Support](https://console.aws.amazon.com/support/) and request that your account be enabled for creating Application Load Balancers (ELBv2). There is no Terraform or IAM change that can bypass this.
- Until then, the rest of the stack (ECR, ECS, IAM, CloudWatch) can still be created after importing any existing resources and optionally commenting out or removing the ALB-related resources if you want to apply without ALB.
