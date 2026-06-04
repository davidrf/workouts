# workouts

A site for logging workouts, served at `workouts.davidrstudios.com`.

## Infrastructure

Terraform lives in `infra/`. It consumes shared resources from the `infra-shared`
project via remote state rather than redefining them:

- **TLS** — the wildcard cert `*.davidrstudios.com` (us-east-1 + us-west-2) is managed in
  `infra-shared` and exposed as `acm_certificate_arn_us_east` / `acm_certificate_arn`.
- **DNS zone** — the `davidrstudios.com` Route 53 zone id is exposed as `primary_zone_id`.

This repo owns its own Terraform state backend (`workouts-terraform-state` S3 bucket +
`workouts-terraform-locks` DynamoDB table) and will own its own app resources and the
`workouts.davidrstudios.com` DNS record.

### Status

- [x] State backend + remote-state wiring to `infra-shared`
- [ ] Hosting (S3 + CloudFront, or other) — not yet set up
- [ ] `workouts.davidrstudios.com` Route 53 record — scaffolded but commented out in
  `infra/route53.tf` until a hosting target exists

## Running Terraform

Authenticate once per session via AWS SSO, then run Terraform directly:

```bash
aws sso login --profile admin

cd infra
AWS_PROFILE=admin terraform init
AWS_PROFILE=admin terraform plan
AWS_PROFILE=admin terraform apply
```
