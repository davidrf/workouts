# workouts

A personal workout-logging web app at `workouts.davidrstudios.com`. Single user (David).
The app is **fully built and deployed** — all six MVP phases are complete.

## Architecture

Server-rendered Lambda monolith behind CloudFront. No always-on servers; scales to zero.

```
workouts.davidrstudios.com (Route53 A-alias)
    → CloudFront
        • CF Function: Basic Auth (reads credential from KeyValueStore)
        • Default behavior → API Gateway HTTP API → Lambda (Node 20)
        • /photos/* behavior → S3 (private, OAC)
    → Lambda reads/writes DynamoDB (workouts table)
    → Presigned S3 PUTs bypass CloudFront entirely (browser → S3 direct)
```

**Key architectural decision**: Lambda Function URL + CloudFront OAC did not work due to
an org-level SCP blocking service principal invocations to Lambda URLs. The origin is
API Gateway HTTP API instead. A secret `x-origin-verify` header (stored in Terraform
state and Lambda env vars) prevents direct API Gateway access.

## App routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/` | List all workouts, newest first |
| GET | `/workouts/new` | Add-workout form |
| POST | `/api/uploads` | Returns presigned S3 PUT URLs + S3 keys |
| POST | `/workouts` | Validates, writes DynamoDB, 302 → detail |
| GET | `/workouts/{id}` | Detail page with photos, date, details, weights |
| GET | `/photos/*` | CloudFront → S3 via OAC (not Lambda) |

## App code (`app/`)

- **`app/index.mjs`** — single ES module, no dependencies beyond bundled AWS SDK.
  No build step; Terraform zips the folder directly.
- Routing: `event.requestContext.http.method` + `event.rawPath` (API GW payload v2)
- HTML: plain template literals, `esc()` helper for XSS prevention on all user fields
- AWS SDK packages used (all bundled in `nodejs20.x`):
  - `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb` (DynamoDBDocumentClient)
  - `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
- IDs: `crypto.randomUUID()` (built-in)

## Infrastructure (`infra/`)

| File | What it does |
|------|--------------|
| `providers.tf` | S3 backend + AWS + random providers |
| `variables.tf` | `aws_region`, `app_name`, `subdomain`, `basic_auth_username`, `tags` |
| `data.tf` | `terraform_remote_state` → `infra-shared`; `aws_caller_identity` |
| `state_backend.tf` | S3 state bucket + DynamoDB lock table |
| `dynamodb.tf` | `workouts-workouts` table (PAY_PER_REQUEST, PITR, `id-index` GSI) |
| `s3_photos.tf` | Private photos bucket (Block Public Access, CORS, versioning, OAC policy) |
| `lambda.tf` | IAM role/policy, archive_file, Lambda function (Node 20, 29s timeout) |
| `apigateway.tf` | HTTP API, Lambda proxy integration, stage, Lambda permission |
| `cloudfront.tf` | KVS, CF Function (Basic Auth), S3 OAC, distribution, random secret |
| `route53.tf` | A-alias record for `workouts.davidrstudios.com` → CloudFront |
| `outputs.tf` | Exposes key resource names/IDs |

## DynamoDB schema

Table `workouts-workouts`:
- PK: `pk` = `"WORKOUT"` (constant) / SK: `sk` = `"{workout_date}#{id}"`
- GSI `id-index`: PK `id` (projection ALL) — used for detail page lookups
- Fields: `id`, `workout_date` (required), `name`, `details`, `recommended_weights` (optional), `photo_keys` (list), `created_at`

## S3 layout

Bucket `workouts-photos-{account_id}`:
- Keys: `photos/{workout_id}/{uuid}.{ext}`
- Private; served only via CloudFront `/photos/*` behavior (S3 OAC)

## Basic Auth (edge)

Credential stored in CloudFront KeyValueStore (`workouts-basic-auth`). Key: `credential`,
value: `base64("david:PASSWORD")`. Update via:

```bash
KVS_ARN=$(AWS_PROFILE=admin terraform -chdir=infra output -raw kvs_arn)
ETAG=$(AWS_PROFILE=admin aws cloudfront-keyvaluestore describe-key-value-store \
  --kvs-arn $KVS_ARN --query ETag --output text)
AWS_PROFILE=admin aws cloudfront-keyvaluestore put-key \
  --kvs-arn $KVS_ARN --key credential \
  --value "$(echo -n 'david:NEW_PASSWORD' | base64)" \
  --if-match $ETAG
```

## Relationship to infra-shared

This repo does **not** define foundational AWS resources. It consumes them from
`infra-shared` (sibling repo `../infra-shared`) via `terraform_remote_state` in
`infra/data.tf`. Outputs used:

- `primary_zone_id` — `davidrstudios.com` Route 53 hosted zone
- `primary_acm_certificate_arn_us_east` — wildcard cert in us-east-1 (CloudFront viewer cert)
- `primary_acm_certificate_arn` — wildcard cert in us-west-2 (not used here)

## Running Terraform

```bash
aws sso login --profile admin   # legacy SSO profile format required for Terraform

cd infra
AWS_PROFILE=admin terraform init
AWS_PROFILE=admin terraform plan
AWS_PROFILE=admin terraform apply
```

**SSO profile note**: `~/.aws/config` uses the legacy (non-`sso_session`) format for
the `admin` profile. This is intentional — the newer `sso_session` format is not
supported by Terraform's S3 backend.

## State backend

- Bucket: `workouts-terraform-state` (us-west-2, encrypted)
- Lock table: `workouts-terraform-locks`
- Key: `terraform/workouts.tfstate`

`terraform.tfstate*`, `.terraform/`, `terraform.tfvars`, and `app.zip` are gitignored.
