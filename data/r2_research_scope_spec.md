# R2 Research Candidate — Scope Specification

**Date:** 2026-03-28
**Status:** Spec only — do not implement
**Baseline reference:** `baseline_v1_approved.json` (86 trades, $13,812.5 net, PF 2.45, DD $1,665)

---

## 1. What R2 Is

R2 allows Asia sweep/displacement bias to **seed a weak daily bias** when the daily bias is neutral and the day is not an inside bar.

**Current baseline behavior (line 353 of `baseline_strategy.pine`):**
Asia bias is a **confidence modifier only** — it can raise or lower `daily_bias_str` but never sets `daily_bias` itself. The gate is:

```pine
if useAsiaRangeBias and asia_bias != 0 and daily_bias != 0 and not daily_is_ib
    daily_bias_str := asia_bias == daily_bias ? math.max(daily_bias_str, 2) : 1
```

**R2 proposed behavior:**
When `asia_bias != 0` AND `daily_bias == 0` AND `daily_is_ib == false`, set:
- `daily_bias := asia_bias`
- `daily_bias_str := 1` (weak, not confirmed-strong)

This runs on each closed 5m bar after the Asia range is built. Once seeded, the weak bias persists until the next daily reset.

## 2. What R2 Modifies

| Component | Modified? | Details |
|-----------|-----------|---------|
| `daily_bias` assignment | **Yes** | New conditional assignment when `daily_bias == 0` |
| `daily_bias_str` | **Yes** | Set to 1 (weak) on seed |
| Asia session window | No | Stays 21:00–04:00 ET |
| Asia bias computation | No | Sweep/displacement logic unchanged |
| Entry logic (CISD/ICCISD/POI) | No | Untouched |
| Session masks | No | Untouched |
| Risk sizing / BE / target | No | rTarget=3.0, beAtR=0.7 unchanged |
| Filters (B, N1, Bull A, weak hours) | No | All unchanged |
| `asiaStrongBias` guard | No | Still binds while `inAsia == true`; R2 seeds after Asia completes |
| Hourly confirmation path | No | But **indirectly affected** — see below |

### Indirect Effect (Critical)

The hourly confirmation gate (`hourly_conf`) is coupled to `daily_bias`. When `daily_bias` moves from 0 to ±1, a completed 1H signal can now produce `hourly_conf = ±1` instead of staying neutral. This is the actual mechanism by which R2 unblocks trades — it doesn't change entries directly, it opens the hourly alignment gate on previously neutral-bias days.

## 3. Sessions and Filters Touched

- **Sessions affected:** Post-Asia sessions only (London, London-NY overlap). Asia-only trades are not affected because `asiaStrongBias` requires `daily_bias_str >= 2` and R2 seeds at strength 1.
- **Side affected:** Short-side only in historical data (both changed trades were bearish).
- **Filters not touched:** B (London short chop), N1 (London neutral-hour override), Bull A block, bullish weak-hours block, `asiaStrongBias`.

## 4. Hypothesis

> On days where Asia sweep/displacement produces a directional signal but the daily candle structure has not yet resolved a bias, seeding a weak (`strength=1`) daily bias allows the hourly alignment gate to pass legitimate setups that would otherwise be blocked by the neutral-bias dead zone.

**Null hypothesis:** The two added trades in the historical review are coincidental; the mechanism does not generalize beyond the Dec 2025–Mar 2026 sample.

## 5. Prior Evidence (from `r2_promotion_review.md`)

| Metric | Baseline (covered window) | R2 | Delta |
|--------|---------------------------|-----|-------|
| Trades | 63 | 65 | +2 |
| Net PnL | $14,792.0 | $15,623.5 | +$831.5 |
| PF | 3.47 | 3.61 | +0.14 |
| Max DD | $701.5 | $701.5 | $0 |
| Winners | 29 | 30 | +1 |
| Losers | 20 | 20 | 0 |
| BE | 14 | 15 | +1 |

**Changed trades:**
1. **2026-02-12 10:00 ET** — short, london_ny_overlap, +$831.5 (winner)
2. **2026-02-26 09:25 ET** — short, london_only, $0 (BE)

Both were neutral-bias short candidates blocked by `hourly_alignment_filter` in baseline. R2 seeded bearish daily bias from Asia, enabling hourly confirmation to pass.

## 6. Success Criteria for Promotion

All of the following must hold before R2 is approved for baseline promotion:

1. **Pine toggle implemented as default-OFF** — `input.bool(false, "Asia Seeds Weak Daily Bias When Neutral")` so the baseline is unchanged unless explicitly enabled.
2. **TradingView parity check** — With toggle ON, TradingView must reproduce the same two changed trades on the covered window (2026-02-12 and 2026-02-26).
3. **No removed winners** — The 30 reference winners must all remain present.
4. **No added losers** — Trade count may increase, but no new losing trades.
5. **Max DD non-increase** — Max drawdown must not exceed $701.5 (covered window) or $1,665 (full window).
6. **No lookahead violation** — The Asia bias seed must only fire after `asia_built == true` (Asia session closed), never during.
7. **No March 20 behavior change** — Prior review confirmed R2 does not alter March 20; this must remain true.
8. **Forward validation** — If possible, run on additional out-of-sample data beyond the Dec–Mar window before final approval.

## 7. Risk Assessment

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| **Concentration risk** — $831.5 uplift from a single Feb 12 winner | High | Known | Do not overclaim robustness; require out-of-sample confirmation |
| **Weak bias persistence** — seeded bias never auto-clears intraday | Medium | Low | By design mirrors existing `daily_bias` behavior; daily reset handles it |
| **Hourly gate coupling** — indirect effect is harder to audit than a direct entry change | Medium | Medium | Require full bar-state diff in Pine validation, not just trade-level |
| **Short-side only** — no evidence R2 helps long-side | Low | Known | Acceptable; no reason to expect harm to longs (confirmed: long PnL unchanged) |
| **Transcript deviation** — Asia as bias generator is not transcript-explicit | Low | Known | R2 is a "reasoned engineering extension," not transcript transcription; document this clearly |
| **`asiaStrongBias` interaction** — could R2 weaken the Asia guard? | Low | Very low | No: `asiaStrongBias` checks `inAsia` flag; R2 seeds after Asia closes. No interaction. |

## 8. Implementation Constraints (for future implementer)

- Add exactly **one new input**: default-OFF boolean toggle for R2.
- Add the seeding logic **after line 354** in `baseline_strategy.pine` (after the existing Asia confidence modifier block).
- The new block should be guarded by the toggle and fire only when: `asia_built == true AND asia_bias != 0 AND daily_bias == 0 AND NOT daily_is_ib`.
- Do not modify any existing filter, entry, exit, or risk logic.
- Do not change the Asia session window.
- Do not change `asiaStrongBias` behavior.

## 9. What R2 Is NOT

- Not a Bull A relaxation (Bull A remains paused).
- Not a March 27 overlap-short carveout (rejected).
- Not a broad session redesign or Asia window change.
- Not an exit/target/BE modification.
- Not a `tradeOnlyBias` interaction (that input remains `false`).

---

**Verdict:** R2 is the narrowest possible way to let Asia directional information reduce neutral-bias dead zones. The mechanism is clean, the trade-set change is tiny, and the risk profile is flat. The concentration in one February winner is the main concern. Proceed to isolated implementation planning with default-OFF toggle and full parity validation before any promotion decision.
