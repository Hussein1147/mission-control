# Promotion Gate Template

> Reusable checklist for promoting a research candidate to the approved baseline.
> All thresholds are machine-checkable. A candidate MUST pass every gate before promotion.

---

## 1. Baseline Reproduction (PIPELINE_CONTRACT.md SS5)

The candidate branch, with the candidate toggle OFF, must reproduce the approved baseline exactly.

| Metric | Target | Tolerance | Match Type | Assert |
|--------|--------|-----------|------------|--------|
| `trades` | 86 | 0 | Exact | `actual == 86` |
| `net_pnl` | 13812.50 | +/-0.01 | Float | `abs(actual - 13812.50) <= 0.01` |
| `profit_factor` | 2.45 | +/-0.01 | Float | `abs(actual - 2.45) <= 0.01` |
| `max_drawdown` | 1665.00 | +/-0.01 | Float | `abs(actual - 1665.00) <= 0.01` |

**Gate command:** `mnq-tv-debugger canonical-pipeline` must exit 0.

---

## 2. No Regression on Existing Test Suite

| Check | Threshold | Assert |
|-------|-----------|--------|
| `canonical-pipeline` exit code | 0 | `exit_code == 0` |
| `drift-check` exit code | 0 | `exit_code == 0` |
| `smoke` exit code | 0 | `exit_code == 0` |
| All `gate_checks[].passed` in artifact | true | `all(c.passed for c in gate_checks)` |

**Gate command:** Run all three commands sequentially; any non-zero exit fails the gate.

---

## 3. Pine Source Hash Pinned and Matching

| Check | Threshold | Assert |
|-------|-----------|--------|
| Pine SHA256 in run artifact | matches `baseline_v1_approved.json`.`pine_source_sha256` | `artifact.pine_source_sha256 == approved.pine_source_sha256` |
| Pine file exists at `inputs/baseline_strategy.pine` | file present | `os.path.exists(path)` |
| SHA256 of file on disk | matches approved hash | `sha256(read(path)) == approved.pine_source_sha256` |

If the candidate modifies Pine (e.g., adds a toggle), the **new** hash must be recorded and the old hash archived. The toggle-OFF replay must still reproduce baseline metrics (SS1).

---

## 4. Required Artifacts Present and Valid

All artifacts listed in PIPELINE_CONTRACT.md SS4 must exist and parse cleanly.

### Input artifacts

| File | Check | Assert |
|------|-------|--------|
| `inputs/baseline_strategy.pine` | exists, non-empty | `size > 0` |
| `inputs/primary_5m.csv` | exists, non-empty | `size > 0` |
| `inputs/reference_60m.csv` | exists, non-empty | `size > 0` |
| `inputs/reference_1d.csv` | exists, non-empty | `size > 0` |
| `inputs/baseline_settings.json` | valid JSON | `json.loads(read(path))` succeeds |
| `inputs/baseline_metadata.json` | valid JSON | `json.loads(read(path))` succeeds |

### Output artifacts

| File | Check | Assert |
|------|-------|--------|
| `outputs/canonical_pipeline/canonical_run.json` | valid JSON, schema-complete | All keys from SS4 schema present with correct types |
| `outputs/analysis/baseline_v1_approved.json` | exists, unmodified | `sha256(file) == known_approved_hash` |

### Schema keys required in `canonical_run.json`

```
version: str, timestamp: str, data_source: str, covered_window_start: str,
pine_source_sha256: str, canonical_metrics: dict, actual_metrics: dict,
gate_checks: list, gate_passed: bool, trade_summary: dict
```

Assert: every key present and type-correct.

---

## 5. Pre-flight Gate Passing

| Check | Threshold | Assert |
|-------|-----------|--------|
| `mnq-tv-debugger preflight` exit code | 0 | `exit_code == 0` |
| Approved baseline JSON parses | valid JSON with required keys | Parse succeeds, all keys present |
| Input datasets exist on disk | all paths from SS4 present | `all(os.path.exists(p) for p in required_inputs)` |
| Pine SHA matches approved | see SS3 | Hash equality |

Pre-flight must pass **before** any replay starts. A pre-flight failure is a hard block.

---

## 6. Candidate-Specific Metrics (Toggle ON)

When the candidate toggle is ON, the following must hold relative to baseline:

| Metric | Constraint | Assert |
|--------|-----------|--------|
| No removed winners | winner count >= baseline winner count | `candidate.winners >= baseline.winners` |
| No added losers | loser count <= baseline loser count | `candidate.losers <= baseline.losers` |
| Max DD non-increase (covered window) | <= baseline covered-window DD | `candidate.max_dd <= baseline_covered_dd` |
| Max DD non-increase (full window) | <= $1,665.00 | `candidate.max_dd <= 1665.00` |
| Net PnL non-decrease | >= baseline net PnL | `candidate.net_pnl >= baseline.net_pnl` |
| Profit factor non-decrease | >= baseline PF | `candidate.pf >= baseline.pf` |
| No lookahead violation | candidate logic fires only after required session close | Manual or automated bar-state audit |
| Concentration flag | if >50% of PnL uplift comes from 1 trade, flag for review | `max_single_trade_uplift / total_uplift <= 0.50` or flagged |

---

## 7. TradingView Parity

| Check | Threshold | Assert |
|-------|-----------|--------|
| TV trade count matches local replay | exact | `tv_trades == local_trades` |
| Changed trades reproduced in TV | all candidate-added trades appear | `all(t in tv_trades for t in added_trades)` |
| No unexpected TV-only trades | 0 | `len(tv_only_trades) == 0` |

This is a manual step unless automated TV export diffing is available.

---

## 8. Human Sign-off Checklist

These items require human judgment and cannot be fully automated.

| # | Item | Signed by | Date |
|---|------|-----------|------|
| 1 | Reviewed all changed trades — each has a clear causal explanation | | |
| 2 | Concentration risk acknowledged if single-trade uplift > 50% | | |
| 3 | No filter, entry, exit, or risk logic modified outside candidate scope | | |
| 4 | Forward/out-of-sample validation completed or waived with justification | | |
| 5 | Approved baseline JSON updated with new hash (if Pine changed) | | |
| 6 | `baseline_v1_approved.json` archived before overwrite | | |
| 7 | PIPELINE_CONTRACT.md SS5 tolerances updated if new baseline metrics differ | | |
| 8 | R2 scope spec or equivalent reviewed and constraints honored | | |

---

## Gate Verdict

```
PASS: All sections 1-8 green.        -> Promote candidate to approved baseline.
FAIL: Any section red.               -> Block promotion. Document failing checks.
FLAG: Section 6 concentration flag.  -> Promotion requires explicit human override.
```

---

## Usage

1. Copy this template for each candidate (e.g., `data/r2_promotion_gate.md`).
2. Fill in candidate-specific values (toggle name, expected changed trades, etc.).
3. Run automated checks (SS1-5) via pipeline commands.
4. Evaluate candidate metrics (SS6) and TV parity (SS7) manually or via scripts.
5. Complete human sign-off (SS8).
6. Record final verdict and archive the completed checklist alongside the promoted artifact.
