# Deployment and Architecture Context

Compressed context from the deployment and architecture work on the casey backend and frontend.

---

## 1. Project Overview

- **Frontend:** Next.js on Vercel; 3D avatar + WebRTC client for interview flow. Connects to backend via WebSocket for signaling and WebRTC for audio/visemes.
- **Backend:** Node (Express + `ws` + `@roamhq/wrtc`). One agent runtime per WebSocket connection; cleans up on `ws.on('close')`. Uses AWS Transcribe, Bedrock, Polly, CloudWatch.
- **Terraform:** IAM, CloudWatch, ECR, ECS Fargate, optional ALB. Two accounts: **casey_aniruddh** (Terraform admin), **casey_localdev_service** (backend runtime).

---

## 2. Frontend → Backend URL (Production)

- **Env:** `NEXT_PUBLIC_WS_URL` (build-time). If set, frontend uses it for WebSocket; else in dev uses `ws://localhost:3001/ws`, in prod falls back to same-origin `/ws`.
- **Files:** [frontend/lib/useInterviewWebRTC.ts](frontend/lib/useInterviewWebRTC.ts) — `normalizeWsUrl()`; supports `http`/`https` → `ws`/`wss` and appends `/ws` if missing.
- **Production:** Set `NEXT_PUBLIC_WS_URL=wss://<backend-host>/ws` in Vercel (or wherever) and redeploy.

---

## 3. Backend Deployment (ECS, Docker, Deploy Script)

- **Docker:** [backend/Dockerfile](backend/Dockerfile) (Node 20, native build for `@roamhq/wrtc`), [backend/.dockerignore](backend/.dockerignore).
- **Health:** `GET /health` returns `200` with `{ status: 'ok' }`; Terraform ALB health check uses `/health` when ALB is enabled.
- **Deploy script:** [deploy.sh](deploy.sh) — sources `terraform/.env` (casey_aniruddh), checks prerequisites, prints caller identity, runs `terraform refresh` then `plan`/`apply`, builds/pushes image, updates ECS service, waits for stable, prints summary. Options: `--skip-terraform`, `--image-tag`, `--auto-approve`.
- **Quick update:** [scripts/deploy-backend.sh](scripts/deploy-backend.sh) — container-only deploy when infra exists; also sources `terraform/.env`.

---

## 4. Terraform Accounts and Credentials

