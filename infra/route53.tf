resource "aws_route53_record" "site" {
  zone_id = data.terraform_remote_state.infra_shared.outputs.primary_zone_id
  name    = var.subdomain
  type    = "A"

  alias {
    name                   = aws_cloudfront_distribution.site.domain_name
    zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
    evaluate_target_health = false
  }
}
