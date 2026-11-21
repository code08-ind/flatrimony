# GCP staging (docs/03 §4.2, T1.10). BLOCKED: needs the founder's GCP project and billing.
locals {
  services = toset([
    "run.googleapis.com",
    "artifactregistry.googleapis.com",
    "secretmanager.googleapis.com",
    "cloudscheduler.googleapis.com",
    "iamcredentials.googleapis.com",
    "iam.googleapis.com",
    "sts.googleapis.com",
    "billingbudgets.googleapis.com",
  ])

  service_accounts = {
    api      = "API service"
    worker   = "Worker job and scheduler"
    web      = "Web and admin services"
    routing  = "Routing service (no access to anything)"
    deployer = "GitHub Actions deployer (via WIF)"
  }
}

resource "google_project_service" "apis" {
  for_each           = local.services
  service            = each.value
  disable_on_destroy = false
}

# --- Artifact Registry -------------------------------------------------------
resource "google_artifact_registry_repository" "images" {
  location      = var.region
  repository_id = "flatrimony"
  format        = "DOCKER"
  description   = "api, web, admin, worker, routing images"

  cleanup_policies {
    id     = "keep-recent"
    action = "KEEP"
    most_recent_versions {
      keep_count = 20
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Service accounts (least privilege) ---------------------------------------
resource "google_service_account" "sa" {
  for_each     = local.service_accounts
  account_id   = "${each.key}-sa"
  display_name = each.value
}

# --- Workload Identity Federation for GitHub Actions --------------------------
resource "google_iam_workload_identity_pool" "github" {
  workload_identity_pool_id = "github"
  display_name              = "GitHub Actions"
  depends_on                = [google_project_service.apis]
}

resource "google_iam_workload_identity_pool_provider" "github_actions" {
  workload_identity_pool_id          = google_iam_workload_identity_pool.github.workload_identity_pool_id
  workload_identity_pool_provider_id = "github-actions"
  display_name                       = "GitHub Actions"

  attribute_mapping = {
    "google.subject"       = "assertion.sub"
    "attribute.repository" = "assertion.repository"
    "attribute.ref"        = "assertion.ref"
  }

  # Only this repository's main branch may deploy staging (docs/03 §10.1).
  attribute_condition = "assertion.repository == \"${var.github_repository}\" && assertion.ref == \"refs/heads/main\""

  oidc {
    issuer_uri = "https://token.actions.githubusercontent.com"
  }
}

resource "google_service_account_iam_member" "deployer_wif" {
  service_account_id = google_service_account.sa["deployer"].name
  role               = "roles/iam.workloadIdentityUser"
  member             = "principalSet://iam.googleapis.com/${google_iam_workload_identity_pool.github.name}/attribute.repository/${var.github_repository}"
}

resource "google_artifact_registry_repository_iam_member" "deployer_push" {
  location   = google_artifact_registry_repository.images.location
  repository = google_artifact_registry_repository.images.name
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${google_service_account.sa["deployer"].email}"
}

resource "google_project_iam_member" "deployer_run" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.sa["deployer"].email}"
}

# The deployer must act as the runtime service accounts when rolling revisions.
resource "google_service_account_iam_member" "deployer_act_as" {
  for_each           = toset(["api", "worker", "web", "routing"])
  service_account_id = google_service_account.sa[each.key].name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.sa["deployer"].email}"
}

# --- Secrets (containers only; values are added out of band) ------------------
resource "google_secret_manager_secret" "secrets" {
  for_each  = toset(var.secret_ids)
  secret_id = each.value
  replication {
    user_managed {
      replicas {
        location = var.region
      }
    }
  }
  depends_on = [google_project_service.apis]
}

locals {
  # Least privilege (docs/03 §4): the worker reads only the secrets it uses.
  worker_secret_ids = ["DATABASE_URL", "DATABASE_URL_DIRECT", "SUPABASE_SERVICE_ROLE_KEY"]
  secret_access = concat(
    [for id in var.secret_ids : [id, "api"]],
    [for id in local.worker_secret_ids : [id, "worker"] if contains(var.secret_ids, id)],
  )
}

resource "google_secret_manager_secret_iam_member" "runtime_access" {
  for_each = {
    for pair in local.secret_access : "${pair[0]}-${pair[1]}" => pair
  }
  secret_id = google_secret_manager_secret.secrets[each.value[0]].id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.sa[each.value[1]].email}"
}

# --- Cloud Run services (scale to zero) ----------------------------------------
locals {
  run_services = {
    api   = { sa = "api", max = 10, cpu = "1", memory = "512Mi", public = true }
    web   = { sa = "web", max = 5, cpu = "1", memory = "512Mi", public = true }
    admin = { sa = "web", max = 2, cpu = "1", memory = "512Mi", public = false }
  }
}

resource "google_cloud_run_v2_service" "svc" {
  for_each            = local.run_services
  name                = each.key
  location            = var.region
  deletion_protection = false
  # Admin is reachable only through Cloudflare Access once ADR-0007 is decided.
  ingress = each.value.public ? "INGRESS_TRAFFIC_ALL" : "INGRESS_TRAFFIC_INTERNAL_LOAD_BALANCER"

  template {
    service_account                  = google_service_account.sa[each.value.sa].email
    max_instance_request_concurrency = 80
    scaling {
      min_instance_count = 0
      max_instance_count = each.value.max
    }
    containers {
      image = var.placeholder_image
      resources {
        limits = { cpu = each.value.cpu, memory = each.value.memory }
      }
      env {
        name  = "APP_ENV"
        value = "staging"
      }
      env {
        # Cloud Run's front end is the one proxy whose X-Forwarded-For entry is trusted (API env).
        name  = "TRUST_PROXY_HOPS"
        value = "1"
      }
      # Commute zone previews call the routing service (T2.9).
      dynamic "env" {
        for_each = each.key == "api" ? [google_cloud_run_v2_service.routing.uri] : []
        content {
          name  = "ROUTING_URL"
          value = env.value
        }
      }
    }
  }

  # CI rolls out new images; Terraform must not revert them.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  for_each = { for k, v in local.run_services : k => v if v.public }
  name     = google_cloud_run_v2_service.svc[each.key].name
  location = var.region
  role     = "roles/run.invoker"
  member   = "allUsers"
}

