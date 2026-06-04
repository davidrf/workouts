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
