terraform {
  required_version = ">= 1.9"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.0"
    }
  }

  # Remote state in a versioned GCS bucket (docs/03 §10.6). The bucket name is passed at init:
  #   terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=staging"
  backend "gcs" {}
}

provider "google" {
  project = var.project_id
  region  = var.region
}
