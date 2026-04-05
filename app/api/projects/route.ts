import { NextResponse } from "next/server";
import { readJSON, writeJSON, appendJSON, updateJSON, generateId, deleteJSON } from "@/lib/store";
import type { ProjectConfig, SharedTask } from "@/lib/mission-control-data";

const FILE = "projects.json";
const TASKS_FILE = "tasks.json";
const DOCS_FILE = "docs.json";

export async function GET() {
  const projects = await readJSON<ProjectConfig[]>(FILE);
  return NextResponse.json(projects);
}

export async function POST(request: Request) {
  const body = await request.json();
  const project: ProjectConfig = {
    id: body.id || generateId(),
    name: body.name || "Untitled Project",
    description: body.description || "",
    color: body.color || "#8b5cf6",
    status: body.status || "draft",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await appendJSON(FILE, project);
  return NextResponse.json(project, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch = { ...body, updatedAt: new Date().toISOString() };
  delete patch.id;
  const updated = await updateJSON<ProjectConfig>(FILE, body.id, patch);
  if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Cascade: delete all tasks belonging to this project
  const tasks = await readJSON<SharedTask[]>(TASKS_FILE);
  const projectTasks = tasks.filter((t) => t.project === id);
  for (const task of projectTasks) {
    await deleteJSON(TASKS_FILE, task.id);
  }

  // Cascade: delete docs authored for this project
  const docs = await readJSON<{ id: string; project?: string }[]>(DOCS_FILE);
  const projectDocs = docs.filter((d) => d.project === id);
  for (const doc of projectDocs) {
    await deleteJSON(DOCS_FILE, doc.id);
  }

  // Delete the project itself
  const projects = await readJSON<ProjectConfig[]>(FILE);
  await writeJSON(FILE, projects.filter((p) => p.id !== id));

  return NextResponse.json({ ok: true, cascaded: { tasks: projectTasks.length, docs: projectDocs.length } });
}
