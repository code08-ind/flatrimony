# Infrastructure (Terraform)

`envs/staging` defines the Google Cloud side of staging (docs/03 §4.2, T1.10): APIs, Artifact Registry,
service accounts, Workload Identity Federation for GitHub Actions, Secret Manager containers, Cloud Run
services (`api`, `web`, `admin`), the `worker` Cloud Run Job, Cloud Scheduler (`worker-tick`,
`worker-daily`) and budget alerts.

**Status: Blocked** until the founder creates the GCP project, billing account and a versioned GCS
state bucket. Nothing here has been applied.

```bash
cd infra/terraform/envs/staging
cp terraform.tfvars.example terraform.tfvars   # fill in project and billing ids
terraform init -backend-config="bucket=<state-bucket>" -backend-config="prefix=staging"
terraform plan
```

After `apply`, copy the `wif_provider` and `deployer_service_account` outputs into the GitHub
`staging` environment (see `.github/workflows/deploy-staging.yml`). Production (`envs/prod`) follows
in T6.8. Routing (Valhalla) is added with T2.9.
