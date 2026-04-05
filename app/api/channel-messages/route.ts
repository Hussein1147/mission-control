import { NextResponse } from "next/server";
import { readJSON, appendJSON, deleteJSON, writeJSON, generateId } from "@/lib/store";
import type { ChannelMessage } from "@/lib/mission-control-data";

const FILE = "channel-messages.json";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const channelId = searchParams.get("channel");
  const messages = await readJSON<ChannelMessage[]>(FILE);
  if (channelId) {
    return NextResponse.json(messages.filter((m) => m.channelId === channelId));
  }
  return NextResponse.json(messages);
}

export async function POST(request: Request) {
  const body = await request.json();
  if (!body.channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }
  const message: ChannelMessage = {
    id: generateId(),
    channelId: body.channelId,
    from: body.from || "human",
    content: body.content || "",
    taskId: body.taskId || undefined,
    deliberationId: body.deliberationId || undefined,
    timestamp: new Date().toISOString(),
  };
  await appendJSON(FILE, message);
  return NextResponse.json(message, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const channel = searchParams.get("channel");

  // Delete all messages in a channel
  if (channel) {
    const messages = await readJSON<ChannelMessage[]>(FILE);
    const remaining = messages.filter((m) => m.channelId !== channel);
    await writeJSON(FILE, remaining);
    return NextResponse.json({ ok: true, deleted: messages.length - remaining.length });
  }

  // Delete a single message
  if (!id) {
    return NextResponse.json({ error: "id or channel required" }, { status: 400 });
  }
  const deleted = await deleteJSON<ChannelMessage>(FILE, id);
  if (!deleted) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
