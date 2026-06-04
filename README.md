# workouts

Personal workout-logging web app at **[workouts.davidrstudios.com](https://workouts.davidrstudios.com)**.

Log whiteboard workouts: date, name, photos, details, and recommended weights.

## Stack

- **Frontend/backend**: Server-rendered HTML from a single Node 20 Lambda function
- **Edge**: CloudFront + CloudFront Function (HTTP Basic Auth)
- **API**: API Gateway HTTP API → Lambda
- **Database**: DynamoDB (on-demand, PITR enabled)
- **Photos**: Direct browser → S3 via presigned PUT URLs; served via CloudFront OAC
- **Infra**: Terraform (us-west-2); state in S3

No frameworks, no build step, no always-on servers. ~$0/month at personal scale.

## Features

- Add workouts with photos, date, name, details, and recommended weights
- Index listing (newest first) with links to detail pages
- Photos stored privately in S3 and served through CloudFront
- HTTP Basic Auth at the edge (CloudFront Function + KeyValueStore)

## Development

See [CLAUDE.md](CLAUDE.md) for architecture details, infra file layout, DynamoDB schema,
and instructions for updating the Basic Auth password.

```bash
# Deploy infra + app changes
aws sso login --profile admin
cd infra && AWS_PROFILE=admin terraform apply

# App code lives in app/index.mjs — no build step needed
# Terraform zips app/ and uploads on every apply when the code hash changes
```
