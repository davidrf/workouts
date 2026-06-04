# Workouts MVP — Implementation Plan

> Status: **approved, not yet implemented.** This document is the source of truth for
> building the workouts app. All architecture decisions below are locked. A future Claude
> session should be able to implement directly from this file.
>
> Last updated: 2026-06-04

---

## 1. What we're building

A personal workout-logging web app served at `workouts.davidrstudios.com`. Single user
(the repo owner). Three pages:

- **`/`** — index listing all saved workouts (newest first), each a link to its details page,
  showing **name** (if provided) and **original workout date** (required). Plus an
  "Add workout" link.
- **`/workouts/new`** — form: one or more **photos** (whiteboard pics), optional **name**,
  required **original workout date**, optional **details** textarea, optional
  **recommended weights** textarea. On submit → save → `302` redirect to details page.
- **`/workouts/{id}`** — displays photos, name (if present), date, details (if present),
  recommended weights (if present).

Optimize for: low ongoing cost, low maintenance, simple/boring/durable infrastructure,
no always-on servers.

---

## 2. Locked decisions

| # | Decision | Choice |
|---|----------|--------|
| 1 | Lambda runtime | **Node 20** (AWS SDK v3 bundled → no build step) |
| 2 | Workout lookup | **`id` GSI** on the DynamoDB table for O(1) `/workouts/{id}` |
| 3 | Basic Auth secret storage | **CloudFront KeyValueStore** (read by the CF Function) |
| 4 | Metadata store | **DynamoDB** (on-demand) |
| 5 | Lambda origin | **Lambda Function URL + OAC** (no API Gateway) |
| 6 | Image handling | **Store originals only; display photos only on the details page** |
| 7 | Multi-photo UX | Single multi-file input; **no captions/ordering** |

---

## 3. Architecture

Server-rendered Lambda monolith behind CloudFront. One Lambda renders all HTML and handles
the form POST. Photos upload **directly to S3 via presigned PUT URLs** (bypasses CloudFront
and Lambda payload limits). Everything is gated by HTTP Basic Auth at the edge.

```
                          workouts.davidrstudios.com
                                     │ (Route53 A-alias)
                                     ▼
                        ┌────────────────────────────┐
                        │        CloudFront           │
                        │  • us-east-1 wildcard cert  │  ◄── from infra-shared remote state
                        │  • CF Function: Basic Auth  │  ◄── reads CloudFront KeyValueStore
                        └────────────┬────────┬───────┘
                          default /  │        │  /photos/*
                                     ▼        ▼
                      ┌──────────────────┐  ┌────────────────────┐
                      │ Lambda Func URL  │  │  S3 (photos)        │
                      │  (OAC, AWS_IAM)  │  │  private, via OAC   │
                      │  app: SSR HTML   │  └─────────▲──────────┘
                      └───────┬──────────┘            │ presigned PUT
                              │                       │ (browser → S3 direct)
                  ┌───────────┴────────┐              │
                  ▼                    ▼              │
          ┌──────────────┐   ┌──────────────┐        │
          │  DynamoDB    │   │ presign S3 ──┼────────┘
          │  workouts    │   │ upload URLs  │
          │  (+ id GSI)  │   └──────────────┘
          └──────────────┘
```

**Why this shape (recap):** smallest thing that satisfies the spec. One deployable artifact,
no CORS (same origin for the app), no SPA build, classic `POST → 302 redirect` matches the
spec, scales to zero, ~$0/month. Deps limited to the bundled AWS SDK ⇒ no build pipeline;
Terraform just zips a source folder.

---

## 4. Repo grounding (facts a future session needs)

This repo (`workouts`) is **infra only** today and consumes foundational resources from the
sibling `infra-shared` project via `terraform_remote_state`. Do **not** create certs or the
DNS zone here — only reference them.

- **Provider:** single AWS provider, region `us-west-2` (`infra/providers.tf`). Sufficient —
  CloudFront is global; the only us-east-1 requirement (viewer cert) is *referenced*, not created.
- **State backend (this repo):** bucket `workouts-terraform-state`, lock table
  `workouts-terraform-locks`, key `terraform/workouts.tfstate`, us-west-2, encrypted.
- **Remote state source:** `data.terraform_remote_state.infra_shared` (`infra/data.tf`),
  bucket `infra-shared-terraform-state-davidrf`, key `state/infra-shared.tfstate`.
