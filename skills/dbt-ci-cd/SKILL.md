---
name: dbt-ci-cd
description: "Set up CI/CD pipelines for dbt projects using GitHub Actions, GitLab CI, or dbt Cloud jobs with slim CI and state comparison. Use when automating dbt deployments, setting up PR checks, or implementing environment promotion. Triggers: 'CI/CD', 'continuous integration', 'GitHub Actions', 'slim CI', 'deployment pipeline', 'dbt deploy', 'automate dbt', 'dbt cloud jobs'."
triggers:
  - "CI/CD"
  - "continuous integration"
  - "GitHub Actions"
  - "slim CI"
  - "deployment pipeline"
  - "automate dbt"
  - "dbt cloud jobs"
reads_first:
  - data-stack-context
  - dbt-project-setup
cli_tools:
  - manifest-coverage.js
  - test-results.js
produces:
  - ".github/workflows/dbt-ci.yml"
  - "dbt Cloud job configuration"
validates_with:
  - "dbt parse"
  - "dbt build --select state:modified+"
  - "node tools/clis/manifest-coverage.js --manifest target/manifest.json"
---

# dbt CI/CD

I'll help you build a CI/CD pipeline that automatically tests, lints, and deploys dbt changes safely.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: dbt Core or Cloud, warehouse type, CI platform (GitHub Actions/GitLab CI), git workflow.

## Before You Start

- Check if `.github/workflows/` directory exists and read any existing CI config before creating a new one.
- Run `node tools/clis/manifest-coverage.js --manifest target/manifest.json` to see current test coverage — CI will only be as good as the tests it runs.
- Confirm that `target/manifest.json` (prod baseline) is stored in S3/GCS/artifact storage — slim CI requires a previous manifest for state comparison.
- Verify warehouse CI credentials (role, user, schema) exist before writing the workflow.

## CI/CD Workflow Overview

```
Developer pushes branch
    │
    ▼
PR Opened → CI Pipeline triggers
    ├─ SQLFluff lint
    ├─ dbt parse (syntax check)
    ├─ dbt build --select state:modified+ (affected models only)
    ├─ dbt test (affected models)
    └─ Comment PR with results
    │
    ▼
PR Approved + Merged → CD Pipeline triggers
    ├─ dbt build --select state:modified+ (prod)
    └─ Notify on success/failure
```

---

## GitHub Actions — CI (Pull Request Checks)

```yaml
# .github/workflows/dbt-ci.yml
name: dbt CI

on:
  pull_request:
    branches: [main]
    paths:
      - 'models/**'
      - 'macros/**'
      - 'tests/**'
      - 'snapshots/**'
      - 'seeds/**'
      - 'dbt_project.yml'
      - 'packages.yml'

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true  # Cancel older runs for same branch

env:
  DBT_USER: ci_pr${{ github.event.pull_request.number }}

jobs:
  dbt-ci:
    runs-on: ubuntu-latest
    environment: ci

    steps:
      - uses: actions/checkout@v4

      # Cache Python deps
      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
          cache-dependency-path: requirements.txt

      - name: Install dependencies
        run: pip install -r requirements.txt
        # requirements.txt: dbt-snowflake==1.8.x, sqlfluff, sqlfluff-templater-dbt

      - name: Install dbt packages
        run: dbt deps

      # Step 1: Lint SQL
      - name: SQLFluff lint
        run: |
          sqlfluff lint models/ \
            --format github-annotation \
            --annotation-level warning
        continue-on-error: true  # Warnings don't block PR

      # Step 2: Validate syntax
      - name: dbt parse
        run: dbt parse --target ci
        env:
          SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_CI_USER }}
          SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_CI_PASSWORD }}

      # Step 3: Download prod artifacts (for state comparison)
      - name: Download prod manifest
        run: |
          aws s3 cp s3://my-dbt-artifacts/prod/manifest.json ./prod-artifacts/manifest.json
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}

      # Step 4: Build only changed models and their dependents
      - name: dbt build (modified + downstream)
        run: |
          dbt build \
            --select "state:modified+" \
            --defer \
            --state ./prod-artifacts \
            --target ci \
            --fail-fast
        env:
          SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_CI_USER }}
          SNOWFLAKE_PASSWORD: ${{ secrets.SNOWFLAKE_CI_PASSWORD }}

      # Step 5: Comment results on PR
      - name: Comment PR with results
        uses: actions/github-script@v7
        if: always()
        with:
          script: |
            const outcome = '${{ job.status }}' === 'success' ? '✅' : '❌';
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `${outcome} dbt CI: ${{ job.status }}\n\nRun: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}`
            });
```

