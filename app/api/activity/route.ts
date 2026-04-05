import { NextResponse } from "next/server";
import { readJSON, appendJSON, generateId } from "@/lib/store";
import type { AgentActivity } from "@/lib/mission-control-data";

const FILE = "activity.json";
const MAX_ENTRIES = 100;

export async function GET() {
  const activity = await readJSON<AgentActivity[]>(FILE);
  // Return most recent first, capped
  return NextResponse.json(activity.slice(-MAX_ENTRIES).reverse());
}

export async function POST(request: Request) {
  const body = await request.json();
  const entry: AgentActivity = {
    id: generateId(),
    agent: body.agent || "system",
    action: body.action || "unknown",
    detail: body.detail || "",
    timestamp: new Date().toISOString(),
  };
  await appendJSON(FILE, entry);
  return NextResponse.json(entry, { status: 201 });
}