- **Remote state outputs available** (already surfaced in `infra/outputs.tf`):
  - `primary_zone_id` — `davidrstudios.com` Route 53 hosted zone.
  - `primary_acm_certificate_arn_us_east` — **wildcard cert in us-east-1** → use for the
    CloudFront viewer certificate. (Surfaced as output `acm_certificate_arn_us_east`.)
  - `primary_acm_certificate_arn` — wildcard cert in us-west-2 (regional; not needed here).
- **Existing variables** (`infra/variables.tf`): `aws_region` (`us-west-2`), `app_name`
  (`workouts`), `subdomain` (`workouts.davidrstudios.com`), `tags` map.
- **`infra/route53.tf`** already contains a **commented-out** A-alias for `var.subdomain`
  pointing at `aws_cloudfront_distribution.site` — uncomment it in Phase 3 (it expects a
  resource named exactly `aws_cloudfront_distribution.site`).
- The wildcard `*.davidrstudios.com` already covers this subdomain.

### Running Terraform
```bash
aws sso login --profile admin
cd infra
AWS_PROFILE=admin terraform init
AWS_PROFILE=admin terraform plan
AWS_PROFILE=admin terraform apply
```
`terraform.tfstate*`, `.terraform/`, and `terraform.tfvars` are gitignored — never commit them.

---

## 5. Data model

### DynamoDB table `workouts` (on-demand / `PAY_PER_REQUEST`, PITR enabled)

Single user ⇒ one partition; sort key gives date-ordered listing in a single `Query`
(no Scan). A GSI on `id` gives O(1) detail lookups.

| Attribute | Type | Notes |
|---|---|---|
| `pk` | S (partition key) | constant `"WORKOUT"` — all items share one partition |
| `sk` | S (sort key) | `"{workout_date}#{id}"`, e.g. `2026-06-04#01HZ...` |
| `id` | S | ULID/UUID; used in the URL and as GSI partition key |
| `name` | S | optional |
| `workout_date` | S | required, `YYYY-MM-DD` |
| `details` | S | optional |
| `recommended_weights` | S | optional |
| `photo_keys` | L of S | S3 object keys, e.g. `photos/{id}/{uuid}.jpg` |
| `created_at` | S | ISO-8601 timestamp |

**GSI `id-index`:** partition key `id` (project ALL). Used by `GET /workouts/{id}`.

**Access patterns:**
- Index page → `Query pk = "WORKOUT"`, `ScanIndexForward = false` ⇒ all workouts newest-first.
- Details page → `Query id-index where id = {id}` ⇒ single item.

### S3 photos bucket
- Private; **Block Public Access = all true**. Reachable only via CloudFront OAC.
- Object key layout: `photos/{workout_id}/{uuid}.{ext}`.
- CORS: allow `PUT` from `https://workouts.davidrstudios.com` (for presigned browser uploads).
- Optional: versioning on (cheap safety).

---

## 6. Route structure

| Method | Path | Handler |
|---|---|---|
| `GET` | `/` | Index: `Query` all, render list of `{name?, date}` links + "Add workout" button + empty-state |
| `GET` | `/workouts/new` | Render add form |
| `POST` | `/api/uploads` | Body: `[{filename, contentType}]` → returns presigned PUT URLs + the S3 keys to store |
| `POST` | `/workouts` | Validate, `PutItem` to DynamoDB, `302 → /workouts/{id}` |
| `GET` | `/workouts/{id}` | `Query id-index`, render details (photos via `/photos/...`, name?, date, details?, weights?) |
| `GET` | `/photos/*` | **CloudFront behavior, not Lambda** → S3 origin via OAC |
| `GET` | `/healthz` | optional liveness |

The Lambda does its own routing (method + path) inside one handler.

### Photo upload flow (avoids API Gateway/Lambda payload limits)
1. On `/workouts/new`, small JS calls `POST /api/uploads` with the chosen files' names/types.
2. Lambda returns short-lived **presigned PUT URLs** (≤5 min) + the S3 keys.
3. Browser `PUT`s each photo **directly to S3** (signature is the auth; bypasses CloudFront).
4. Form `POST /workouts` carries only the S3 keys + text fields (tiny payload).
5. Lambda writes the record → `302` to details. Details page renders `<img src="/photos/{id}/{uuid}.jpg">`
   served from S3 through CloudFront OAC. **Photos are shown only on the details page.**

