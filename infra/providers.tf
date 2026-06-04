terraform {
  backend "s3" {
    bucket         = "workouts-terraform-state"
    key            = "terraform/workouts.tfstate"
    region         = "us-west-2"
    dynamodb_table = "workouts-terraform-locks"
    encrypt        = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}
