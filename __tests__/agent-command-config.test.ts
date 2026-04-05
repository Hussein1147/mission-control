import { describe, expect, it } from "vitest";

import { buildCodexExecArgs, codexCommandConfig } from "@/lib/agent-command-config";

describe("buildCodexExecArgs", () => {
  it("uses stable defaults for unattended runs", () => {
    expect(buildCodexExecArgs({})).toEqual([
      "-a", "never",
      "-s", "workspace-write",
      "-c", "tool_timeout_sec=600",
      "exec",
      "-",
    ]);
  });

  it("respects explicit environment overrides", () => {
    expect(buildCodexExecArgs({
      CODEX_APPROVAL_POLICY: "on-failure",
      CODEX_SANDBOX: "danger-full-access",
      CODEX_TOOL_TIMEOUT_SEC: "900",
    })).toEqual([
      "-a", "on-failure",
      "-s", "danger-full-access",
      "-c", "tool_timeout_sec=900",
      "exec",
      "-",
    ]);
  });

  it("clamps low timeout overrides to the minimum replay-safe floor", () => {
    expect(buildCodexExecArgs({ CODEX_TOOL_TIMEOUT_SEC: "120" })).toEqual([
      "-a", codexCommandConfig.defaults.approvalPolicy,
      "-s", codexCommandConfig.defaults.sandboxMode,
      "-c", `tool_timeout_sec=${codexCommandConfig.minimumToolTimeoutSec}`,
      "exec",
      "-",
    ]);
  });

  it("falls back cleanly when the timeout override is invalid", () => {
    expect(buildCodexExecArgs({ CODEX_TOOL_TIMEOUT_SEC: "not-a-number" })).toEqual([
      "-a", codexCommandConfig.defaults.approvalPolicy,
      "-s", codexCommandConfig.defaults.sandboxMode,
      "-c", `tool_timeout_sec=${codexCommandConfig.defaults.toolTimeoutSec}`,
      "exec",
      "-",
    ]);
  });
});
