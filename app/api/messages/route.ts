import { NextResponse } from "next/server";
import { readJSON, appendJSON, writeJSON, generateId } from "@/lib/store";
import type { AgentMessage } from "@/lib/mission-control-data";

const FILE = "messages.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const forAgent = searchParams.get("for");
  const messages = await readJSON<AgentMessage[]>(FILE);

  if (forAgent) {
    return NextResponse.json(
      messages.filter((m) => m.to === forAgent && !m.read)
    );
  }
  return NextResponse.json(messages);
}

export async function POST(request: Request) {
  const body = await request.json();
  const message: AgentMessage = {
    id: generateId(),
    from: body.from || "human",
    to: body.to,
    content: body.content,
    timestamp: new Date().toISOString(),
    read: false,
  };
  await appendJSON(FILE, message);
  return NextResponse.json(message, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const messages = await readJSON<AgentMessage[]>(FILE);
  const idx = messages.findIndex((m) => m.id === body.id);
  if (idx === -1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  messages[idx] = { ...messages[idx], ...body };
  await writeJSON(FILE, messages);
  return NextResponse.json(messages[idx]);
}
