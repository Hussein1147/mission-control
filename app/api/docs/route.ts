import { NextResponse } from "next/server";
import { readJSON, writeJSON, appendJSON, updateJSON, generateId } from "@/lib/store";
import type { DocEntry } from "@/lib/mission-control-data";

const FILE = "docs.json";

export async function GET() {
  const docs = await readJSON<DocEntry[]>(FILE);
  // Most recent first
  return NextResponse.json(docs.sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export async function POST(request: Request) {
  const body = await request.json();
  const doc: DocEntry = {
    id: generateId(),
    title: body.title || "Untitled",
    content: body.content || "",
    project: body.project || undefined,
    author: body.author || "human",
    taskId: body.taskId || undefined,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await appendJSON(FILE, doc);
  return NextResponse.json(doc, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch = { ...body, updatedAt: new Date().toISOString() };
  delete patch.id;
  const updated = await updateJSON<DocEntry>(FILE, body.id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const docs = await readJSON<DocEntry[]>(FILE);
  await writeJSON(FILE, docs.filter((d) => d.id !== id));
  return NextResponse.json({ ok: true });
}
