import { NextResponse } from "next/server";
import {
  readJSON,
  writeJSON,
  appendJSON,
  generateId,
  writeAgentFile,
  readAgentFile,
  seedAgentsIfEmpty,
} from "@/lib/store";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { AgentConfig } from "@/lib/mission-control-data";

const FILE = "agents.json";

export async function GET() {
  await seedAgentsIfEmpty();
  const agents = await readJSON<AgentConfig[]>(FILE);
  return NextResponse.json(agents);
}

export async function POST(request: Request) {
  const body = await request.json();

  const id =
    body.id ||
    body.name
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") ||
    generateId();

  const agentFile = `agents/${id}.md`;

  // Build the .md content from role instructions + custom instructions
  let roleContent = "";
  if (body.roleFile) {
    try {
      const rolePath = path.join(process.cwd(), body.roleFile);
      roleContent = await fs.readFile(rolePath, "utf-8");
    } catch {
      // Role file doesn't exist yet, skip
    }
  }

  const customInstructions = body.instructions || "";
  const content = [roleContent, customInstructions].filter(Boolean).join("\n\n");

  await writeAgentFile(
    agentFile,
    {
      name: body.name || id,
      provider: body.provider || "claude",
      model: body.model || "",
      role: body.role || "engineer",
      status: "active",
    },
    content || `## Instructions\nCustomize this agent's behavior here.`
  );

  const agent: AgentConfig = {
    id,
    name: body.name || id,
    provider: body.provider || "claude",
    model: body.model || undefined,
    role: body.role || "engineer",
    file: agentFile,
    status: "idle",
    pid: null,
    lastActive: null,
  };

  await appendJSON(FILE, agent);
  return NextResponse.json(agent, { status: 201 });
}

export async function PATCH(request: Request) {
  const body = await request.json();
  if (!body.id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const agents = await readJSON<AgentConfig[]>(FILE);
  const idx = agents.findIndex((a) => a.id === body.id);
  if (idx === -1) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Update the agent config
  const patch: Partial<AgentConfig> = {};
  if (body.provider) patch.provider = body.provider;
  if (body.model !== undefined) patch.model = body.model;
  if (body.role) patch.role = body.role;
  if (body.status) patch.status = body.status;
  if (body.name) patch.name = body.name;
  if (body.lastActive) patch.lastActive = body.lastActive;
  if (body.pid !== undefined) patch.pid = body.pid;
  if (body.autoScaled !== undefined) patch.autoScaled = body.autoScaled;
  if ("currentTaskId" in body) patch.currentTaskId = body.currentTaskId;
  if ("currentTaskTitle" in body) patch.currentTaskTitle = body.currentTaskTitle;
  if ("taskStartedAt" in body) patch.taskStartedAt = body.taskStartedAt;
  if ("currentChannelId" in body) patch.currentChannelId = body.currentChannelId;
  if ("reasoningEffort" in body) patch.reasoningEffort = body.reasoningEffort;
  if ("sandbox" in body) patch.sandbox = body.sandbox;
  if ("allowedDirectories" in body) patch.allowedDirectories = body.allowedDirectories;

  agents[idx] = { ...agents[idx], ...patch };
  await writeJSON(FILE, agents);

  // If provider changed, update the .md frontmatter too
  if (body.provider || body.role || body.model !== undefined) {
    try {
      const { frontmatter, content } = await readAgentFile(agents[idx].file);
      if (body.provider) frontmatter.provider = body.provider;
      if (body.role) frontmatter.role = body.role;
      if (body.model !== undefined) frontmatter.model = body.model;
      await writeAgentFile(agents[idx].file, frontmatter, content);
    } catch {
      // Agent file might not exist yet
    }
  }

  return NextResponse.json(agents[idx]);
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const agents = await readJSON<AgentConfig[]>(FILE);
  const agent = agents.find((a) => a.id === id);
  const filtered = agents.filter((a) => a.id !== id);
  await writeJSON(FILE, filtered);

  // Optionally remove the .md file
  if (agent?.file) {
    try {
      await fs.unlink(path.join(process.cwd(), agent.file));
    } catch {
      // File might not exist
    }
  }

  return NextResponse.json({ ok: true });
}
