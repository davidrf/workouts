# DNS record for workouts.davidrstudios.com
#
# The wildcard cert *.davidrstudios.com (managed in infra-shared) already covers this
# subdomain, and the hosted zone id comes from infra-shared remote state. The record
# itself is left commented out until hosting exists — an alias pointing at a target that
# hasn't been created yet would fail to apply.
#
# TODO: once the site is hosted (e.g. an S3 + CloudFront stack in this repo), uncomment
#       and point the alias at the CloudFront distribution. Example shape:
#
# resource "aws_route53_record" "site" {
#   zone_id = data.terraform_remote_state.infra_shared.outputs.primary_zone_id
#   name    = var.subdomain
#   type    = "A"
#
#   alias {
#     name                   = aws_cloudfront_distribution.site.domain_name
#     zone_id                = aws_cloudfront_distribution.site.hosted_zone_id
#     evaluate_target_health = false
#   }
# }