---

## GitHub Actions — CD (Production Deployment)

```yaml
# .github/workflows/dbt-cd.yml
name: dbt Production Deploy

on:
  push:
    branches: [main]
    paths:
      - 'models/**'
      - 'macros/**'
      - 'tests/**'
      - 'snapshots/**'
      - 'dbt_project.yml'
      - 'packages.yml'

jobs:
  dbt-prod:
    runs-on: ubuntu-latest
    environment: production
    concurrency:
      group: production  # Only one prod deploy at a time
      cancel-in-progress: false

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-python@v5
        with:
          python-version: '3.11'
          cache: pip
          cache-dependency-path: requirements.txt

      - run: pip install -r requirements.txt
      - run: dbt deps

      # Download previous prod manifest for state comparison
      - name: Download previous manifest
        run: |
          aws s3 cp s3://my-dbt-artifacts/prod/manifest.json ./prev-artifacts/manifest.json \
            || echo "No previous manifest (first run)"

      # Build only changed models in production
      - name: dbt build production
        run: |
          dbt build \
            --select "state:modified+" \
            --defer \
            --state ./prev-artifacts \
            --target prod
        env:
          SNOWFLAKE_ACCOUNT: ${{ secrets.SNOWFLAKE_ACCOUNT }}
          SNOWFLAKE_USER: ${{ secrets.SNOWFLAKE_PROD_USER }}
          SNOWFLAKE_PRIVATE_KEY: ${{ secrets.SNOWFLAKE_PROD_PRIVATE_KEY }}

      # Save new manifest as the new "prod" baseline
      - name: Upload manifest to S3
        if: success()
        run: |
          aws s3 cp target/manifest.json s3://my-dbt-artifacts/prod/manifest.json

      # Run source freshness checks
      - name: Check source freshness
        run: dbt source freshness --target prod
        continue-on-error: true  # Don't fail deploy on stale sources

      # Alert on failure
      - name: Notify Slack on failure
        if: failure()
        run: |
          curl -X POST ${{ secrets.SLACK_WEBHOOK_URL }} \
            -H 'Content-type: application/json' \
            --data '{"text": "❌ dbt production deploy failed!\nRun: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}"}'
```

---

## Pre-commit Hooks

Catch issues before they reach CI. Add `.pre-commit-config.yaml` to your repo root:

```yaml
# .pre-commit-config.yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: end-of-file-fixer
      - id: trailing-whitespace
      - id: check-yaml
      - id: check-merge-conflict

  - repo: https://github.com/sqlfluff/sqlfluff
    rev: 3.1.0
    hooks:
      - id: sqlfluff-lint
        args: [--dialect, snowflake]  # or bigquery, spark, ansi
        files: ^models/.*\.sql$

  - repo: https://github.com/adrienverge/yamllint
    rev: v1.35.1
    hooks:
      - id: yamllint
        args: [--strict]
        files: ^(models|snapshots|seeds)/.*\.yml$
```

Install:
```bash
pip install pre-commit
pre-commit install       # installs git hook
pre-commit run --all-files  # run against all files once
```

---

## GitLab CI/CD

Equivalent pipeline for GitLab:

```yaml
# .gitlab-ci.yml
stages:
  - lint
  - ci
  - deploy

variables:
  DBT_USER: "ci_${CI_MERGE_REQUEST_IID}"
  PIP_CACHE_DIR: "$CI_PROJECT_DIR/.cache/pip"

cache:
  paths:
    - .cache/pip

.dbt_base:
  image: python:3.11-slim
  before_script:
    - pip install -r requirements.txt
    - dbt deps
  only:
    changes:
      - models/**/*
      - macros/**/*
      - tests/**/*
      - dbt_project.yml
      - packages.yml

sqlfluff:
  extends: .dbt_base
  stage: lint
  script:
    - sqlfluff lint models/ --dialect snowflake
  allow_failure: true  # warn but don't block

dbt-ci:
  extends: .dbt_base
  stage: ci
  script:
    - dbt parse --target ci
    - aws s3 cp s3://my-dbt-artifacts/prod/manifest.json ./prod-artifacts/manifest.json || true
    - dbt build --select "state:modified+" --defer --state ./prod-artifacts --target ci --fail-fast
  environment:
    name: ci
  only:
    - merge_requests

dbt-deploy:
  extends: .dbt_base
  stage: deploy
  script:
    - aws s3 cp s3://my-dbt-artifacts/prod/manifest.json ./prev-artifacts/manifest.json || true
    - dbt build --select "state:modified+" --defer --state ./prev-artifacts --target prod
    - aws s3 cp target/manifest.json s3://my-dbt-artifacts/prod/manifest.json
  environment:
    name: production
  only:
    - main
  when: on_success
```