---

## 7. Terraform resource plan

Slots into the existing `infra/` layout. New files:

### `infra/dynamodb.tf`
- `aws_dynamodb_table.workouts` — `billing_mode = "PAY_PER_REQUEST"`; hash `pk`, range `sk`;
  attributes `pk`, `sk`, `id`; `global_secondary_index` `id-index` (hash `id`, projection ALL);
  `point_in_time_recovery { enabled = true }`; `tags = var.tags`.

### `infra/s3_photos.tf`
- `aws_s3_bucket.photos`
- `aws_s3_bucket_public_access_block` — all four flags `true`
- `aws_s3_bucket_cors_configuration` — allow method `PUT`, origin `https://${var.subdomain}`,
  allowed headers `*`, reasonable max-age
- `aws_s3_bucket_policy` — allow `s3:GetObject` **only** from the CloudFront distribution
  (condition `AWS:SourceArn = aws_cloudfront_distribution.site.arn`)
- (optional) `aws_s3_bucket_versioning`

### `infra/lambda.tf`
- `aws_iam_role.app` (+ Lambda assume-role trust)
- `aws_iam_role_policy.app` — least privilege:
  - `dynamodb:Query`, `GetItem`, `PutItem` on the table **and** `.../index/id-index`
  - `s3:PutObject`, `s3:GetObject` on `${photos.arn}/photos/*`
  - CloudWatch Logs (`logs:CreateLogStream`, `logs:PutLogEvents`) on the log group
- `data.archive_file.app` — zips the `app/` source directory (no deps beyond AWS SDK)
- `aws_lambda_function.app` — `runtime = "nodejs20.x"`, handler in `app/`, env vars:
  `TABLE_NAME`, `GSI_NAME` (`id-index`), `PHOTOS_BUCKET`, `SITE_ORIGIN`
  (`https://${var.subdomain}`); `source_code_hash` from the archive
- `aws_lambda_function_url.app` — `authorization_type = "AWS_IAM"` (only CloudFront OAC may invoke)
- `aws_cloudwatch_log_group.app` — 14-day retention

### `infra/cloudfront.tf`
- `aws_cloudfront_key_value_store.basic_auth` — holds the auth credential (see §8)
- `aws_cloudfront_function.basic_auth` — viewer-request, `key_value_store_associations` →
  the KVS; rejects requests whose `Authorization` header doesn't match (returns 401 with
  `WWW-Authenticate: Basic`)
- `aws_cloudfront_origin_access_control.lambda` — origin type `lambda`, signing `always`/`sigv4`
- `aws_cloudfront_origin_access_control.s3` — origin type `s3`
- `aws_cloudfront_distribution.site`:
  - `aliases = [var.subdomain]`
  - `viewer_certificate` → `data.terraform_remote_state.infra_shared.outputs.primary_acm_certificate_arn_us_east`,
    `ssl_support_method = "sni-only"`, `minimum_protocol_version = "TLSv1.2_2021"`
  - **Origin A** = Lambda Function URL (custom origin, `https-only`), with `lambda` OAC
  - **Origin B** = S3 photos bucket, with `s3` OAC
  - **Default behavior** → Origin A; attach `basic_auth` function (viewer-request);
    forward needed headers/cookies/query; **no caching** for HTML (managed
    `CachingDisabled` policy + an origin-request policy that forwards what Lambda needs)
  - **`/photos/*` behavior** → Origin B; **also attach `basic_auth`**; caching enabled
  - `viewer_protocol_policy = "redirect-to-https"`
  - `tags = var.tags`

> Note: forwarding `Authorization` to a Lambda Function URL origin can conflict with SigV4
> OAC signing. Keep Basic Auth purely at the CF Function (it validates then can strip the
> header before origin), so the OAC-signed request to the Function URL isn't disturbed.

### `infra/route53.tf` (existing — uncomment)
- Uncomment the `aws_route53_record.site` A-alias; it already targets
  `aws_cloudfront_distribution.site` (`domain_name` / `hosted_zone_id`) and uses
  `primary_zone_id` from remote state.

### `infra/variables.tf` / `infra/outputs.tf` (extend)
- Add `basic_auth_username` (default `david`), optionally `lambda_runtime` (default `nodejs20.x`).
- Outputs: CloudFront `domain_name`, distribution `id`, photos bucket name.
- **Auth password is not a plain variable** — see §8.

---

