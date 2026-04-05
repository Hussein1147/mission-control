const MIN_CODEX_TOOL_TIMEOUT_SEC = 300;
const DEFAULT_CODEX_TOOL_TIMEOUT_SEC = 600;
const DEFAULT_CODEX_APPROVAL_POLICY = "never";
const DEFAULT_CODEX_SANDBOX = "danger-full-access";
const DEFAULT_CODEX_REASONING_EFFORT = "high";

export type CodexReasoningEffort = "none" | "minimal" | "low" | "medium" | "high";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";

function parseCodexToolTimeoutSec(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_CODEX_TOOL_TIMEOUT_SEC;
  }
  return Math.max(parsed, MIN_CODEX_TOOL_TIMEOUT_SEC);
}

export interface CodexSpawnOptions {
  reasoningEffort?: CodexReasoningEffort;
  sandbox?: CodexSandboxMode;
  model?: string;
  allowedDirectories?: string[];
}

export function buildCodexExecArgs(env: NodeJS.ProcessEnv = process.env, options?: CodexSpawnOptions): string[] {
  const approvalPolicy = env.CODEX_APPROVAL_POLICY?.trim() || DEFAULT_CODEX_APPROVAL_POLICY;
  const sandboxMode = options?.sandbox || env.CODEX_SANDBOX?.trim() || DEFAULT_CODEX_SANDBOX;
  const toolTimeoutSec = parseCodexToolTimeoutSec(env.CODEX_TOOL_TIMEOUT_SEC);
  const reasoningEffort = options?.reasoningEffort || env.CODEX_REASONING_EFFORT?.trim() || DEFAULT_CODEX_REASONING_EFFORT;

  const args = [
    "-a", approvalPolicy,
    "-s", sandboxMode,
    "-c", `tool_timeout_sec=${toolTimeoutSec}`,
    "-c", `model_reasoning_effort="${reasoningEffort}"`,
  ];

  if (options?.model) {
    args.push("-m", options.model);
  }

  if (options?.allowedDirectories) {
    for (const dir of options.allowedDirectories) {
      args.push("--add-dir", dir);
    }
  }

  args.push("exec", "-");
  return args;
}

export const codexCommandConfig = {
  defaults: {
    approvalPolicy: DEFAULT_CODEX_APPROVAL_POLICY,
    sandboxMode: DEFAULT_CODEX_SANDBOX,
    toolTimeoutSec: DEFAULT_CODEX_TOOL_TIMEOUT_SEC,
    reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
  },
  minimumToolTimeoutSec: MIN_CODEX_TOOL_TIMEOUT_SEC,
  validReasoningEfforts: ["none", "minimal", "low", "medium", "high"] as CodexReasoningEffort[],
  validSandboxModes: ["read-only", "workspace-write", "danger-full-access"] as CodexSandboxMode[],
};
