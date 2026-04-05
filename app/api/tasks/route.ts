import { NextResponse } from "next/server";
import { readJSON, appendJSON, updateJSON, deleteJSON, generateId } from "@/lib/store";
import type { SharedTask, ProjectConfig } from "@/lib/mission-control-data";

const FILE = "tasks.json";
const PROJECTS_FILE = "projects.json";

export async function GET() {
  const tasks = await readJSON<SharedTask[]>(FILE);
  return NextResponse.json(tasks);
}

export async function POST(request: Request) {
  const body = await request.json();
  // Assign order at end of target column
  const allTasks = await readJSON<SharedTask[]>(FILE);
  const targetStatus = body.status || "todo";
  const maxOrder = allTasks
    .filter((t) => t.status === targetStatus)
    .reduce((max, t) => Math.max(max, t.order ?? 0), -1);

  const task: SharedTask = {
    id: generateId(),
    title: body.title || "Untitled Task",
    description: body.description || "",
    assignee: body.assignee || "unassigned",
    project: body.project || undefined,
    status: targetStatus,
    priority: body.priority || "P1",
    dueDate: body.dueDate || undefined,
    order: maxOrder + 1,
    createdBy: body.createdBy || "human",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    result: undefined,
  };
  await appendJSON(FILE, task);
  return NextResponse.json(task, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const patch = { ...body, updatedAt: new Date().toISOString() };
  delete patch.id;
  const updated = await updateJSON<SharedTask>(FILE, body.id, patch);
  if (!updated) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(updated);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  const bulk = searchParams.get("bulk"); // "project:<projectId>" to delete all tasks for a project

  // Bulk delete: delete all tasks for a project
  if (bulk?.startsWith("project:")) {
    const projectId = bulk.slice("project:".length);
    const allTasks = await readJSON<SharedTask[]>(FILE);
    const toDelete = allTasks.filter((t) => t.project === projectId);
    for (const task of toDelete) {
      await deleteJSON<SharedTask>(FILE, task.id);
    }
    // Reset project phase since all tasks are gone
    const projects = await readJSON<ProjectConfig[]>(PROJECTS_FILE);
    const project = projects.find((p) => p.id === projectId);
    if (project && project.status === "active") {
      await updateJSON<ProjectConfig>(PROJECTS_FILE, projectId, {
        phase: undefined,
        phaseMetadata: undefined,
      } as Partial<ProjectConfig>);
    }
    return NextResponse.json({ ok: true, deleted: toDelete.length });
  }

  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  // Read the task before deleting to check its project
  const allTasks = await readJSON<SharedTask[]>(FILE);
  const task = allTasks.find((t) => t.id === id);

  const deleted = await deleteJSON<SharedTask>(FILE, id);
  if (!deleted) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // If this was the last task for its project, reset project phase
  if (task?.project) {
    const remaining = allTasks.filter((t) => t.project === task.project && t.id !== id);
    if (remaining.length === 0) {
      const projects = await readJSON<ProjectConfig[]>(PROJECTS_FILE);
      const project = projects.find((p) => p.id === task.project);
      if (project) {
        await updateJSON<ProjectConfig>(PROJECTS_FILE, task.project, {
          phase: undefined,
          phaseMetadata: undefined,
          status: "draft",
        } as Partial<ProjectConfig>);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