## 8. Security considerations (personal-only)

- **Edge Basic Auth via CloudFront Function + KeyValueStore.** The CF Function reads the
  expected credential from `aws_cloudfront_key_value_store.basic_auth` and compares it to the
  request's `Authorization` header. Native browser login prompt; zero backend auth code.
  - **Why KVS:** CloudFront Functions have **no network access** (can't read SSM at runtime),
    so the secret must live with the function. KVS keeps it out of the function source.
  - **Seeding the secret:** put the `username:password` (base64) or a comparison value into
    the KVS. Avoid committing the plaintext. Options: write the KVS entry out-of-band
    (CLI/console) after apply, or pass via a `terraform.tfvars` (gitignored) into a
    `aws_cloudfrontkeyvaluestore_key` resource. Decide at implementation time; **do not
    hardcode the password in committed `.tf`.**
- **HTTPS only** — `redirect-to-https`.
- **Private buckets** — Block Public Access on; objects only via CloudFront OAC. No public S3 URLs.
- **Locked-down Lambda URL** — `AWS_IAM` auth + OAC; the Function URL can't be hit directly.
- **Presigned uploads, constrained** — expiry ≤5 min; pin `Content-Type` to `image/*`; cap
  size (presigned-POST conditions or validate). URLs only issued by the authed Lambda.
- **Least-privilege IAM** — Lambda role scoped to the one table (+ `id-index`), the
  `photos/*` prefix, and its log group. Nothing else.
- **XSS hygiene** — HTML-escape all user text (`name`, `details`, `recommended_weights`) when
  rendering server-side.
- **Upload validation** — allowlist image content-types; enforce a max size; reject others.
- **Backups** — DynamoDB PITR on; optional S3 versioning.
- **Deliberately skipped** (cost/complexity not justified for one user): WAF, Cognito,
  IP allowlisting. Easy to add later.

---

## 9. Implementation phases

Each phase is independently `apply`-able and leaves the system working.

1. **Data layer** — `dynamodb.tf` + `s3_photos.tf` (private bucket, CORS, public-access block).
   `apply`; verify table (+ `id-index`) and bucket exist.
2. **Compute skeleton** — `lambda.tf`: IAM role, hello-world handler via `archive_file`,
   Function URL (`AWS_IAM`). `apply`; confirm the function exists.
3. **Edge + DNS** — `cloudfront.tf` (KVS, Basic Auth function, two OACs, two behaviors) +
   uncomment `route53.tf`. Seed the KVS credential. `apply`; confirm
   `https://workouts.davidrstudios.com` prompts for auth and reaches the hello-world Lambda
   over the real domain; confirm a manually-uploaded object loads via `/photos/...`.
4. **App: read path** — implement `GET /` and `GET /workouts/{id}` against DynamoDB (seed a
   row by hand). Verify listing (newest-first) + details render.
5. **App: write path** — `GET /workouts/new`, `POST /api/uploads` (presigned), direct-to-S3
   upload, `POST /workouts` → redirect. End-to-end create with photos.
6. **Polish** — input validation, HTML escaping, index empty-state, log retention, confirm
   PITR/versioning. (No thumbnails — originals only, shown on details page only.)

---

## 10. App code notes (for the implementation session)

- **Language/runtime:** Node 20, ES modules. Use the **bundled `@aws-sdk/client-dynamodb`,
  `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`** — all
  available in the `nodejs20.x` runtime, so **no `npm install` / bundling**; `archive_file`
  of the source folder is the whole pipeline.
- **HTML:** plain template literals (no framework, no build). Always escape interpolated
  user input.
- **Routing:** single handler switching on `event.requestContext.http.method` +
  `event.rawPath` (Lambda Function URL event shape).
- **IDs:** ULID preferred (sortable) or `crypto.randomUUID()`.
- **Forms:** `GET /workouts/new` posts to `POST /workouts`; respond `302` with `Location:
  /workouts/{id}`. Photo bytes never pass through Lambda — only S3 keys do.
- **Env vars consumed:** `TABLE_NAME`, `GSI_NAME`, `PHOTOS_BUCKET`, `SITE_ORIGIN`.

---

## 11. Cost expectation

Near zero at personal scale: DynamoDB on-demand, Lambda, S3, and CloudFront all sit within
or near free tier for one user. Realistically pennies/month. The Route 53 hosted-zone cost
already lives in `infra-shared`, not here.
