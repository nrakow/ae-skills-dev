---
name: data-incident-response
description: "Investigate and resolve data incidents -- from 'the dashboard is wrong' to full pipeline outages. Use when a stakeholder reports bad numbers, when an alert fires, when data is late or missing, when a metric looks off, or when you just know something is broken but can't find where. Fires for 'the CEO says revenue is zero,' 'why is everything null today,' or 'help, the pipeline blew up.' Follows structured triage: scope blast radius, trace lineage to root cause, fix, and add a postmortem test. Use this whenever something is wrong with the data and you need to figure out what happened -- even vague complaints like 'the data feels off.' For proactive monitoring, see anomaly-detection. For observability gaps, see data-observability-audit. For adding tests after, see data-quality-testing."
triggers:
  - "data incident"
  - "pipeline is broken"
  - "data quality alert"
  - "metric is wrong"
  - "data is late"
  - "dashboard is wrong"
  - "investigate data issue"
  - "data outage"
  - "numbers don't look right"
  - "something is broken"
  - "stakeholder says data is wrong"
  - "revenue dropped to zero"
  - "why is this metric off"
  - "data is missing"
  - "help me triage this data issue"
reads_first:
  - data-stack-context
cli_tools:
  - test-results.js
  - source-freshness.js
  - manifest-lineage.js
  - manifest-coverage.js
produces:
  - "incident timeline"
  - "root cause analysis"
  - "remediation SQL or config"
  - "postmortem test"
validates_with:
  - "dbt test --select <affected_model>"
  - "node tools/clis/test-results.js --results target/run_results.json"
---

## When to Use This Workflow

Use `data-incident-response` when a data alert fires, a dashboard shows unexpected numbers, a pipeline is delayed, or a stakeholder reports incorrect data. Work through the phases in order — do not skip to remediation without completing triage first.

## Before You Start

Read `.claude/data-stack-context.md`. Then run these CLI tools immediately to get a baseline:
```bash
node tools/clis/test-results.js --results target/run_results.json     # which tests are failing?
node tools/clis/source-freshness.js --results target/sources.json     # is source data late?
node tools/clis/manifest-coverage.js --manifest target/manifest.json  # which models have no tests?
```

---

## Phase 1: Triage — Establish Scope

**Skill**: `data-observability-audit`

Determine what is broken, how far it has spread, and when it started.

**What to do:**
1. Invoke the `data-observability-audit` skill.
2. Run the three CLI tools above and document the output.
3. Identify: which models are failing tests? Which sources are stale? Which metrics are affected?
4. Estimate the time the incident started based on pipeline run history.
5. **Freeze deploys to production** until the root cause is identified.

**Phase complete when**: You have a list of affected models and an estimated incident start time.

---

## Phase 2: Identify the Root Cause

**Skill**: `anomaly-detection`

Determine whether the issue is a volume drop, distribution shift, schema change, or source data problem.

**What to do:**
1. Invoke the `anomaly-detection` skill.
2. Check Elementary or Soda dashboards for the affected models.
3. Determine if the anomaly is: upstream source data, a schema change, a logic bug in a model, or an infrastructure failure.
4. Run `dbt test --select <affected_model> --store-failures` to capture failure rows.

**Phase complete when**: You have identified the root cause (source issue, schema drift, logic bug, infra failure).

---

## Phase 3: Map the Blast Radius

**Skill**: `data-lineage`

Find all downstream models and dashboards affected by the broken model.

**What to do:**
1. Run `node tools/clis/manifest-lineage.js --manifest target/manifest.json --model <affected_model>` to get downstream dependencies.
2. Invoke the `data-lineage` skill to understand full impact.
3. List all affected downstream models, BI dashboards, and reverse ETL syncs.
4. > **Human required:** Notify stakeholders for any dashboards or CRM syncs in the blast radius. Claude can draft the impact summary message but cannot send Slack messages, emails, or PagerDuty alerts — a human must deliver the notification.

**Phase complete when**: All affected downstream consumers are identified and stakeholders are notified.

---

## Phase 4: Remediate

Based on root cause, apply the appropriate fix:

### If source data is wrong or missing
- Coordinate with the data source owner or ingestion team.
- Do not attempt to patch source data in the staging layer.
- Backfill the affected partitions once source data is corrected.

### If a schema change caused the issue
- Update staging models to handle the new schema.
- Run `dbt compile` to confirm no remaining ref() or column errors.
- Update the `data-stack-context.md` if warehouse schema conventions changed.

### If a model logic bug caused the issue
- Fix the SQL in the affected model.
- Run `dbt build --select <model>+ --full-refresh` if incremental logic is involved.
- Verify row counts against expected values.

### If an infrastructure failure caused the issue
- Check orchestrator logs (Airflow/Dagster/Prefect) for task errors.
- Re-trigger the failed run after the infrastructure issue is resolved.

---

## Phase 5: Add a Postmortem Test

**Skill**: `data-quality-testing`

Every resolved incident must produce a test that would have caught it earlier.

**What to do:**
1. Invoke the `data-quality-testing` skill.
2. Write a test that directly validates the invariant that was violated.
3. Add it to `schema.yml` or `tests/singular/`.
4. Run `dbt test --select <new_test>` to confirm it passes on clean data.

**Phase complete when**: A new test exists and passes. The test would have caught the incident if it had existed before.

---

## Final Verification

```bash
dbt test --select <affected_model>+     # all downstream tests pass
dbt source freshness                    # sources are current
node tools/clis/test-results.js --results target/run_results.json
```

## Verify Your Work

**Do not present output from this skill as complete until every command below passes without error.** If a command fails, consult "If Something Goes Wrong" before asking the user.

- Run `dbt test --select <affected_model>+` to confirm all tests pass across the affected model and its full downstream dependency chain.
- Run `dbt source freshness` to confirm all sources are current and no stale data remains after remediation.
- Run `node tools/clis/test-results.js --results target/run_results.json` to review the full test run summary and confirm zero failures remain.
- Confirm the postmortem test added in Phase 5 passes on clean data and would have caught the incident if it had existed before.
- Verify that any affected BI dashboards or reverse ETL syncs are showing correct data and stakeholders have confirmed resolution.

## If Something Goes Wrong During Remediation

- **Backfill creates duplicates**: you likely have an incremental model without a proper lookback window. Use `dbt build --select <model> --full-refresh` instead of a partial backfill.
- **Fix in one model breaks another downstream**: run `dbt build --select <model>+` (with the plus) to rebuild all downstream models together.
- **Can't identify root cause from tests alone**: add `--store-failures` to `dbt test` and query the failures table directly in the warehouse.
- **Stakeholders need an ETA**: always provide a range, not a point estimate. Share the blast radius list so they can assess impact independently.