---

## dbt Cloud CI/CD (Alternative)

If using dbt Cloud, use Slim CI instead of GitHub Actions:

```yaml
# In dbt Cloud: create a "CI Job" with these settings:
Job name: PR Validation
Commands:
  - dbt build --select state:modified+ --defer --state ./target
Triggers:
  - Pull request triggers: enabled
  - Run on PR comment: /dbt-ci
Environment: CI environment (development credentials)
```

**Slim CI benefits:** dbt Cloud handles artifact storage and diff automatically.

---

## profiles.yml for CI

```yaml
# profiles.yml
my_project:
  outputs:
    ci:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_USER') }}"
      password: "{{ env_var('SNOWFLAKE_PASSWORD') }}"
      role: CI_ROLE
      database: ANALYTICS
      warehouse: CI_WH
      # CI schema: unique per PR number
      schema: "ci_{{ env_var('DBT_USER', 'default') }}"
      threads: 8

    prod:
      type: snowflake
      account: "{{ env_var('SNOWFLAKE_ACCOUNT') }}"
      user: "{{ env_var('SNOWFLAKE_PROD_USER') }}"
      private_key: "{{ env_var('SNOWFLAKE_PRIVATE_KEY') }}"
      role: TRANSFORMER
      database: ANALYTICS
      warehouse: TRANSFORMING_PROD
      schema: prod
      threads: 16
```

---

## Branch Strategy

```
main          — production; protected; requires PR + CI pass
   ↑
feature/*     — developer branches; PR → main
   └─ feature/add-revenue-mart
   └─ feature/fix-customer-dedup

release/*     — (optional) staging branch for scheduled releases
```

**Protection rules (GitHub):**
- `main`: require PR, require status checks (dbt CI), dismiss stale reviews
- No direct pushes to `main`

---

## CI/CD Checklist

**Before going live:**
- [ ] CI runs on every PR opening and commit
- [ ] CI uses a dedicated CI warehouse/credentials (not prod)
- [ ] CI schema is unique per PR (prevents collision)
- [ ] Prod manifest uploaded after every successful deploy
- [ ] `--defer` configured so CI only tests changed models
- [ ] Slack or PagerDuty alert on prod deploy failure
- [ ] CI cleanup job removes CI schemas older than 7 days

**CI cleanup (add as a scheduled job):**
```sql
-- Snowflake: drop CI schemas older than 7 days
-- Run nightly in GitHub Actions
begin;
for schema_name in (
    select schema_name
    from information_schema.schemata
    where schema_name like 'CI_%'
      and created < current_timestamp - interval '7 days'
) do
    execute immediate 'DROP SCHEMA IF EXISTS ' || :schema_name;
end for;
commit;
```

## Verify Your Work

- Run `dbt parse` locally to confirm the workflow's dbt commands will succeed before committing.
- Test the slim CI command locally: `dbt build --select state:modified+ --defer --state <previous-manifest-path>` before pushing the workflow file.
- After first CI run, check the GitHub Actions log to confirm the manifest upload step succeeded.

## If Something Goes Wrong

- **State comparison fails**: The previous manifest was not found — confirm the artifact upload/download steps in the CI workflow reference the correct S3/GCS path and that credentials are set.
- **Credentials not found in CI**: Check that secrets are set in the GitHub Actions environment or repository secrets — environment-scoped secrets require the `environment:` key in the job definition.
- **Slim CI selects too many models**: Verify `--defer` is configured correctly and the manifest comes from the prod environment, not a stale CI run.
