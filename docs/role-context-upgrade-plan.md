# Senior Analytics Engineering Skill-System Upgrade Plan

## Current Snapshot (Branch Baseline)

- The repository currently contains 32 analytics-engineering skills across modeling, quality, governance, orchestration, and BI domains.
- Existing skills are broad and useful, but they are primarily guidance-oriented rather than enforcing a rigid agent execution workflow.
- The collection does not yet follow a standardized, mandatory phase architecture for context gathering, execution constraints, and CLI validation.
- Most skills reference `.claude/data-stack-context.md`, but they do not consistently force an explicit warehouse check before SQL generation.
- Validation guidance is uneven; many skills do not require terminal verification loops like `dbt compile`, `dbt test`, and `sqlfluff lint` before completion.

## Gap Analysis Against New Role Context

### 1) DAG Awareness Is Not Institutionalized Yet
**Gap:** Skills discuss good modeling practices, but few require explicit upstream/downstream dependency discovery as a first mandatory step.

**Impact:** Subordinate coding agents can still write models without scanning lineage, which risks breaking downstream marts, tests, and exposures.

**Upgrade Target:** Every model-changing skill must include a mandatory terminal-based dependency discovery phase (search refs/sources, inspect `dbt_project.yml`, inspect `manifest.json` when available).

### 2) Execution + Validation Loops Need Hard Enforcement
**Gap:** Skills often stop at "here is SQL/YAML," without mandatory autonomous compile/lint/test loops.

**Impact:** Agents can ship syntactically invalid SQL, broken refs, style violations, or untested transformations.

**Upgrade Target:** Every build/refactor skill must include explicit pass criteria and required rerun loops for:
- `dbt compile --select ...`
- `dbt test --select ...` (or scoped alternatives)
- `sqlfluff lint ...` where SQL is authored
- Optional: `dbt build --select ...` for integration-ready changes

### 3) Dialect Guardrails Need Stronger Constraints
**Gap:** Skills mention multiple warehouses but do not consistently prohibit "generic SQL" behavior.

**Impact:** Agents may mix dialects (e.g., Snowflake vs BigQuery semantics), causing runtime failures and hidden performance issues.

**Upgrade Target:** Every SQL-authoring skill must require reading `.claude/data-stack-context.md` first and selecting warehouse-optimized syntax patterns before writing queries.

### 4) Standardized SKILL.md Architecture Is Missing
**Gap:** Existing skills use diverse heading patterns and prose structure.

**Impact:** Execution quality varies by skill, and subordinate agents are not forced into a verifiable operating model.

**Upgrade Target:** Refactor all skills to the required architecture:
1. `# 🧠 Context & Prerequisites`
2. `# 🔍 Step 1: Context Gathering (MANDATORY)`
3. `# 🛠️ Step 2: Execution Rules & Syntax`
4. `# ✅ Step 3: Validation Phase (MANDATORY CLI COMMANDS)`
5. `# 🚨 Common Pitfalls (Self-Correction Guardrails)`

## Phased Implementation Plan

## Phase 0: Establish Enforcement Framework (1 PR)

**Objective:** Define the new operating contract once so all skill updates are consistent.

**Actions:**
1. Update `CONTRIBUTING.md` with the exact mandatory SKILL template and required verification loops.
2. Add a reusable "validation command matrix" (dbt + sqlfluff + warehouse notes) for authors.
3. Add a "DAG discovery checklist" snippet to be embedded in all model-authoring skills.
4. Add an update policy requiring version bumps in `VERSIONS.md` for each migrated skill.

**Acceptance Criteria:**
- Contributors can copy/paste a canonical template.
- Reviewers can reject skills that do not include mandatory context + validation phases.

## Phase 1: Migrate High-Risk Modeling Skills First (2-3 PRs)

**Objective:** Prioritize skills where bad SQL causes maximum DAG impact.

**Wave 1 Skills (highest priority):**
- `data-modeling`
- `staging-layer`
- `incremental-models`
- `slowly-changing-dimensions`
- `marts-design`
- `data-quality-testing`
- `dbt-unit-testing`
- `dbt-project-setup`

**Actions per skill:**
1. Refactor to the standardized 5-section architecture.
2. Add mandatory repo exploration commands before any SQL authoring.
3. Add warehouse decision gate tied to `.claude/data-stack-context.md`.
4. Add explicit validation loop commands and "fix + rerun" requirement.
5. Add 2-4 concrete pitfall checks tied to common agent mistakes.

**Acceptance Criteria:**
- Each migrated skill contains deterministic, enforceable steps.
- Each migrated skill includes CLI pass criteria before output.

## Phase 2: Migrate Remaining SQL/Lineage/Governance Skills (2-4 PRs)

**Objective:** Ensure end-to-end consistency beyond core modeling.

**Target Skills:**
- `entity-resolution`, `activity-schema`, `event-modeling`, `funnel-analysis`, `cohort-analysis`
- `data-lineage`, `data-contracts`, `warehouse-optimization`, `dbt-ci-cd`
- `pipeline-design`, `ingestion-strategy`, `data-observability-audit`

**Actions:**
- Apply same 5-section architecture.
- Add role-specific validation commands (e.g., lineage export checks, CI dry runs, catalog assertions).
- Tighten cost/performance guardrails where compute-heavy patterns are involved.

## Phase 3: BI + Enablement Skills Normalization (1-2 PRs)

**Objective:** Align non-SQL-heavy skills with the same rigid execution model.

**Target Skills:**
- `dashboard-design`, `self-serve-analytics`, `kpi-framework`, `looker-lkml`, `data-catalog`, `access-control`, `pii-handling`

**Actions:**
- Keep mandatory context gathering, but tune validation for each domain (semantic checks, governance checks, permission checks, dashboard QA checklists).
- Add explicit "definition-of-done" criteria for artifacts produced.

## Phase 4: Continuous Compliance Automation (1 PR)

**Objective:** Prevent drift as new skills are added.

**Actions:**
1. Add a zero-dependency CLI linter that verifies SKILL structure and mandatory phrases.
2. Add CI check to fail PRs if required sections or validation commands are missing.
3. Add simple report output (compliant vs non-compliant skills).

**Acceptance Criteria:**
- New skill PRs cannot merge if they violate architecture/validation requirements.
- Maintainers can monitor migration progress automatically.

## Recommended Immediate Next 7 Days

1. Ship Phase 0 framework updates.
2. Migrate 3 highest-risk skills first: `incremental-models`, `staging-layer`, `data-modeling`.
3. Add a temporary migration tracker in `VERSIONS.md` notes (e.g., "template-v2 complete").
4. Run a full pass to ensure every migrated skill remains <500 lines and second-person, opinionated.
5. Start automation (Phase 4) before broad migration is complete to avoid regressions.

## Definition of Done for This Upgrade Program

The migration is complete when all skills:
- Use the standardized architecture exactly.
- Begin with mandatory context gathering that includes DAG discovery.
- Enforce warehouse-aware syntax selection using `.claude/data-stack-context.md`.
- Require autonomous CLI validation loops before final response.
- Include explicit pitfall guardrails for self-correction.
