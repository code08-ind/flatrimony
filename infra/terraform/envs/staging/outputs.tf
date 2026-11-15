output "wif_provider" {
  description = "Value for the GCP_WIF_PROVIDER GitHub secret."
  value       = google_iam_workload_identity_pool_provider.github_actions.name
}

output "deployer_service_account" {
  description = "Value for the GCP_DEPLOYER_SA GitHub secret."
  value       = google_service_account.sa["deployer"].email
}

output "service_urls" {
  description = "Default run.app URLs (custom domains pending ADR-0007)."
  value       = { for k, s in google_cloud_run_v2_service.svc : k => s.uri }
}
