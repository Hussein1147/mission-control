# Pipeline Contract — SFModel Backtest System

> Version: 1.0 | Date: 2026-03-29 | Status: Active

This document is the authoritative specification for running the SFModel backtest pipeline. All agents, CI jobs, and human operators MUST follow this contract.

---

## 1. Entrypoints

All commands are subcommands of `mnq-tv-debugger` (installed via `pip install -e .` from the `mnq_tv_debugger` repo).

| Command | Purpose | When to use |
|---------|---------|-------------|
| `canonical-pipeline` | Full replay + regression gate + artifact write | Scheduled gate, release validation |
| `drift-check` | Prove the gate catches regressions (mutates a metric) | After canonical-pipeline; CI verification |
| `smoke` | Fast schema-only run on truncated data (100 bars) | PR CI checks |
| `verify-baseline` | Compare replay output to approved baseline | Ad-hoc verification |
| `preflight` | Environment and dependency check | Before any pipeline run |

### Invocation

```bash
# Preferred: via installed CLI
mnq-tv-debugger canonical-pipeline

# Alternative: via module
cd /Users/djibrilkeita/mnq_tv_debugger && PYTHONPATH=src python3 -m mnq_tv_debugger.cli canonical-pipeline
```

No commands accept flags — all configuration is read from input files.

---

## 2. Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| **0** | Success — gate passed (or smoke schema valid) | Proceed |
| **1** | Failure — regression gate detected drift, schema invalid, or missing inputs | Investigate `stderr` for details |
| **143** | External SIGTERM (128 + signal 15) — process was killed by its parent | **This is a runner/harness bug, not a pipeline failure.** See §6. |

### The 143 Rule

**Raw exit 143 without context is not acceptable.** If the termination signal originates from our tooling (orchestrator, CI runner, Claude Code Bash tool), the harness MUST:

1. Print a diagnostic message to `stderr` before sending SIGTERM, e.g.:
   ```
   [harness] SIGTERM: subprocess exceeded timeout budget of 300s
   ```
2. Log the elapsed wall-clock time and the configured timeout.
3. The pipeline itself installs no SIGTERM handler — if a handler fires, it is instrumentation (see `instrumented_r2_runner.py`), not production behavior.

Any CI or orchestrator integration that produces a bare `exit 143` without an accompanying stderr message is a **contract violation** to be fixed in the harness, not the pipeline.

---

## 3. stdout vs stderr Ownership

| Stream | Owner | Content |
|--------|-------|---------|
| **stdout** | Pipeline | Progress banners (`[canonical-pipeline] Running...`), gate PASS/FAIL lines, artifact path. Machine-parseable status lines. |
| **stderr** | Pipeline (errors) + Harness (kill messages) | Gate FAIL details, missing file errors, schema validation errors. Harness timeout/kill diagnostics. |

**Rules:**
- Pipeline writes structured progress to stdout; errors and failures to stderr.
- Harness/runner MUST NOT write to stdout — it belongs to the pipeline.
- Harness kill/timeout messages go to stderr with a `[harness]` prefix to distinguish from pipeline errors.
- CI systems should capture both streams separately and surface stderr in failure summaries.

---

## 4. Input / Output Artifact Paths

### Inputs (read-only)

All under `mnq_tv_debugger/inputs/`:

| File | Role | Required by |
|------|------|-------------|
| `baseline_strategy.pine` | Pine source of record | All commands (SHA256 hashed into artifacts) |
| `primary_5m.csv` | 5-minute OHLCV candles | canonical-pipeline, drift-check, verify-baseline |
| `reference_60m.csv` | 60-minute reference data | canonical-pipeline, smoke |
| `reference_1d.csv` | Daily reference data | canonical-pipeline, smoke |
| `smoke_5m.csv` | Truncated 5m data (100 rows) | smoke |
| `baseline_settings.json` | Strategy parameters | All replay commands |
| `baseline_metadata.json` | Fees, slippage, sessions | All replay commands |

### Outputs (written)

| Path | Written by | Content |
|------|-----------|---------|
| `outputs/canonical_pipeline/canonical_run.json` | canonical-pipeline | Full artifact: metrics, gate checks, trade summary, Pine SHA256, timestamp |
| `outputs/smoke/smoke_run.json` | smoke | Schema-validated artifact (no numeric gate) |
| `outputs/analysis/baseline_v1_approved.json` | Manual (immutable) | Approved baseline reference — **never overwritten by automation** |

### Artifact Schema

Every artifact (canonical or smoke) MUST contain these keys with the specified types:

```
version:              str    ("v1")
timestamp:            str    (ISO 8601 UTC)
data_source:          str    (dataset name)
covered_window_start: str    (datetime or "N/A" for smoke)
pine_source_sha256:   str    (hex digest)
canonical_metrics:    dict   {trades, net_pnl, profit_factor, max_drawdown}
actual_metrics:       dict   {trades, net_pnl, profit_factor, max_drawdown}
gate_checks:          list   [{metric, target, actual, tolerance, passed}]
gate_passed:          bool
trade_summary:        dict   {trade_count, net_pl, profit_factor, max_drawdown, long_pl, short_pl, winner_count, loser_count, be_count}
```

---

## 5. Regression Gate Tolerances

| Metric | Canonical Target | Tolerance | Match type |
|--------|-----------------|-----------|------------|
| `trades` | 86 | 0 | Exact |
| `net_pnl` | $13,812.50 | ±$0.01 | Float |
| `profit_factor` | 2.45 | ±0.01 | Float |
| `max_drawdown` | $1,665.00 | ±$0.01 | Float |

Any metric outside tolerance → gate fails → exit 1.

---

## 6. Timeout Budgets per Stage

Measured on the canonical dataset (2025-12-29 through 2026-03-23, ~2347 bars) on the development machine (2026-03-29 instrumented run):

| Phase | Measured Wall Time | Peak RSS | Budget (with 3x margin) |
|-------|-------------------|----------|------------------------|
| Python import + init | 0.4s | 93 MB | **5s** |
| Baseline replay | 51s | 235 MB | **180s** |
| R2 replay (if enabled) | 52s | 296 MB | **180s** |
| Gate + artifact write | <1s | — | **5s** |
| **canonical-pipeline total** | **~104s** | **376 MB** | **300s (5 min)** |
| **smoke total** | **~5s** | **~100 MB** | **30s** |
| **drift-check total** | **<5s** | **~100 MB** | **30s** |

### Timeout Requirements for Runners

| Runner | Minimum timeout | Recommended | Config location |
|--------|----------------|-------------|-----------------|
| Claude Code Bash tool | 300,000ms | 600,000ms | `timeout` parameter in Bash tool call |
| Orchestrator subprocess | 5 min | 10 min | `DEFAULT_SPAWN_IDLE_TIMEOUT_MIN` in `orchestrator.ts` |
| Codex tool timeout | 300s (enforced floor) | 600s | `CODEX_TOOL_TIMEOUT_SEC` env var / `agent-command-config.ts` |
| CI runner (GitHub Actions) | 5 min | 10 min | `timeout-minutes` in workflow YAML |

**Any runner that cannot guarantee the minimum timeout MUST NOT run `canonical-pipeline`.**

---

## 7. Failure Classification

When a pipeline run fails, classify the failure using this decision tree:

```
Exit code 0?
  └─ Yes → Success. Done.

Exit code 1?
  └─ stderr contains "gate FAILED"?
      └─ Yes → REGRESSION DRIFT. Metrics changed. Investigate replay logic.
  └─ stderr contains "not found"?
      └─ Yes → MISSING INPUT. Check input file paths.
  └─ stderr contains "Schema validation FAILED"?
      └─ Yes → SCHEMA ERROR. Artifact structure broken.
  └─ Otherwise → LOGIC FAILURE. Read stderr for details.

Exit code 143 (or 137)?
  └─ stderr contains "[harness]" prefix?
      └─ Yes → RUNNER TIMEOUT. Increase timeout budget per §6.
  └─ stderr is empty?
      └─ CONTRACT VIOLATION. The runner killed the process without
         logging a reason. Fix the runner, not the pipeline.

Exit code 137 (128 + SIGKILL)?
  └─ OOM KILL. Check peak RSS against available memory.
     The pipeline should stay under 400 MB; if it exceeds this,
     investigate for memory leaks in the replay loop.

Any other code?
  └─ UNEXPECTED. Capture full stdout + stderr and escalate.
```

---

## 8. CI Integration Notes

### PR CI (smoke)
- Run `mnq-tv-debugger smoke` on every PR that touches `src/` or `inputs/`.
- Timeout: 30s. Exit 0 = merge-eligible. Exit 1 = block.
- Does NOT validate numeric metrics — only schema.

### Scheduled Gate (canonical-pipeline)
- Run `mnq-tv-debugger canonical-pipeline` on a schedule (e.g., nightly or weekly).
- Timeout: 5 min minimum. Exit 0 = baseline intact. Exit 1 = alert team.
- Follow with `mnq-tv-debugger drift-check` to confirm gate sensitivity.

### Required CI Practices
1. Capture stdout and stderr as separate artifacts.
2. On exit 143: surface the harness stderr message in the failure summary. If no message exists, file a bug against the runner — not the pipeline.
3. On exit 1: surface the FAIL lines from stderr.
4. Never retry silently — every failure must be classified per §7 before re-running.
