---
name: iam-policy-sync
description: Updates IAM policies in terraform/iam.tf to match backend AWS service usage. Adds necessary permissions when backend uses new AWS SDK clients or API calls. Use when updating Terraform files, adding or changing AWS SDK usage in the backend, or when the user asks to sync or update IAM permissions.
---

# IAM Policy Sync

Keep `terraform/iam.tf` in sync with the backend’s actual AWS usage so the ECS task role and service account have the right permissions.

## When to Run

- Editing any Terraform file (especially `terraform/*.tf`)
- Adding or changing `@aws-sdk/*` usage in `backend/`
- User asks to update IAM, add permissions, or fix access denied errors

## Workflow

1. **Discover backend AWS usage**
   - Read `backend/package.json` for `@aws-sdk/client-*` dependencies.
   - Scan `backend/` code for which client methods are called (e.g. `InvokeModel`, `StartStreamTranscription`, `SynthesizeSpeech`, `PutLogEvents`, `CreateLogGroup`).

2. **Map to IAM actions**
   - Use [reference.md](reference.md) for service prefix and typical actions.
   - Prefer minimal actions (e.g. `transcribe:StartStreamTranscription` not `transcribe:*`) and keep `Resource = "*"` unless the project uses specific ARNs (e.g. log groups).

3. **Update `terraform/iam.tf`**
   - Edit the `aws_iam_policy.casey_backend` policy only. Do not create new policies unless the user asks for a separate role/policy.
   - Preserve existing structure: one `Statement` block per logical permission set, each with a clear `Sid`, `Effect = "Allow"`, `Action` list, and `Resource`.
   - Add a new `Statement` for a new service or a new logical group of actions; add actions to an existing `Statement` when they belong to the same service and resource pattern.
   - After editing, ensure the JSON inside `policy = jsonencode({ ... })` is valid (matching braces, commas, quotes).

4. **Consumers**
   - The same policy is attached to the service account IAM user and the ECS task role in `ecs.tf`. No change needed there when only updating the policy document.

5. **Update [reference.md](reference.md)**
   - After any change to `terraform/iam.tf` or backend AWS usage, update the reference so it reflects the current state:
     - **"This Project's Clients"** table: list every `@aws-sdk/client-*` in `backend/package.json` and the IAM actions that appear in `terraform/iam.tf` for that service (derive from the policy Statement blocks). Keep SDK client, IAM prefix, and typical actions in sync with the actual policy.
     - **"Adding a New AWS Service"** and **"Common patterns"**: only change if you add new guidance; otherwise leave as-is.
   - reference.md is the source of truth for the next run; keeping it updated avoids drift between the policy and the documentation.

## Policy Structure (this project)

- Single policy: `aws_iam_policy.casey_backend` in `terraform/iam.tf`.
- Format: `Version = "2012-10-17"`, `Statement = [ { Sid, Effect, Action, Resource }, ... ]`.
- Log groups: use explicit ARNs for CreateLogStream/PutLogEvents/DescribeLogStreams (e.g. `arn:aws:logs:*:*:log-group:casey-backend-*` and `...:*`). Other services use `Resource = "*"` unless the project defines specific resources.

## Checklist Before Finishing

- [ ] Every `@aws-sdk/client-*` used in backend has a corresponding Allow statement (or is covered by an existing statement).
- [ ] New actions use the correct service prefix (e.g. `bedrock:`, `transcribe:`, `polly:`, `logs:`).
- [ ] No duplicate Statement blocks for the same Sid; actions are merged into the right block.
- [ ] **reference.md updated**: "This Project's Clients" table matches `backend/package.json` and the actions in `terraform/iam.tf`.
- [ ] `terraform validate` would pass (optional to run).

## Additional Resources

- SDK client → IAM service/actions: [reference.md](reference.md)
