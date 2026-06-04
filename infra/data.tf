data "terraform_remote_state" "infra_shared" {
  backend = "s3"

  config = {
    bucket         = "infra-shared-terraform-state-davidrf"
    key            = "state/infra-shared.tfstate"
    region         = "us-west-2"
    dynamodb_table = "infra-shared-terraform-locks"
  }
}
