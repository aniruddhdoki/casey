# Terraform: casey AWS Resources

Provisions IAM policy and attaches it to `casey_localdev_service` for backend development.

## Prerequisites

- Terraform installed
- AWS CLI configured with credentials for a principal that can create IAM policies and attach them to users (e.g. your admin IAM user)

## Configure AWS credentials for Terraform

Use your admin IAM user credentials when running Terraform. Choose one:

### Option A: .env file (recommended for local development)

1. Copy `.env.example` to `.env` (if it exists) or create `.env` in the `terraform/` directory
2. Edit `.env` and add your admin AWS credentials:
   ```bash
   AWS_REGION=us-east-1
   AWS_ACCESS_KEY_ID=your_admin_access_key_id
   AWS_SECRET_ACCESS_KEY=your_admin_secret_access_key
   ```
3. Source the file before running Terraform:
   ```bash
   source .env
   terraform plan
   terraform apply
   ```

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

```bash
cd terraform
terraform init
terraform plan    # Review changes
terraform apply   # Type 'yes' to confirm
```

## What gets created

- **IAM policy** `casey-backend-ai` – Transcribe, Bedrock, Polly permissions
- **Policy attachment** – Attached to existing user `casey_localdev_service`

The `casey_localdev_service` IAM user must already exist. Terraform does not create it.

## Local development (backend)

After `terraform apply`, use `casey_localdev_service` credentials to run the backend:

```bash
# In backend/.env or environment
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=<casey_localdev_service access key>
AWS_SECRET_ACCESS_KEY=<casey_localdev_service secret key>
```

Or configure an AWS profile that uses those credentials and set `AWS_PROFILE=casey_localdev_service` (or whatever profile name you use for it).
