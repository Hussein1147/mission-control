import { NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";

const ROLES_DIR = path.join(process.cwd(), "roles");

export async function GET() {
  try {
    const files = await fs.readdir(ROLES_DIR);
    const roles = await Promise.all(
      files.filter((f) => f.endsWith(".md")).map(async (f) => {
        const content = await fs.readFile(path.join(ROLES_DIR, f), "utf-8");
        const id = f.replace(".md", "");
        return { id, filename: f, content };
      })
    );
    return NextResponse.json(roles);
  } catch {
    return NextResponse.json([]);
  }
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id || typeof body.content !== "string") {
    return NextResponse.json({ error: "id and content required" }, { status: 400 });
  }
  const filePath = path.join(ROLES_DIR, `${body.id}.md`);
  try {
    // Verify file exists (don't create arbitrary files)
    await fs.access(filePath);
    await fs.writeFile(filePath, body.content, "utf-8");
    return NextResponse.json({ id: body.id, content: body.content });
  } catch {
    return NextResponse.json({ error: "role not found" }, { status: 404 });
  }
}
