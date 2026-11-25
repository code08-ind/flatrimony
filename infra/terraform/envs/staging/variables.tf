variable "project_id" {
  description = "GCP project id for staging (e.g. flatrimony-staging). Created by the founder."
  type        = string
}

variable "region" {
  description = "All compute stays in Mumbai (docs/03 §1, NFR-PRIV-01)."
  type        = string
  default     = "asia-south1"
}

variable "github_repository" {
  description = "owner/repo allowed to deploy through Workload Identity Federation."
  type        = string
  default     = "code08-ind/flatrimony"
}

variable "billing_account_id" {
  description = "Billing account for the budget alert. Leave empty to skip the budget until it exists."
  type        = string
  default     = ""
}

variable "monthly_budget_inr" {
  description = "Monthly budget for alerts at 50/80/100%. Set by the founder; no default on purpose."
  type        = number
  default     = null
}

variable "placeholder_image" {
  description = "Image used when Terraform first creates a service; CI deploys real images afterwards."
  type        = string
  default     = "us-docker.pkg.dev/cloudrun/container/hello"
}

variable "secret_ids" {
  description = "Secret Manager secrets the API, worker and web app read (values are added outside Terraform)."
  type        = list(string)
  default = [
    "DATABASE_URL",
    "DATABASE_URL_DIRECT",
    "SUPABASE_SERVICE_ROLE_KEY",
    "FIELD_ENCRYPTION_KEY",
    "HASH_PEPPER",
    "SEND_SMS_HOOK_SECRETS",
    "GOOGLE_PLACES_API_KEY",
    # Shared by the web app's server and the API: the API rate-limits web users by their own IP.
    "WEB_PROXY_SECRET",
    # Standard Webhooks secret(s) the DigiLocker provider signs its webhooks with (T3.1).
    "DIGILOCKER_WEBHOOK_SECRETS",
  ]
}

variable "supabase_url" {
  description = "Supabase project URL (https://<ref>.supabase.co) for the worker's Storage tasks (required: the worker refuses to start without it outside local)."
  type        = string
  default     = ""
}
