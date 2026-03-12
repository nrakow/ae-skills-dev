# Plan: Improvements to Pull from marketingskills Repo

## Executive Summary

After reviewing the `coreyhaines31/marketingskills` repo (32 marketing skills) and our `ae-skills-dev` repo (40 analytics engineering skills), three major improvements from the past week's work on marketingskills should be adopted. Our repo already avoids rigid imperatives (their PR #75 is not needed), but we're missing their eval framework, description optimization patterns, and tools registry.

---

## Current State Comparison

| Dimension | ae-skills-dev | marketingskills |
|---|---|---|
| Skills | 40 | 32 |
| Evals | **0** | 197 evals, 1,261 assertions |
| Description avg length | ~375 chars | ~500-800 chars (optimized) |
| Trigger phrases avg | ~6 per skill | ~12+ per skill (with casual variants) |
| Rigid imperatives | 0 (clean) | 0 (cleaned in PR #75) |
| Tools registry | CLI README only | Categorized REGISTRY.md (76 tools) |
| Cross-references in descriptions | Partial | Systematic "For X, see Y" |

---

## Improvement 1: Add Eval Framework (High Priority)

**Source:** PR #74 — "Add evals for all 32 skills (197 total evals, 1261 assertions)"

**What they did:** Created `evals/evals.json` inside each skill directory with 5-8 evals per skill. Each eval has:
- `id`, `prompt` (user query), `expected_output` (description of correct behavior)
- `assertions` (array of specific behavioral checks)
- `files` (related skill files)

**Eval categories per skill:**
1. Core framework usage with a detailed prompt
2. 3-4 scenario-specific evals covering realistic use cases
3. Casual phrasing trigger test (informal/lowercase activation)
4. Boundary test ensuring proper deferral to related skills

**What we should do:**
1. Create an `evals/` directory inside each of our 40 skill directories
2. Write `evals.json` for each skill with 5-8 evals covering:
   - **Core usage:** Test the primary workflow (e.g., "set up incremental models for my orders table")
   - **Scenario variants:** Test 3-4 realistic scenarios specific to the skill domain
   - **Casual trigger:** Test informal language activation (e.g., "my pipeline keeps doing full refreshes and it's killing our warehouse bill")
   - **Boundary/deferral:** Test that out-of-scope requests properly defer to related skills
3. Target: ~240 evals with ~1,500+ assertions across 40 skills
4. Add eval JSON schema validation to CI (as they did in PR #76)

**Assertions should validate:**
- Context file checks (reads `data-stack-context.md`)
- Dialect awareness (handles Snowflake/BigQuery/Databricks/Redshift/DuckDB)
- Section ordering (Before You Start -> Check Context -> Main -> Verify -> Troubleshoot)
- Cost awareness flags
- Proper cross-skill deferral

**Estimated scope:** 40 new `evals/evals.json` files, ~200-240 evals total

---

## Improvement 2: Optimize Skill Descriptions for Better Triggering (High Priority)

**Source:** PR #73 — "Optimize all 32 skill descriptions for better triggering"

**Key insight from their work:** "Claude undertriggers skills by default — descriptions need to be 'pushier' to fire reliably."

**Their four optimization strategies:**
1. **Casual trigger phrases** — Add conversational language reflecting how real users talk about problems
2. **Implicit need triggers** — Include scenarios where users need the skill without naming it
3. **Catch-all guidance** — Add "Use this whenever someone is..." sentences for edge cases
4. **Cross-references** — Add "For X, see Y" links to clarify scope boundaries between related skills

**Current gaps in our descriptions:**
- Our descriptions average ~375 chars vs their ~500-800 chars post-optimization
- Our triggers average ~6 per skill; theirs have 12+ including casual variants
- Most of our descriptions lack frustrated-user language (e.g., "my pipeline is slow" for warehouse-optimization)
- Cross-references between skills are inconsistent

**What we should do:**
1. Audit all 40 skill descriptions against these four strategies
2. Add casual/frustrated-user trigger phrases to each description:
   - `incremental-models`: "my models take forever", "full refresh is too slow", "warehouse costs are insane"
   - `data-quality-testing`: "bad data", "my numbers don't match", "data is wrong"
   - `warehouse-optimization`: "queries are slow", "warehouse costs too high", "everything takes forever"
   - `pipeline-design`: "my pipeline keeps breaking", "orchestration is a mess"
   - etc.
3. Add implicit need triggers where users need the skill without naming it
4. Add systematic "For X, see Y" cross-references to all descriptions
5. Add catch-all "Use this whenever someone is..." guidance sentences
6. Keep all descriptions under 1,024 character limit
7. Expand `triggers` arrays to include casual variants (target 10-15 per skill)

**Estimated scope:** 40 SKILL.md description rewrites + triggers expansion, then regenerate `index.json`

---

## Improvement 3: Add Tools REGISTRY.md (Medium Priority)

**Source:** PR #70 and existing repo structure

**What they have:** A `tools/REGISTRY.md` file that serves as a categorized, machine-readable index of all 76 tools across 26 categories, with:
- Tool name, category, and purpose
- Integration method (API, MCP, CLI, SDK)
- Quick selection guidance per category

**What we currently have:**
- `tools/clis/README.md` — documents 10 CLI scripts
- `tools/integrations/` — 21 platform guides as individual markdown files
- No unified registry

**What we should do:**
1. Create `tools/REGISTRY.md` that indexes all tools in one place:
   - **Warehouses** (5): Snowflake, BigQuery, Databricks, Redshift, DuckDB
   - **Transformation** (2): dbt-core, dbt-cloud
   - **Ingestion** (2): Fivetran, Airbyte
   - **Orchestration** (3): Airflow, Dagster, Prefect
   - **BI** (4): Looker, Metabase, Lightdash, Tableau
   - **Observability** (3): Elementary, Monte Carlo, Soda
   - **Catalog** (1): OpenMetadata
   - **CLI Utilities** (10): All scripts from `tools/clis/`
2. Include a "choosing the right tool" quick reference per category
3. Reference the registry from CLAUDE.md so agents can discover tools quickly

**Estimated scope:** 1 new file (`tools/REGISTRY.md`), minor CLAUDE.md update

---

## Improvement 4: Resolve Trigger Phrase Conflicts (Medium Priority)

**Source:** PR #73 commit 2 — resolved triggering conflicts between skills

**What they found:** After optimizing descriptions, they discovered trigger overlap between skills (e.g., "ROI calculator" triggering both `sales-enablement` and `free-tool-strategy`).

**What we should do:**
1. After expanding our trigger phrases (Improvement 2), run a conflict analysis across all 40 skills
2. Identify overlapping triggers between related skills, especially:
   - `data-quality-testing` vs `data-contracts` vs `data-observability-audit`
   - `pipeline-design` vs `ingestion-strategy`
   - `marts-design` vs `new-mart-build`
   - `data-modeling` vs `staging-layer`
   - `funnel-analysis` vs `cohort-analysis`
3. Resolve conflicts by narrowing scope language and adding explicit "For X, see Y" deferral
4. Add boundary evals (from Improvement 1) to prevent regression

**Estimated scope:** Conflict analysis script + targeted description edits

---

## Improvement 5: Add Eval Validation to CI (Low Priority)

**Source:** PR #76 — Independent Codex review validated assertions against skill content

**What they did:** Used Codex CLI to independently verify that eval assertions accurately reflect skill content, catching 5 mismatches.

**What we should do:**
1. Add a GitHub Action or pre-commit check that validates:
   - Every `evals/evals.json` file conforms to the expected schema
   - All referenced skill files exist
   - Assertion counts are within expected range (5-8 evals per skill)
2. Consider adding an LLM-powered assertion audit step (as they used Codex for)

**Estimated scope:** 1 GitHub Action workflow file, 1 validation script

---

## Implementation Order

| Phase | Improvement | Rationale |
|---|---|---|
| **Phase 1** | #2 Description optimization | Foundation — better triggering benefits everything |
| **Phase 2** | #4 Trigger conflict resolution | Must follow description expansion |
| **Phase 3** | #1 Eval framework | Largest effort; depends on finalized descriptions |
| **Phase 4** | #3 Tools REGISTRY.md | Independent; can be done anytime |
| **Phase 5** | #5 CI validation | Depends on eval framework being in place |

---

## What We Do NOT Need to Pull

- **PR #75 (Writing audit for rigid imperatives):** Our skills already have zero instances of ALWAYS/NEVER/MUST in caps. No action needed.
- **Marketing-specific CLI tools:** Their tools (Clay, ZoomInfo, Outreach, etc.) are marketing-domain-specific and irrelevant to analytics engineering.
- **Their skill content:** The actual marketing skills (seo-audit, copywriting, paid-ads, etc.) are a different domain. We take the patterns, not the content.
- **Their metadata format:** They use `metadata.version` in frontmatter; we use a richer frontmatter with `triggers`, `reads_first`, `consumes`, `produces`, `cli_tools`, `min_dbt_version`, `validates_with`. Our format is more comprehensive and should be retained.
