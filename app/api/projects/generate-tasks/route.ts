import { NextResponse } from "next/server";
import { readJSON, appendJSON, generateId } from "@/lib/store";
import type { ProjectConfig, SharedTask, TaskAttachment } from "@/lib/mission-control-data";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

const PROJECT_ROOT = process.cwd();

function spawnClaude(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const args = [
      "@anthropic-ai/claude-code",
      "-p", "-",
      "--output-format", "text",
      "--dangerously-skip-permissions",
    ];
    const proc = spawn("npx", args, {
      cwd: PROJECT_ROOT,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
    proc.stdin.write(prompt);
    proc.stdin.end();

    const timer = setTimeout(() => { proc.kill("SIGTERM"); }, 300_000);
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve(stdout.trim() || stderr.trim() || "No output");
    });
    proc.on("error", (err) => {
      clearTimeout(timer);
      resolve(`Error: ${err.message}`);
    });
  });
}

async function readAttachmentContent(attachment: TaskAttachment): Promise<string> {
  try {
    const filePath = attachment.type === "file"
      ? path.join(PROJECT_ROOT, attachment.path)
      : attachment.path;
    const content = await fs.readFile(filePath, "utf-8");
    return `--- ${attachment.name} ---\n${content.slice(0, 5000)}${content.length > 5000 ? "\n... (truncated)" : ""}`;
  } catch {
    return `--- ${attachment.name} --- (could not read: ${attachment.path})`;
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const projectId = body.projectId;
  if (!projectId) {
    return NextResponse.json({ error: "projectId required" }, { status: 400 });
  }

  // Fetch the project
  const projects = await readJSON<ProjectConfig[]>("projects.json");
  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return NextResponse.json({ error: "project not found" }, { status: 404 });
  }

  // Check if tasks already exist for this project — prevent duplicates
  const existingTasks = await readJSON<SharedTask[]>("tasks.json");
  const projectTasks = existingTasks.filter((t) => t.project === projectId);
  if (projectTasks.length > 0) {
    return NextResponse.json(
      { error: `Project already has ${projectTasks.length} task(s). Delete existing tasks first or use a different project.`, tasks: projectTasks },
      { status: 409 }
    );
  }

  // Read attachment contents for context
  let fileContext = "";
  if (project.attachments && project.attachments.length > 0) {
    const contents = await Promise.all(project.attachments.map(readAttachmentContent));
    fileContext = contents.join("\n\n");
  }

  // Build the planning prompt
  const prompt = `You are a project planning assistant. Based on the following project description and attached files, create a detailed task backlog.

=== PROJECT ===
Name: ${project.name}
Description: ${project.description}

${fileContext ? `=== PROJECT FILES ===\n${fileContext}\n` : ""}
Create a JSON array of tasks for this project. Each task should have:
- "title": concise task title (string)
- "description": detailed description of what needs to be done (string)
- "priority": "P0" (critical) | "P1" (important) | "P2" (nice to have)
- "dependsOn": array of task TITLES (not IDs) that this task depends on. Use exact titles from other tasks in your list. Empty array [] if no dependencies.

Order tasks logically — foundational tasks first, dependent tasks later.
Aim for 4-8 tasks that cover the full scope of the project.

Output ONLY a valid JSON array, nothing else. No markdown code blocks, no explanation.`;

  console.log(`[Generate Tasks] Spawning Claude to plan tasks for "${project.name}"...`);
  const result = await spawnClaude(prompt);

  // Parse the JSON response
  let rawTasks: { title: string; description: string; priority: string; dependsOn: string[] }[];
  try {
    // Try to extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = result.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error("No JSON array found");
    rawTasks = JSON.parse(jsonMatch[0]);
  } catch (err) {
    console.error("[Generate Tasks] Failed to parse:", result.slice(0, 500));
    return NextResponse.json({ error: "Failed to parse task list from AI", raw: result.slice(0, 1000) }, { status: 500 });
  }

  // Create tasks and resolve title-based dependencies to IDs
  const titleToId = new Map<string, string>();
  const createdTasks: SharedTask[] = [];

  for (const raw of rawTasks) {
    const id = generateId();
    titleToId.set(raw.title, id);

    // Resolve dependsOn titles to IDs
    const dependsOn = (raw.dependsOn || [])
      .map((title: string) => titleToId.get(title))
      .filter((id): id is string => !!id);

    const task: SharedTask = {
      id,
      title: raw.title,
      description: raw.description,
      assignee: "unassigned",
      project: projectId,
      status: "todo",
      priority: (["P0", "P1", "P2"].includes(raw.priority) ? raw.priority : "P1") as "P0" | "P1" | "P2",
      dependsOn: dependsOn.length > 0 ? dependsOn : undefined,
      createdBy: "orchestrator",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await appendJSON("tasks.json", task);
    createdTasks.push(task);
  }

  console.log(`[Generate Tasks] Created ${createdTasks.length} tasks for "${project.name}"`);
  return NextResponse.json({ tasks: createdTasks }, { status: 201 });
}
