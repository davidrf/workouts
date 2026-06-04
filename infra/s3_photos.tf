resource "aws_s3_bucket" "photos" {
  bucket = "${var.app_name}-photos-${data.aws_caller_identity.current.account_id}"

  tags = var.tags
}

resource "aws_s3_bucket_public_access_block" "photos" {
  bucket = aws_s3_bucket.photos.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_cors_configuration" "photos" {
  bucket = aws_s3_bucket.photos.id

  cors_rule {
    allowed_methods = ["PUT"]
    allowed_origins = ["https://${var.subdomain}"]
    allowed_headers = ["*"]
    max_age_seconds = 300
  }
}

resource "aws_s3_bucket_versioning" "photos" {
  bucket = aws_s3_bucket.photos.id

  versioning_configuration {
    status = "Enabled"
  }
}

# TODO (Phase 3): add aws_s3_bucket_policy allowing s3:GetObject only from
# aws_cloudfront_distribution.site (OAC). Requires the CloudFront ARN which
# doesn't exist until cloudfront.tf is created.
