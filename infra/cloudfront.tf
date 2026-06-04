resource "random_password" "origin_verify" {
  length  = 32
  special = false
}

resource "aws_cloudfront_key_value_store" "basic_auth" {
  name = "${var.app_name}-basic-auth"
}

resource "aws_cloudfront_function" "basic_auth" {
  name    = "${var.app_name}-basic-auth"
  runtime = "cloudfront-js-2.0"
  publish = true

  key_value_store_associations = [aws_cloudfront_key_value_store.basic_auth.arn]

  code = <<-EOF
    import cf from 'cloudfront';
    const kvsHandle = cf.kvs();

    async function handler(event) {
      const request = event.request;

      let expected;
      try {
        expected = await kvsHandle.get('credential');
      } catch (e) {
        return unauthorized();
      }

      const authHeader = request.headers['authorization'];
      const auth = authHeader ? authHeader.value : '';
      if (auth !== 'Basic ' + expected) {
        return unauthorized();
      }

      delete request.headers['authorization'];
      return request;
    }

    function unauthorized() {
      return {
        statusCode: 401,
        statusDescription: 'Unauthorized',
        headers: { 'www-authenticate': { value: 'Basic realm="workouts"' } },
      };
    }
  EOF
}

resource "aws_cloudfront_origin_access_control" "s3" {
  name                              = "${var.app_name}-s3"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled         = true
  aliases         = [var.subdomain]
  price_class     = "PriceClass_100"
  http_version    = "http2"
  is_ipv6_enabled = true

  origin {
    origin_id   = "apigw"
    domain_name = trimprefix(aws_apigatewayv2_api.app.api_endpoint, "https://")

    custom_origin_config {
      https_port             = 443
      http_port              = 80
      origin_protocol_policy = "https-only"
      origin_ssl_protocols   = ["TLSv1.2"]
    }

    # Secret header — only CloudFront knows this value; Lambda verifies it
    custom_header {
      name  = "x-origin-verify"
      value = random_password.origin_verify.result
    }
  }

  origin {
    origin_id                = "s3-photos"
    domain_name              = aws_s3_bucket.photos.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.s3.id
  }

  # Default behavior — all routes → API Gateway → Lambda, no caching
  default_cache_behavior {
    target_origin_id         = "apigw"
    allowed_methods          = ["DELETE", "GET", "HEAD", "OPTIONS", "PATCH", "POST", "PUT"]
    cached_methods           = ["GET", "HEAD"]
    viewer_protocol_policy   = "redirect-to-https"
    compress                 = true
    cache_policy_id          = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad" # CachingDisabled
    origin_request_policy_id = "b689b0a8-53d0-40ab-baf2-68738e2966ac" # AllViewer (safe — no OAC on this origin)

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  # /photos/* behavior — S3 origin, caching enabled
  ordered_cache_behavior {
    path_pattern           = "/photos/*"
    target_origin_id       = "s3-photos"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    viewer_protocol_policy = "redirect-to-https"
    compress               = true
    cache_policy_id        = "658327ea-f89d-4fab-a63d-7e88639e58f6" # CachingOptimized

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.basic_auth.arn
    }
  }

  viewer_certificate {
    acm_certificate_arn      = data.terraform_remote_state.infra_shared.outputs.primary_acm_certificate_arn_us_east
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  tags = var.tags
}