# --- Routing service: Valhalla with NCR tiles (docs/03 §4, §10.5; ADR-0008; T2.9) -----
# Private: no public invoker; only the API (previews) and the worker (commute.compute) may call it,
# with Google ID tokens. Ingress stays "all" because neither caller has VPC egress; IAM is the gate
# (docs/03 asks for internal ingress, which needs Direct VPC egress on both callers: later).
resource "google_cloud_run_v2_service" "routing" {
  name                = "routing"
  location            = var.region
  deletion_protection = false
  ingress             = "INGRESS_TRAFFIC_ALL"

  template {
    service_account                  = google_service_account.sa["routing"].email
    max_instance_request_concurrency = 8
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = var.placeholder_image
      resources {
        limits = { cpu = "2", memory = "4Gi" }
      }
    }
  }

  # routing-build.yml rolls out new images; Terraform must not revert them.
  lifecycle {
    ignore_changes = [template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.apis]
}

resource "google_cloud_run_v2_service_iam_member" "routing_invoker" {
  for_each = toset(["api", "worker"])
  name     = google_cloud_run_v2_service.routing.name
  location = var.region
  role     = "roles/run.invoker"
  member   = "serviceAccount:${google_service_account.sa[each.key].email}"
}

# --- Worker job + scheduler (docs/04 §11, ADR-0006) ----------------------------
resource "google_cloud_run_v2_job" "worker" {
  name                = "worker"
  location            = var.region
  deletion_protection = false

  template {
    task_count = 1
    template {
      service_account = google_service_account.sa["worker"].email
      timeout         = "600s"
      max_retries     = 1
      containers {
        image = var.placeholder_image
        resources {
          limits = { cpu = "1", memory = "1Gi" }
        }
        env {
          name  = "APP_ENV"
          value = "staging"
        }
        env {
          name  = "NODE_ENV"
          value = "production"
        }
        # Direct connection (not the pooler): jobs may hold a transaction (docs/03 §5.2).
        env {
          name = "DATABASE_URL_DIRECT"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets["DATABASE_URL_DIRECT"].secret_id
              version = "latest"
            }
          }
        }
        env {
          name  = "ROUTING_URL"
          value = google_cloud_run_v2_service.routing.uri
        }
        # Storage tasks (the photo upload sweep): required outside local (the worker refuses to start).
        dynamic "env" {
          for_each = var.supabase_url != "" ? [var.supabase_url] : []
          content {
            name  = "SUPABASE_URL"
            value = env.value
          }
        }
        env {
          name = "SUPABASE_SERVICE_ROLE_KEY"
          value_source {
            secret_key_ref {
              secret  = google_secret_manager_secret.secrets["SUPABASE_SERVICE_ROLE_KEY"].secret_id
              version = "latest"
            }
          }
        }
      }
    }
  }

  lifecycle {
    ignore_changes = [template[0].template[0].containers[0].image, client, client_version]
  }

  depends_on = [google_project_service.apis, google_secret_manager_secret_iam_member.runtime_access]
}

# Cloud Scheduler starts the job as worker-sa with `containerOverrides.args` (tick/daily), which
# needs run.jobs.runWithOverrides: roles/run.invoker alone answers 403.
resource "google_cloud_run_v2_job_iam_member" "worker_invoker" {
  name     = google_cloud_run_v2_job.worker.name
  location = var.region
  role     = "roles/run.jobsExecutorWithOverrides"
  member   = "serviceAccount:${google_service_account.sa["worker"].email}"
}

locals {
  schedules = {
    worker-tick  = { cron = "*/5 * * * *", mode = "tick" }
    worker-daily = { cron = "30 2 * * *", mode = "daily" } # 02:30 IST
  }
}

resource "google_cloud_scheduler_job" "worker" {
  for_each  = local.schedules
  name      = each.key
  region    = var.region
  schedule  = each.value.cron
  time_zone = "Asia/Kolkata"

  http_target {
    http_method = "POST"
    uri         = "https://run.googleapis.com/v2/projects/${var.project_id}/locations/${var.region}/jobs/${google_cloud_run_v2_job.worker.name}:run"
    body = base64encode(jsonencode({
      overrides = { containerOverrides = [{ args = [each.value.mode] }] }
    }))
    headers = { "Content-Type" = "application/json" }
    oauth_token {
      service_account_email = google_service_account.sa["worker"].email
    }
  }

  depends_on = [google_project_service.apis]
}

# --- Budget alerts at 50 / 80 / 100 % (docs/03 §4.2) ---------------------------
data "google_project" "this" {}

resource "google_billing_budget" "monthly" {
  count           = var.billing_account_id != "" && var.monthly_budget_inr != null ? 1 : 0
  billing_account = var.billing_account_id
  display_name    = "flatrimony-staging monthly"

  budget_filter {
    projects = ["projects/${data.google_project.this.number}"]
  }

  amount {
    specified_amount {
      currency_code = "INR"
      units         = tostring(var.monthly_budget_inr)
    }
  }

  dynamic "threshold_rules" {
    for_each = [0.5, 0.8, 1.0]
    content {
      threshold_percent = threshold_rules.value
    }
  }
}
