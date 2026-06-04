output "subdomain" {
  value = var.subdomain
}

output "primary_zone_id" {
  value = data.terraform_remote_state.infra_shared.outputs.primary_zone_id
}

# us-east-1 cert — required for CloudFront viewer certificates.
output "acm_certificate_arn_us_east" {
  value = data.terraform_remote_state.infra_shared.outputs.primary_acm_certificate_arn_us_east
}

# Regional (us-west-2) cert — e.g. for an ALB.
output "acm_certificate_arn" {
  value = data.terraform_remote_state.infra_shared.outputs.primary_acm_certificate_arn
}

output "dynamodb_table_name" {
  value = aws_dynamodb_table.workouts.name
}

output "photos_bucket_name" {
  value = aws_s3_bucket.photos.id
}

output "apigateway_endpoint" {
  value = aws_apigatewayv2_api.app.api_endpoint
}

output "cloudfront_domain_name" {
  value = aws_cloudfront_distribution.site.domain_name
}

output "cloudfront_distribution_id" {
  value = aws_cloudfront_distribution.site.id
}

output "kvs_arn" {
  value = aws_cloudfront_key_value_store.basic_auth.arn
}
