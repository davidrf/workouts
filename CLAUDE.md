# workouts

A site for logging workouts, served at `workouts.davidrstudios.com`. Currently this repo
only contains infrastructure (`infra/`); the app itself is not built yet.

## Relationship to infra-shared

This repo does **not** define foundational AWS resources. It consumes them from the
`infra-shared` project (sibling repo `../infra-shared`) via `terraform_remote_state` in
`infra/data.tf`. Outputs used:

- `primary_zone_id` — the `davidrstudios.com` Route 53 hosted zone
- `primary_acm_certificate_arn_us_east` — wildcard cert in us-east-1 (for CloudFront)
- `primary_acm_certificate_arn` — wildcard cert in us-west-2 (for regional resources, e.g. ALB)

The wildcard cert `*.davidrstudios.com` already covers this subdomain, so **certs and the
DNS zone are never created here** — only referenced.

## Running Terraform

Authenticate once per session via AWS SSO, then run Terraform directly:

```bash
aws sso login --profile admin

cd infra
AWS_PROFILE=admin terraform init
AWS_PROFILE=admin terraform plan
AWS_PROFILE=admin terraform apply
```

## State backend

This repo owns its own state backend (separate from `infra-shared`):

- Bucket: `workouts-terraform-state` (us-west-2)
- Lock table: `workouts-terraform-locks`
- State key: `terraform/workouts.tfstate`

**Bootstrap caveat:** `providers.tf` points the backend at the same bucket that
`state_backend.tf` creates. First apply runs with local state to create the bucket/table,
then `terraform init` migrates state into S3. This mirrors `infra-shared` and
`davidrstudios/infra`.

## File layout

| File | What it does |
|------|--------------|
| `infra/providers.tf` | S3 backend config + AWS provider (`~> 5.0`, us-west-2) |
| `infra/variables.tf` | `aws_region`, `app_name`, `subdomain`, `tags` |
| `infra/data.tf` | `terraform_remote_state` → `infra-shared` |
| `infra/state_backend.tf` | S3 state bucket + DynamoDB lock table |
| `infra/route53.tf` | `workouts.davidrstudios.com` A-alias record — **commented out** until hosting exists |
| `infra/outputs.tf` | Passthrough of zone id + cert ARNs for downstream use |

## Status / conventions

- Hosting (S3 + CloudFront, or other) is **not set up yet**. The `davidrstudios/infra`
  sibling repo is the reference pattern for a static site (S3 + CloudFront using the
  us-east-1 cert + Route53 alias).
- The DNS record in `route53.tf` is intentionally commented out — an alias pointing at a
  nonexistent target would fail to apply. Uncomment it once a hosting target exists.
- `terraform.tfstate*`, `.terraform/`, and `terraform.tfvars` are gitignored — do not
  commit them.
