---
name: data-observability-audit
description: "Audit your data observability setup and recommend improvements. Use when assessing current monitoring coverage, building a data reliability roadmap, after a data incident to improve detection, or onboarding an observability tool. Triggers: 'observability audit', 'monitoring coverage', 'data reliability', 'what are we not monitoring', 'data incident review', 'observability maturity'."
---

# Data Observability Audit

I'll audit your current observability setup, identify gaps, and produce a prioritized remediation plan.

## Check Context First

Read `.claude/data-stack-context.md`. Key inputs: observability tool, dbt tests in place, alerting channels, recent incidents.

## Observability Maturity Model

| Level | What you have | What's missing |
|-------|--------------|----------------|
| **0 — Reactive** | No monitoring; issues found by users | Everything |
| **1 — Basic** | Source freshness checks, PK tests | Volume, distribution, alerting |
| **2 — Proactive** | Automated tests + Slack alerts | Anomaly detection, root cause tools |
| **3 — Predictive** | Anomaly detection, lineage-aware alerts | ML-based forecasting, incident correlation |
| **4 — Automated** | Self-healing pipelines, auto-triage | Rare; requires significant investment |

Most teams should target Level 2-3.

---

## Audit Questions

Answer these to assess your current state:

### Coverage
1. What % of dbt models have **at least one test**?
2. What % of mart models have **primary key tests**?
3. What % of source tables have **freshness checks**?
4. Do you monitor **row counts** over time?
5. Do you monitor **null rates** per column?
6. Do you detect **schema drift** (source column changes)?

### Detection Time
7. How long after a data failure do you typically know about it?
8. Do failures come from **automated alerts** or **user complaints**?
9. Do you have **SLAs defined** and tracked?

### Lineage & Root Cause
10. Can you quickly identify **which dashboards are affected** by a model failure?
11. Can you trace an anomaly back to its **source system** within 15 minutes?

---

## Audit Your Current dbt Tests

```bash
# Count test coverage by model
dbt ls --select "resource_type:test" --output json \
| python3 -c "
import json, sys, collections
counts = collections.defaultdict(int)
for line in sys.stdin:
    try:
        obj = json.loads(line)
        parent = obj.get('depends_on', {}).get('nodes', [''])[0]
        model = parent.replace('model.my_project.', '')
        counts[model] += 1
    except:
        pass
for model, count in sorted(counts.items(), key=lambda x: x[1]):
    print(f'{count:3d} tests: {model}')
"

# Models with zero tests (critical gap)
dbt ls --select "resource_type:model" --output json \
| python3 -c "
import json, sys
for line in sys.stdin:
    try:
        obj = json.loads(line)
        if not obj.get('config', {}).get('contract', {}).get('enforced') \
           and 'marts' in obj.get('fqn', []):
            print(obj['name'], '— no contract enforced')
    except:
        pass
"
```

---

## Observability Gap Analysis

### Layer 1: Schema Checks (Foundation)

**What to check:**
- [ ] Every mart model has `unique + not_null` on primary key
- [ ] Every FK column has a `relationships` test
- [ ] Enum/categorical columns have `accepted_values` tests
- [ ] Critical amount columns have `accepted_range` tests

**Quick audit SQL (Snowflake):**
```sql
-- Models missing primary key tests
-- (Run in your warehouse against information_schema)
select
    table_name,
    column_name
from information_schema.columns
where table_schema = 'MARTS'
  and column_name like '%_id'
  and column_name not in (
      -- List your tested PK columns here
      select column_name from your_dbt_test_results
      where test_type = 'unique'
  )
```

### Layer 2: Freshness Checks

**What to check:**
- [ ] All sources in `sources.yml` have `freshness` + `loaded_at_field`
- [ ] `dbt source freshness` runs in CI/CD
- [ ] Freshness alerts route to on-call channel

**Fix:**
```yaml
sources:
  - name: salesforce
    loaded_at_field: _fivetran_synced  # REQUIRED for freshness
    freshness:
      warn_after: {count: 24, period: hour}
      error_after: {count: 48, period: hour}
```

### Layer 3: Volume Monitoring

**What to check:**
- [ ] Row count tracked for every critical mart
- [ ] Volume anomaly alerts configured
- [ ] Historical volume visible in dashboard

**Elementary setup:**
```yaml
# Add to every critical model
data_tests:
  - elementary.volume_anomalies:
      time_bucket:
        period: hour
        count: 1
      anomaly_direction: both
```

### Layer 4: Distribution Monitoring

**What to check:**
- [ ] Null rate monitored for NOT NULL columns
- [ ] Mean/stddev tracked for key metrics
- [ ] Categorical distribution shifts detected

**Elementary setup:**
```yaml
columns:
  - name: net_revenue_usd
    data_tests:
      - elementary.column_anomalies:
          column_anomalies: [null_percent, average, min_value, max_value]
```

### Layer 5: Lineage Awareness

**What to check:**
- [ ] dbt docs generated and accessible
- [ ] Lineage graph shows source → staging → mart → BI connections
- [ ] When a model fails, affected dashboards can be identified in < 5 minutes

**Generate lineage:**
```bash
dbt docs generate
dbt docs serve  # Visual lineage at localhost:8080

# Export lineage graph for incident response
dbt ls --select "+fct_orders+" --output json  # All upstream and downstream of fct_orders
```

### Layer 6: Alerting

**What to check:**
- [ ] Critical failures route to PagerDuty (P1 within 5 minutes)
- [ ] Warning-level issues route to Slack
- [ ] Alert fatigue is low (< 5 false positives per week)
- [ ] On-call rotation is documented

**Alert routing matrix:**
```yaml
# elementary/config.yml (example)
alerts:
  slack:
    - channel: "#data-alerts"
      severity: [error, warning]
  pagerduty:
    - routing_key: "xxx"
      severity: [error]
      # Only PagerDuty for critical models
      filter_by:
        tags: [critical]
```

---

## Remediation Roadmap Template

After the audit, produce a prioritized plan:

```markdown
# Data Observability Remediation Plan

## Current State
- Test coverage: 42% of models have tests
- Freshness checks: 6/12 sources
- Volume monitoring: 0 models
- Mean time to detection: ~4 hours (from user complaints)

## Quick Wins (Week 1-2)
- [ ] Add PK tests to all 8 mart models lacking them
- [ ] Add freshness to remaining 6 sources
- [ ] Configure Slack alert channel for dbt test failures

## Short Term (Month 1)
- [ ] Install Elementary and add volume_anomalies to top 5 mart models
- [ ] Configure PagerDuty integration for P1 failures
- [ ] Generate and publish dbt docs

## Medium Term (Quarter 1)
- [ ] Achieve 90% test coverage on marts
- [ ] Add distribution monitoring to all KPI models
- [ ] Reduce MTTD from 4 hours to < 30 minutes

## Success Metrics
| Metric | Current | Target |
|--------|---------|--------|
| % models with tests | 42% | 90% |
| MTTD (mean time to detect) | 4 hours | 30 minutes |
| % incidents from alerts vs. users | 20% | 90% |
| False positive alerts/week | - | < 5 |
```
