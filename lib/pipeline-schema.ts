/**
 * Approved Baseline JSON Schema — inline constants for pre-flight validation.
 *
 * Source of truth: PIPELINE_CONTRACT.md §4 (Artifact Schema) and §5 (Regression Gate Tolerances).
 * Fixture reference: data/fixtures/canonical_pipeline_artifact.json
 *
 * The pre-flight gate validates incoming artifacts against these definitions.
 */

// ── Metric types ──────────────────────────────────────────────────────────────

export type MetricMatchType = "exact" | "float";

export type MetricTolerance = {
  readonly target: number;
  readonly tolerance: number;
  readonly matchType: MetricMatchType;
};

// ── Canonical baseline metrics & tolerances (§5) ─────────────────────────────

export const CANONICAL_BASELINE_METRICS = {
  trades: 86,
  net_pnl: 13812.5,
  profit_factor: 2.45,
  max_drawdown: 1665.0,
} as const;

export const METRIC_TOLERANCES: Record<
  keyof typeof CANONICAL_BASELINE_METRICS,
  MetricTolerance
> = {
  trades: { target: 86, tolerance: 0, matchType: "exact" },
  net_pnl: { target: 13812.5, tolerance: 0.01, matchType: "float" },
  profit_factor: { target: 2.45, tolerance: 0.01, matchType: "float" },
  max_drawdown: { target: 1665.0, tolerance: 0.01, matchType: "float" },
} as const;

// ── Artifact schema types (§4) ───────────────────────────────────────────────

export type BaselineMetrics = {
  trades: number;
  net_pnl: number;
  profit_factor: number;
  max_drawdown: number;
};

export type GateCheck = {
  metric: string;
  target: number;
  actual: number;
  tolerance: number;
  passed: boolean;
};

export type TradeSummary = {
  trade_count: number;
  net_pl: number;
  profit_factor: number;
  max_drawdown: number;
  long_pl: number;
  short_pl: number;
  winner_count: number;
  loser_count: number;
  be_count: number;
};

export type ApprovedBaselineArtifact = {
  version: string;
  timestamp: string;
  data_source: string;
  covered_window_start: string;
  pine_source_sha256: string;
  canonical_metrics: BaselineMetrics;
  actual_metrics: BaselineMetrics;
  gate_checks: GateCheck[];
  gate_passed: boolean;
  trade_summary: TradeSummary;
};

// ── Required top-level keys and their expected JS types ──────────────────────
// Used by the pre-flight validator to confirm structural completeness.

export const REQUIRED_ARTIFACT_KEYS: Record<
  keyof ApprovedBaselineArtifact,
  string
> = {
  version: "string",
  timestamp: "string",
  data_source: "string",
  covered_window_start: "string",
  pine_source_sha256: "string",
  canonical_metrics: "object",
  actual_metrics: "object",
  gate_checks: "array",
  gate_passed: "boolean",
  trade_summary: "object",
} as const;

export const REQUIRED_METRICS_KEYS: (keyof BaselineMetrics)[] = [
  "trades",
  "net_pnl",
  "profit_factor",
  "max_drawdown",
];

export const REQUIRED_TRADE_SUMMARY_KEYS: (keyof TradeSummary)[] = [
  "trade_count",
  "net_pl",
  "profit_factor",
  "max_drawdown",
  "long_pl",
  "short_pl",
  "winner_count",
  "loser_count",
  "be_count",
];

// ── Schema version & expected artifact version ───────────────────────────────

export const SCHEMA_VERSION = "1.0.0";
export const EXPECTED_ARTIFACT_VERSION = "v1";
