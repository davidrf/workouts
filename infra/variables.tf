variable "aws_region" {
  default = "us-west-2"
}

variable "app_name" {
  default = "workouts"
}

variable "subdomain" {
  default = "workouts.davidrstudios.com"
}

variable "tags" {
  type = map(string)
  default = {
    Project     = "workouts"
    Environment = "production"
    ManagedBy   = "terraform"
  }
}
