import { NextResponse } from "next/server";
import { readJSON, writeJSON } from "@/lib/store";
import type { AgentPoolConfig } from "@/lib/mission-control-data";

const FILE = "pool-config.json";

const DEFAULT_CONFIG: AgentPoolConfig = {
  enabled: true,
  maxAgents: 4,
  providers: {
    claude: { maxInstances: 3, defaultModel: "claude-opus-4-6", defaultRole: "engineer" },
    codex: { maxInstances: 2, defaultRole: "engineer" },
  },
  scaleUpThreshold: 2,
  scaleDownAfterIdleMinutes: 10,
};

async function getConfig(): Promise<AgentPoolConfig> {
  try {
    const config = await readJSON<AgentPoolConfig>(FILE);
    return config || DEFAULT_CONFIG;
  } catch {
    return DEFAULT_CONFIG;
  }
}

export async function GET() {
  const config = await getConfig();
  return NextResponse.json(config);
}

export async function PATCH(req: Request) {
  const updates = await req.json();
  const current = await getConfig();
  const merged = { ...current, ...updates };

  // Deep merge providers if provided
  if (updates.providers) {
    merged.providers = { ...current.providers };
    for (const [key, val] of Object.entries(updates.providers)) {
      merged.providers[key] = { ...(current.providers[key] || {}), ...(val as Record<string, unknown>) };
    }
  }

  await writeJSON(FILE, merged);
  return NextResponse.json(merged);
}