- **Admin (Terraform / deploy.sh):** **casey_aniruddh**. Credentials in `terraform/.env` (from `terraform/.env.example`: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`). Never use for running the backend.
- **Service (backend runtime):** **casey_localdev_service**. IAM policy `casey-backend-ai` (Transcribe, Bedrock, Polly, CloudWatch) attached via Terraform; used by ECS task role or local backend.
- **Terraform state:** `terraform refresh` only updates state for resources already in state; it does not discover existing AWS resources. For resources created outside Terraform (e.g. log group, IAM policy), use **import**: `terraform import <resource> <id>` or [scripts/terraform-import-existing.sh](scripts/terraform-import-existing.sh).

---

## 5. Terraform Refresh and Caller Identity

- **Refresh:** Deploy script runs `terraform refresh -input=false` before `plan` so local state matches AWS.
- **Caller:** After credential check, deploy script prints Account, ARN, and UserId from `aws sts get-caller-identity` so you confirm Terraform is using casey_aniruddh.

---

## 6. IAM: Terraform Admin and Load Balancers

- **casey_aniruddh** must be able to create load balancers (and the rest of the stack). Terraform manages [terraform/iam_admin.tf](terraform/iam_admin.tf): policy **casey-terraform-admin** (ECR, ECS, **elasticloadbalancing**, EC2 security groups/VPC, IAM policy/role, CloudWatch Logs, Application Auto Scaling) attached to the user in `var.terraform_admin_iam_user_name` (default `casey_aniruddh`).
- First apply still requires casey_aniruddh to have some baseline permission to create IAM policies and attach them; after that Terraform keeps the admin policy in sync.

---

## 7. ALB Account Restriction and Alternatives

- **Error:** `This AWS account currently does not support creating load balancers` — account-level AWS restriction, not IAM. Fix: open a case with AWS Support to enable ELB/ALB for the account.
- **Alternatives to ALB:** (1) Direct ECS task public IP (implemented when ALB disabled); (2) NLB if allowed; (3) API Gateway WebSocket + Lambda for signaling only (media/agent still need long-lived server); (4) App Runner (verify WebSocket support); (5) EC2 + Elastic IP for stable URL; (6) Tunnels (e.g. ngrok) for dev.

---

## 8. Lambda Per Connection

- **Not viable** for this server: WebRTC needs a long-lived process holding the PeerConnection; Lambda has a 15-minute max and is invocation-based. Lambda can handle **signaling only** (API Gateway WebSocket + Lambda per connectionId); the actual media and agent must run in a long-lived process (ECS/EC2).

---

## 9. No-ALB Mode (enable_alb = false)

- **Variable:** [terraform/variables.tf](terraform/variables.tf) — `enable_alb` (default **false**). When false, no ALB, target group, or listeners; ECS security group allows ingress from `0.0.0.0/0` on backend port (direct task access).
- **Conditional resources:** [terraform/ecs.tf](terraform/ecs.tf) — `aws_security_group.alb`, `aws_lb`, `aws_lb_target_group`, `aws_lb_listener.*` have `count = var.enable_alb ? 1 : 0`. ECS service uses `dynamic "load_balancer"` only when `enable_alb`.
- **Outputs:** [terraform/outputs.tf](terraform/outputs.tf) — `alb_dns_name`, `recommended_ws_url` etc. are empty when ALB disabled; `backend_url_instructions` tells you to run `./scripts/get-backend-url.sh`.
- **Get task IP:** [scripts/get-backend-url.sh](scripts/get-backend-url.sh) — lists ECS running tasks, gets ENI, resolves public IP; exports and prints `BACKEND_IP`, `BACKEND_HTTP_URL`, `BACKEND_WS_URL` and the exact `NEXT_PUBLIC_WS_URL` to set. Run after deploy when ALB is disabled; re-run after redeploys if task IP changes.
- **Deploy script:** When `enable_alb` is false, deploy.sh sources `get-backend-url.sh` after Terraform and uses its output for the summary; if no task IP yet, it tells you to run the script manually.

---

## 10. Switching enable_alb (true → false) and DependencyViolation

- When changing from **enable_alb = true** to **false**, Terraform plans to update the ECS security group (replace ALB-SG ingress with `0.0.0.0/0`) and destroy the ALB SG. AWS may refuse to delete the ALB security group with: **DependencyViolation: resource sg-xxx has a dependent object** — because the ECS SG still has an ingress rule referencing the ALB SG.
- **Workaround:** Run a two-step apply so the ECS SG is updated before any ALB SG destroy:
  1. `terraform apply -target=aws_security_group.ecs` (updates ECS SG to use 0.0.0.0/0, removing reference to ALB SG).
  2. `terraform apply` (destroys ALB, target group, ALB SG).
- Alternatively, ensure Terraform applies the ECS SG update in the same apply and that it is applied before destroy (Terraform usually does updates before destroys; if ordering still fails, use `-target` as above).

---

## 11. File and Doc References

| Topic | Location |
|-------|----------|
| WebSocket URL logic | [frontend/lib/useInterviewWebRTC.ts](frontend/lib/useInterviewWebRTC.ts) |
| Backend server + health | [backend/server.js](backend/server.js) |
| Terraform ECS/ALB | [terraform/ecs.tf](terraform/ecs.tf) |
| Terraform variables | [terraform/variables.tf](terraform/variables.tf) |
| Terraform outputs | [terraform/outputs.tf](terraform/outputs.tf) |
| Admin IAM policy | [terraform/iam_admin.tf](terraform/iam_admin.tf) |
| Deploy script | [deploy.sh](deploy.sh) |
| Get task IP | [scripts/get-backend-url.sh](scripts/get-backend-url.sh) |
| Import existing resources | [scripts/terraform-import-existing.sh](scripts/terraform-import-existing.sh), [terraform/README.md](terraform/README.md) (Troubleshooting) |
| Backend IAM (service) | [terraform/iam.tf](terraform/iam.tf) |

---

## 12. Quick Commands

```bash
# Deploy (Terraform + Docker + ECS); uses terraform/.env
./deploy.sh
./deploy.sh --skip-terraform   # infra only
./deploy.sh --auto-approve

# When ALB disabled: get current task IP and WebSocket URL
./scripts/get-backend-url.sh

# Import existing log group / IAM policy after "already exists" errors
./scripts/terraform-import-existing.sh

# Enable ALB once account is approved
# In terraform: enable_alb = true, or:
terraform apply -var="enable_alb=true"
```

Frontend production: set `NEXT_PUBLIC_WS_URL` to ALB URL (when `enable_alb=true`) or to `ws://<task-ip>:3001/ws` from `get-backend-url.sh` (when `enable_alb=false`), then redeploy the frontend.
