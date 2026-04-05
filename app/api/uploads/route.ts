import { NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { generateId } from "@/lib/store";

const UPLOAD_DIR = path.join(process.cwd(), "data", "uploads");

export async function POST(request: Request) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  await fs.mkdir(UPLOAD_DIR, { recursive: true });

  const id = generateId();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${id}-${safeName}`;
  const filepath = path.join(UPLOAD_DIR, filename);

  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(filepath, buffer);

  return NextResponse.json({
    id,
    name: file.name,
    type: "file" as const,
    path: `data/uploads/${filename}`,
    mimeType: file.type || undefined,
    size: file.size,
    addedBy: "human",
    addedAt: new Date().toISOString(),
  }, { status: 201 });
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "path required" }, { status: 400 });
  }

  const fullPath = path.join(process.cwd(), filePath);
  // Security: ensure the path is within the uploads directory
  if (!fullPath.startsWith(UPLOAD_DIR)) {
    return NextResponse.json({ error: "invalid path" }, { status: 403 });
  }

  try {
    const data = await fs.readFile(fullPath);
    return new NextResponse(data, {
      headers: { "Content-Type": "application/octet-stream" },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
