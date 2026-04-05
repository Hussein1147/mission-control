import { NextResponse } from "next/server";
import { appendJSON, generateId } from "@/lib/store";
import { builtinTemplates } from "@/lib/mission-control-data";

// GET: Return all built-in templates
export async function GET() {
  return NextResponse.json(builtinTemplates);
}

// POST: Create tasks from a template
// Body: { templateId: string, projectId?: string }
export async function POST(request: Request) {
  const body = await request.json();
  const { templateId, projectId } = body;

  const template = builtinTemplates.find((t) => t.id === templateId);
  if (!template) {
    return NextResponse.json({ error: "Template not found" }, { status: 404 });
  }

  const now = new Date().toISOString();
  const createdTasks: { id: string; title: string }[] = [];
  const titleToId: Record<string, string> = {};

  // Create tasks sequentially to resolve dependencies
  for (const taskDef of template.tasks) {
    const taskId = generateId();
    titleToId[taskDef.title] = taskId;

    // Resolve title-based dependencies to IDs
    const dependsOn = taskDef.dependsOn
      ?.map((depTitle) => titleToId[depTitle])
      .filter(Boolean) || [];

    const task = {
      id: taskId,
      title: taskDef.title,
      description: taskDef.description,
      assignee: "unassigned",
      project: projectId || undefined,
      status: "todo",
      priority: taskDef.priority,
      dependsOn,
      createdBy: "human",
      createdAt: now,
      updatedAt: now,
    };

    await appendJSON("tasks.json", task);
    createdTasks.push({ id: taskId, title: taskDef.title });
  }

  return NextResponse.json({
    template: template.name,
    tasksCreated: createdTasks.length,
    tasks: createdTasks,
  }, { status: 201 });
}
