import { NextResponse } from "next/server";
import { readJSON, appendJSON, generateId } from "@/lib/store";
import type { AgentMetrics } from "@/lib/mission-control-data";

const FILE = "metrics.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const agentId = searchParams.get("agentId");

  let metrics = await readJSON<AgentMetrics[]>(FILE);

  if (agentId) {
    metrics = metrics.filter((m) => m.agentId === agentId);
  }

  // Return most recent first
  return NextResponse.json(metrics.reverse());
}

export async function POST(request: Request) {
  const body = await request.json();
  const entry: AgentMetrics = {
    id: generateId(),
    agentId: body.agentId || "unknown",
    taskId: body.taskId || "",
    promptTokens: body.promptTokens || 0,
    completionTokens: body.completionTokens || 0,
    totalTokens: body.totalTokens || 0,
    durationMs: body.durationMs || 0,
    provider: body.provider || "unknown",
    model: body.model || "",
    timestamp: new Date().toISOString(),
  };
  await appendJSON(FILE, entry);
  return NextResponse.json(entry, { status: 201 });
}
