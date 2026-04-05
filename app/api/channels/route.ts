import { NextResponse } from "next/server";
import { readJSON, appendJSON, deleteJSON, generateId, seedChannelsIfEmpty } from "@/lib/store";
import type { Channel } from "@/lib/mission-control-data";

const FILE = "channels.json";

export async function GET() {
  await seedChannelsIfEmpty();
  const channels = await readJSON<Channel[]>(FILE);
  return NextResponse.json(channels);
}

export async function POST(request: Request) {
  const body = await request.json();
  const channel: Channel = {
    id: body.id || generateId(),
    name: body.name || "untitled",
    description: body.description || "",
    createdBy: body.createdBy || "human",
    createdAt: new Date().toISOString(),
  };
  await appendJSON(FILE, channel);
  return NextResponse.json(channel, { status: 201 });
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await deleteJSON<Channel>(FILE, id);
  return NextResponse.json({ ok: true });
}
