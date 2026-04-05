import { NextResponse } from "next/server";

const SMART_MEMORY_BASE = "http://127.0.0.1:8000";

async function proxyGet(endpoint: string) {
  try {
    const res = await fetch(`${SMART_MEMORY_BASE}${endpoint}`);
    if (!res.ok) return null;
    return res.json();
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action") || "health";

  if (action === "health") {
    const data = await proxyGet("/health");
    return NextResponse.json(data || { status: "unavailable" });
  }

  if (action === "memories") {
    const data = await proxyGet("/memories");
    return NextResponse.json(data || []);
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function POST(request: Request) {
  const body = await request.json();
  const action = body.action as string;

  try {
    if (action === "retrieve") {
      const res = await fetch(`${SMART_MEMORY_BASE}/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: body.query || "",
          conversation_history: "",
          include_history: false,
        }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    if (action === "ingest") {
      const res = await fetch(`${SMART_MEMORY_BASE}/ingest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: body.user_message,
          assistant_message: body.assistant_message,
          source_session_id: body.session_id || "dashboard",
          timestamp: new Date().toISOString(),
        }),
      });
      const data = await res.json();
      return NextResponse.json(data);
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Smart Memory unavailable" }, { status: 503 });
  }
}
