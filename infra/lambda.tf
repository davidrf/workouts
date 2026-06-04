resource "aws_cloudwatch_log_group" "app" {
  name              = "/aws/lambda/${var.app_name}"
  retention_in_days = 14

  tags = var.tags
}

resource "aws_iam_role" "app" {
  name = "${var.app_name}-lambda"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "app" {
  name = "${var.app_name}-lambda"
  role = aws_iam_role.app.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = ["dynamodb:Query", "dynamodb:GetItem", "dynamodb:PutItem"]
        Resource = [
          aws_dynamodb_table.workouts.arn,
          "${aws_dynamodb_table.workouts.arn}/index/id-index",
        ]
      },
      {
        Effect   = "Allow"
        Action   = ["s3:PutObject", "s3:GetObject"]
        Resource = "${aws_s3_bucket.photos.arn}/photos/*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "${aws_cloudwatch_log_group.app.arn}:*"
      },
    ]
  })
}

data "archive_file" "app" {
  type        = "zip"
  source_dir  = "${path.root}/../app"
  output_path = "${path.root}/../app.zip"
}

resource "aws_lambda_function" "app" {
  function_name    = var.app_name
  runtime          = "nodejs20.x"
  handler          = "index.handler"
  role             = aws_iam_role.app.arn
  filename         = data.archive_file.app.output_path
  source_code_hash = data.archive_file.app.output_base64sha256
  timeout          = 29

  environment {
    variables = {
      TABLE_NAME           = aws_dynamodb_table.workouts.name
      GSI_NAME             = "id-index"
      PHOTOS_BUCKET        = aws_s3_bucket.photos.id
      SITE_ORIGIN          = "https://${var.subdomain}"
      ORIGIN_VERIFY_SECRET = random_password.origin_verify.result
    }
  }

  logging_config {
    log_group  = aws_cloudwatch_log_group.app.name
    log_format = "Text"
  }

  depends_on = [aws_cloudwatch_log_group.app]

  tags = var.tags
}

