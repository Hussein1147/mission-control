import "server-only";

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import {
  missionStatement,
  type ActivityItem,
  type CalendarItem,
  type DataSourceMeta,
  type DocItem,
  type MemoryEntry,
  type MissionControlSnapshot,
  type MissionStat,
  type OfficeSeat,
  type Project,
  type Task,
  type TeamMember,
} from "@/lib/mission-control-data";

const execFileAsync = promisify(execFile);

const WORKSPACE_ENGINEER_ROOT = "/Users/djibrilkeita/.openclaw/workspace-engineer";
const WORKSPACE_ENGINEER_MEMORY = path.join(WORKSPACE_ENGINEER_ROOT, "memory");
const MISSION_CONTROL_ROOT = process.cwd();

type CommandResult = {
  stdout: string;
  stderr: string;
  ok: boolean;
};

type LaunchdRuntime = {
  loaded: boolean;
  disabled: boolean;
  running: boolean;
  pid?: string;
  state?: string;
  jobState?: string;
  runInterval?: string;
  lastExitCode?: string;
};

type LaunchdJobRecord = {
  label: string;
  plistPath: string;
  domain: "gui" | "system";
  type: "LaunchAgent" | "LaunchDaemon";
  schedule: string;
  nextRun: string;
  purpose: string;
  detail: string;
  status: "Healthy" | "Watching" | "Paused";
  priority: number;
};

const connected = (label: string, detail: string, filePath?: string): DataSourceMeta => ({
  state: "connected",
  label,
  detail,
  path: filePath,
});

const hybrid = (label: string, detail: string, filePath?: string): DataSourceMeta => ({
  state: "hybrid",
  label,
  detail,
  path: filePath,
});

const fallback = (label: string, detail: string): DataSourceMeta => ({
  state: "fallback",
  label,
  detail,
});

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function clampText(value: string, limit: number) {
  return value.length <= limit ? value : `${value.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function stripMarkdown(value: string) {
  return value
    .replace(/^---[\s\S]*?---/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_~]/g, "")
    .replace(/\r/g, "")
    .trim();
}

function readFirstHeading(content: string, fallbackTitle: string) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return heading || fallbackTitle;
}

function splitExcerpt(content: string, maxLines = 4) {
  return stripMarkdown(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .map((line) => clampText(line, 180));
}

function summarize(content: string) {
  const lines = stripMarkdown(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return clampText(lines.slice(0, 2).join(" "), 190) || "No readable summary found in this local file yet.";
}

function guessCategory(filePath: string, title: string) {
  const value = `${filePath} ${title}`.toLowerCase();

  if (value.includes("readme") || value.includes("bootstrap")) return "Guide";
  if (value.includes("agent") || value.includes("tool")) return "Ops";
  if (value.includes("identity") || value.includes("heartbeat") || value.includes("soul")) return "Profile";
  if (value.includes("claude")) return "Workflow";

  return "Doc";
}

function guessDocStatus(filePath: string) {
  const value = filePath.toLowerCase();

  if (value.includes("readme") || value.includes("bootstrap")) return "Live" as const;
  if (value.includes("agents") || value.includes("claude")) return "Review" as const;

  return "Draft" as const;
}

function daysBetween(a: Date, b: Date) {
  const aValue = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate());
  const bValue = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((aValue - bValue) / 86_400_000);
}

function formatDateLabel(value: Date, now: Date) {
  const delta = daysBetween(now, value);

  if (delta === 0) return "Today";
  if (delta === 1) return "Yesterday";

  return value.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function formatDateKey(value: Date) {
  return value.toISOString().slice(0, 10);
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86_400)}d`;
}

function describeCalendarInterval(input: unknown) {
  const intervals = Array.isArray(input) ? input : [input];
  const parts = intervals
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;

      const calendar = entry as Record<string, number | string>;
      const monthDay = calendar.Day ? `day ${calendar.Day}` : undefined;
      const weekDay = calendar.Weekday ? `weekday ${calendar.Weekday}` : undefined;
      const month = calendar.Month ? `month ${calendar.Month}` : undefined;
      const hour = calendar.Hour !== undefined ? `@ ${String(calendar.Hour).padStart(2, "0")}:${String(calendar.Minute ?? 0).padStart(2, "0")}` : undefined;
      return [month, monthDay, weekDay, hour].filter(Boolean).join(" ");
    })
    .filter(Boolean) as string[];

  return parts.length > 0 ? parts.join(" · ") : "Calendar schedule";
}

async function runCommand(command: string, args: string[]) {
  try {
    const result = await execFileAsync(command, args, { maxBuffer: 8 * 1024 * 1024 });
    return {
      stdout: result.stdout,
      stderr: result.stderr,
      ok: true,
    } satisfies CommandResult;
  } catch (error) {
    const commandError = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return {
      stdout: commandError.stdout ?? "",
      stderr: commandError.stderr ?? commandError.message,
      ok: false,
    } satisfies CommandResult;
  }
}

async function fileExists(targetPath: string) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function listTextFiles(targetPath: string, depth = 1) {
  const results: string[] = [];

  async function visit(currentPath: string, currentDepth: number) {
    const entries = await fs.readdir(currentPath, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);

      if (entry.isDirectory()) {
        if (currentDepth < depth) {
          await visit(entryPath, currentDepth + 1);
        }
        continue;
      }

      if (/\.(md|mdx|txt)$/i.test(entry.name)) {
        results.push(entryPath);
      }
    }
  }

  if (await fileExists(targetPath)) {
    await visit(targetPath, 0);
  }

  return results;
}

async function parseLocalTextFile(filePath: string) {
  const [content, stats] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
  const fallbackTitle = path.basename(filePath).replace(/\.(md|mdx|txt)$/i, "").replace(/[-_]/g, " ");
  const title = readFirstHeading(content, fallbackTitle);
  const summaryText = summarize(content);

  return {
    content,
    stats,
    title,
    summaryText,
    excerpt: splitExcerpt(content),
    relativePath: filePath.startsWith(MISSION_CONTROL_ROOT) ? path.relative(MISSION_CONTROL_ROOT, filePath) : filePath,
  };
}

function extractHashTags(content: string) {
  const tags = Array.from(new Set((content.match(/(^|\s)#([a-z0-9-]+)/gi) ?? []).map((tag) => tag.replace(/(^|\s)#/, "").toLowerCase())));
  return tags.slice(0, 4);
}

async function loadMemoryEntries(now: Date) {
  const notices: string[] = [];
  const connectedEntries: MemoryEntry[] = [];

  if (await fileExists(WORKSPACE_ENGINEER_MEMORY)) {
    const memoryFiles = await listTextFiles(WORKSPACE_ENGINEER_MEMORY, 2);
    const sortedFiles = await Promise.all(
      memoryFiles.map(async (filePath) => ({ filePath, stats: await fs.stat(filePath) })),
    );

    sortedFiles.sort((left, right) => right.stats.mtimeMs - left.stats.mtimeMs);

    for (const file of sortedFiles.slice(0, 8)) {
      const parsed = await parseLocalTextFile(file.filePath);
      connectedEntries.push({
        id: slugify(`memory-${parsed.relativePath}`),
        date: formatDateKey(parsed.stats.mtime),
        title: parsed.title,
        summary: parsed.summaryText,
        tags: extractHashTags(parsed.content),
        excerpt: parsed.excerpt,
        source: connected("Workspace memory", "Read from ~/.openclaw/workspace-engineer/memory", parsed.relativePath),
      });
    }
  } else {
    notices.push("Workspace memory directory is missing, so Mission Control falls back to recent workspace files plus bundled examples.");
  }

  const workspaceFiles = await listTextFiles(WORKSPACE_ENGINEER_ROOT, 1);
  const recentWorkspaceFiles: MemoryEntry[] = [];

  for (const filePath of workspaceFiles) {
    if (filePath.includes(`${path.sep}AGENTS.md`)) {
      continue;
    }

    const parsed = await parseLocalTextFile(filePath);
    const age = daysBetween(now, parsed.stats.mtime);

    if (age < 0 || age > 1) {
      continue;
    }

    recentWorkspaceFiles.push({
      id: slugify(`workspace-${parsed.relativePath}`),
      date: formatDateKey(parsed.stats.mtime),
      title: parsed.title,
      summary: parsed.summaryText,
      tags: extractHashTags(parsed.content),
      excerpt: parsed.excerpt,
      source: hybrid("Workspace snapshot", `Recent top-level workspace file from ${formatDateLabel(parsed.stats.mtime, now)}`, parsed.relativePath),
    });
  }

  const uniqueEntries = [...connectedEntries, ...recentWorkspaceFiles].reduce<MemoryEntry[]>((entries, entry) => {
    if (!entries.some((candidate) => candidate.title === entry.title && candidate.date === entry.date)) {
      entries.push(entry);
    }
    return entries;
  }, []);

  uniqueEntries.sort((left, right) => right.date.localeCompare(left.date));

  const fallbackEntries: MemoryEntry[] = [
    {
      id: "fallback-memory-1",
      date: formatDateKey(now),
      title: "Fallback memory stub",
      summary: "Bundled sample entry used because connected memory is missing or sparse.",
      tags: ["fallback", "memory"],
      excerpt: [
        "Mission Control is ready to ingest real markdown journals from the local memory directory.",
        "Until then, this sample keeps the UI populated and clearly marks itself as fallback data.",
      ],
      source: fallback("Bundled fallback", "Included only when local memory is unavailable or too thin."),
    },
    {
      id: "fallback-memory-2",
      date: formatDateKey(new Date(now.getTime() - 86_400_000)),
      title: "Fallback linking example",
      summary: "Sample operational note showing how future tasks and docs can cross-link.",
      tags: ["fallback", "links"],
      excerpt: [
        "Memory entries can link to docs, launch agents, and project tasks once deeper integrations land.",
        "This keeps the MVP realistic without pretending the data is already fully live.",
      ],
      source: fallback("Bundled fallback", "Sample memory card for sparse local datasets."),
    },
  ];

  if (uniqueEntries.length < 2) {
    notices.push("Local memory is sparse, so bundled fallback memory cards are appended below the real entries.");
  }

  return {
    entries: [...uniqueEntries, ...fallbackEntries].slice(0, 6),
    notices,
    connectedCount: uniqueEntries.length,
  };
}

async function loadDocs(now: Date) {
  const docPaths = [
    ...(await listTextFiles(WORKSPACE_ENGINEER_ROOT, 1)),
    ...(await listTextFiles(MISSION_CONTROL_ROOT, 2)),
  ];

  const uniquePaths = Array.from(new Set(docPaths));
  const docs: DocItem[] = [];

  for (const filePath of uniquePaths) {
    const parsed = await parseLocalTextFile(filePath);
    const title = parsed.title;
    docs.push({
      id: slugify(`doc-${parsed.relativePath}`),
      title,
      category: guessCategory(parsed.relativePath, title),
      updated: formatDateLabel(parsed.stats.mtime, now),
      summary: parsed.summaryText,
      status: guessDocStatus(parsed.relativePath),
      source: connected(
        filePath.startsWith(MISSION_CONTROL_ROOT) ? "Mission Control repo" : "Workspace Engineer",
        "Read from local markdown/text files only",
        parsed.relativePath,
      ),
    });
  }

  docs.sort((left, right) => {
    if (left.updated === right.updated) return left.title.localeCompare(right.title);
    if (left.updated === "Today") return -1;
    if (right.updated === "Today") return 1;
    if (left.updated === "Yesterday") return -1;
    if (right.updated === "Yesterday") return 1;
    return left.title.localeCompare(right.title);
  });

  return docs.slice(0, 12);
}

async function parsePlist(filePath: string) {
  const result = await runCommand("plutil", ["-convert", "json", "-o", "-", filePath]);
  if (!result.ok || !result.stdout.trim()) return null;

  try {
    return JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function loadLaunchdRuntime(label: string, domain: "gui" | "system") {
  const uid = process.getuid?.();
  const target = domain === "gui" && uid ? `gui/${uid}/${label}` : `${domain}/${label}`;
  const disabledTarget = domain === "gui" && uid ? `gui/${uid}` : domain;
  const [printResult, disabledResult] = await Promise.all([
    runCommand("launchctl", ["print", target]),
    runCommand("launchctl", ["print-disabled", disabledTarget]),
  ]);

  const disabled = new RegExp(`"${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*=>\\s*disabled`, "i").test(disabledResult.stdout);
  const loaded = printResult.ok;
  const state = printResult.stdout.match(/^\s*state = (.+)$/m)?.[1]?.trim();
  const jobState = printResult.stdout.match(/^\s*job state = (.+)$/m)?.[1]?.trim();

  return {
    loaded,
    disabled,
    running: state === "running" || Boolean(printResult.stdout.match(/^\s*pid = (\d+)$/m)),
    pid: printResult.stdout.match(/^\s*pid = (\d+)$/m)?.[1],
    state,
    jobState,
    runInterval: printResult.stdout.match(/^\s*run interval = (.+)$/m)?.[1]?.trim(),
    lastExitCode: printResult.stdout.match(/^\s*last exit code = (.+)$/m)?.[1]?.trim(),
  } satisfies LaunchdRuntime;
}

function isRelevantLaunchJob(plist: Record<string, unknown>) {
  const label = String(plist.Label ?? "");
  if (!label || label.startsWith("com.apple.")) {
    return false;
  }

  return Boolean(
    plist.StartInterval || plist.StartCalendarInterval || plist.KeepAlive || plist.RunAtLoad || label.includes("openclaw"),
  );
}

function buildLaunchdSchedule(plist: Record<string, unknown>, runtime: LaunchdRuntime) {
  if (typeof plist.StartInterval === "number") {
    return `Every ${formatDuration(plist.StartInterval)}`;
  }

  if (plist.StartCalendarInterval) {
    return describeCalendarInterval(plist.StartCalendarInterval);
  }

  if (plist.KeepAlive) {
    return "Persistent service";
  }

  if (plist.RunAtLoad) {
    return "Run at load";
  }

  if (runtime.runInterval) {
    return runtime.runInterval;
  }

  return "Loaded job";
}

function buildLaunchdNextRun(plist: Record<string, unknown>, runtime: LaunchdRuntime) {
  if (plist.KeepAlive) {
    return runtime.running ? "Running now" : "Continuous service";
  }

  if (plist.StartInterval || plist.StartCalendarInterval) {
    return "Next run unknown";
  }

  return runtime.loaded ? "Loaded job" : "Load state unknown";
}

function buildLaunchdPurpose(plist: Record<string, unknown>) {
  if (typeof plist.Comment === "string" && plist.Comment.trim()) {
    return clampText(plist.Comment.trim(), 120);
  }

  const args = Array.isArray(plist.ProgramArguments)
    ? (plist.ProgramArguments as unknown[]).map((value) => String(value)).join(" ")
    : typeof plist.Program === "string"
      ? plist.Program
      : "Local launchd job";

  return clampText(args, 120);
}

async function loadLaunchdJobs() {
  const directories = [
    { dir: path.join(process.env.HOME ?? "", "Library/LaunchAgents"), domain: "gui" as const, type: "LaunchAgent" as const },
    { dir: "/Library/LaunchAgents", domain: "gui" as const, type: "LaunchAgent" as const },
    { dir: "/Library/LaunchDaemons", domain: "system" as const, type: "LaunchDaemon" as const },
  ];

  const jobs: LaunchdJobRecord[] = [];

  for (const directory of directories) {
    if (!(await fileExists(directory.dir))) {
      continue;
    }

    const entries = await fs.readdir(directory.dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".plist")) {
        continue;
      }

      const plistPath = path.join(directory.dir, entry.name);
      const plist = await parsePlist(plistPath);
      if (!plist || !isRelevantLaunchJob(plist)) {
        continue;
      }

      const label = String(plist.Label ?? entry.name.replace(/\.plist$/, ""));
      const runtime = await loadLaunchdRuntime(label, directory.domain);
      const schedule = buildLaunchdSchedule(plist, runtime);
      const nextRun = buildLaunchdNextRun(plist, runtime);

      jobs.push({
        label,
        plistPath,
        domain: directory.domain,
        type: directory.type,
        schedule,
        nextRun,
        purpose: buildLaunchdPurpose(plist),
        detail: runtime.disabled
          ? `Disabled in ${directory.type.toLowerCase()}`
          : runtime.running
            ? `Running${runtime.pid ? ` · pid ${runtime.pid}` : ""}`
            : runtime.loaded
              ? `Loaded${runtime.jobState ? ` · ${runtime.jobState}` : ""}`
              : "Configured from plist",
        status: runtime.disabled ? "Paused" : runtime.running ? "Healthy" : "Watching",
        priority: label.includes("openclaw") ? 0 : typeof plist.StartInterval === "number" ? 1 : plist.StartCalendarInterval ? 2 : 3,
      });
    }
  }

  jobs.sort((left, right) => left.priority - right.priority || left.label.localeCompare(right.label));
  return jobs.slice(0, 10);
}

async function loadCrontabJobs() {
  const result = await runCommand("crontab", ["-l"]);
  if (!result.ok) {
    return {
      items: [] as CalendarItem[],
      notice: "crontab is not readable in this environment, so the calendar relies on launchd visibility only.",
    };
  }

  const items = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, index) => {
      const parts = line.split(/\s+/);
      const cron = parts.slice(0, 5).join(" ");
      const command = parts.slice(5).join(" ") || "Local cron command";

      return {
        id: `cron-${index}`,
        title: clampText(path.basename(command.split(" ")[0] || `cron-${index}`), 48),
        owner: "crontab",
        cadence: cron,
        nextRun: "Next run unknown",
        status: "Watching" as const,
        channel: "crontab",
        purpose: clampText(command, 120),
        detail: "Loaded from local crontab",
        source: connected("crontab", "Parsed from `crontab -l` on this machine"),
      } satisfies CalendarItem;
    });

  return { items, notice: undefined };
}

async function loadCalendarItems() {
  const [launchdJobs, cron] = await Promise.all([loadLaunchdJobs(), loadCrontabJobs()]);

  const launchdItems: CalendarItem[] = launchdJobs.map((job) => ({
    id: slugify(`launchd-${job.label}`),
    title: job.label,
    owner: job.domain === "system" ? "system" : "user",
    cadence: job.schedule,
    nextRun: job.nextRun,
    status: job.status,
    channel: job.type,
    purpose: job.purpose,
    detail: job.detail,
    source: connected("launchd", `Read from ${job.type} plist`, job.plistPath),
  }));

  return {
    items: [...launchdItems, ...cron.items],
    notices: cron.notice ? [cron.notice] : [],
  };
}

function buildTeam(memoryConnected: number, docCount: number, routineCount: number) {
  return [
    {
      name: "Djibril",
      role: "Principal operator",
      squad: "Leadership",
      reportsTo: "—",
      focus: "Sets direction, approves integrations, and keeps the mission local-first.",
      status: "Active",
      source: connected("Local profile", "Primary human operator represented in the MVP"),
    },
    {
      name: "Steven",
      role: "Planning counterpart",
      squad: "Coordination",
      reportsTo: "Djibril",
      focus: "Placeholder contact target for the top-bar ping action until chat hooks exist.",
      status: "Available",
      source: fallback("Local placeholder", "In-app placeholder until external messaging is wired."),
    },
    {
      name: "Henry",
      role: "Ops counterpart",
      squad: "Coordination",
      reportsTo: "Djibril",
      focus: "Placeholder contact target for local ping events and routine follow-up.",
      status: routineCount > 0 ? "Active" : "On Watch",
      source: fallback("Local placeholder", "In-app placeholder until external messaging is wired."),
    },
    {
      name: "Engineer",
      role: "Implementation agent",
      squad: "Build",
      reportsTo: "Djibril",
      focus: `Keeps ${docCount} connected docs and UI flows aligned for live integrations.`,
      status: "Active",
      source: hybrid("Hybrid role", "Agent role grounded in current local repo work."),
    },
    {
      name: "Knowledge",
      role: "Memory steward",
      squad: "Knowledge",
      reportsTo: "Djibril",
      focus: `Tracks ${memoryConnected} connected memory-like entries and marks fallbacks clearly.`,
      status: memoryConnected > 0 ? "Active" : "On Watch",
      source: hybrid("Hybrid role", "Ready to swap to real memory indexing later."),
    },
  ] satisfies TeamMember[];
}

function buildOfficeSeats(team: TeamMember[]) {
  const seating: Array<[number, number, OfficeSeat["status"], string]> = [
    [0, 0, "Working", "Reviewing connected sources"],
    [1, 0, "Syncing", "Triaging local routines"],
    [2, 0, "Idle", "Waiting for message hooks"],
    [0, 1, "Working", "Wiring integrations"],
    [1, 1, "Syncing", "Linking memory and docs"],
  ];

  return team.map((member, index) => {
    const [x, y, status, mood] = seating[index] ?? [index % 3, Math.floor(index / 3), "Idle", "Standing by"];
    return {
      name: member.name,
      role: member.role,
      x,
      y,
      mood,
      status,
      source: member.source,
    } satisfies OfficeSeat;
  });
}

function buildProjects(memoryEntries: MemoryEntry[], docs: DocItem[], calendarItems: CalendarItem[]) {
  const connectedMemory = memoryEntries.filter((entry) => entry.source.state !== "fallback");
  const connectedDocs = docs.filter((doc) => doc.source.state === "connected");
  const openClawJob = calendarItems.find((item) => item.title.includes("openclaw"));

  return [
    {
      id: "project-mission-control",
      name: "Mission Control",
      lead: "Engineer",
      stage: "Local MVP",
      progress: Math.min(92, 48 + docs.length * 3),
      summary: "UI shell is now fed by local memory, docs, and machine routine data instead of pure mock arrays.",
      taskCount: 4,
      memoryRefs: connectedMemory.slice(0, 2).map((entry) => entry.title),
      docRefs: docs.filter((doc) => doc.source.path?.startsWith("README") || doc.source.path?.startsWith("CLAUDE") || doc.source.path?.startsWith("AGENTS")).slice(0, 3).map((doc) => doc.title),
      nextAction: "Add write-path integrations for task updates and operator messaging.",
      source: hybrid("Hybrid project", "Connected to local files; task execution stays semi-realistic for now."),
    },
    {
      id: "project-workspace-engineer",
      name: "Workspace Engineer",
      lead: "Knowledge",
      stage: connectedMemory.length > 0 ? "Connected" : "Fallback assisted",
      progress: Math.min(88, 35 + connectedMemory.length * 12 + connectedDocs.length * 2),
      summary: "Pulls recent workspace markdown into memory and docs views to ground the dashboard in local context.",
      taskCount: 3,
      memoryRefs: connectedMemory.slice(0, 3).map((entry) => entry.title),
      docRefs: connectedDocs.filter((doc) => !doc.source.path?.startsWith("README")).slice(0, 3).map((doc) => doc.title),
      nextAction: connectedMemory.length > 0 ? "Index deeper workspace folders and tag memory automatically." : "Create ~/.openclaw/workspace-engineer/memory for richer connected history.",
      source: connected("Local workspace", "Derived from ~/.openclaw/workspace-engineer files."),
    },
    {
      id: "project-local-routines",
      name: "Local Routines",
      lead: "Henry",
      stage: calendarItems.length > 0 ? "Observed" : "Visibility limited",
      progress: Math.min(84, 28 + calendarItems.length * 8),
      summary: openClawJob
        ? `Launchd visibility includes ${openClawJob.title} plus other local scheduled jobs.`
        : "Routine visibility is grounded in local launchd and crontab inspection.",
      taskCount: 2,
      memoryRefs: connectedMemory.slice(0, 1).map((entry) => entry.title),
      docRefs: docs.slice(0, 2).map((doc) => doc.title),
      nextAction: "Add per-job health history and explicit next-run calculation when safe.",
      source: connected("Local routines", "Launchd and crontab inspection from this machine."),
    },
  ] satisfies Project[];
}

function buildTasks(_memoryEntries: MemoryEntry[], _docs: DocItem[], _calendarItems: CalendarItem[], _projects: Project[]): Task[] {
  // Tasks are now managed via the shared task board API, not hardcoded here
  return [];
}

function buildActivity(memoryEntries: MemoryEntry[], docs: DocItem[], calendarItems: CalendarItem[], notices: string[]) {
  const items: ActivityItem[] = [
    {
      id: "activity-refresh",
      title: "Local snapshot refreshed",
      detail: `Loaded ${docs.length} docs, ${memoryEntries.length} memory cards, and ${calendarItems.length} routine entries.`,
      time: "Just now",
      tone: "sky",
    },
  ];

  if (memoryEntries.some((entry) => entry.source.state === "connected" || entry.source.state === "hybrid")) {
    items.push({
      id: "activity-memory",
      title: "Memory connected to local files",
      detail: memoryEntries
        .filter((entry) => entry.source.state !== "fallback")
        .slice(0, 2)
        .map((entry) => entry.title)
        .join(" · ") || "Recent workspace notes are visible.",
      time: "Local",
      tone: "emerald",
    });
  }

  if (calendarItems.length > 0) {
    items.push({
      id: "activity-calendar",
      title: "Calendar view uses machine routines",
      detail: calendarItems.slice(0, 2).map((item) => item.title).join(" · "),
      time: "Local",
      tone: "violet",
    });
  }

  for (const notice of notices.slice(0, 2)) {
    items.push({
      id: `notice-${slugify(notice)}`,
      title: "Fallback guardrail active",
      detail: notice,
      time: "Now",
      tone: "amber",
    });
  }

  return items.slice(0, 6);
}

function buildMissionStats(memoryEntries: MemoryEntry[], docs: DocItem[], calendarItems: CalendarItem[], tasks: Task[]) {
  const connectedSignals = [
    memoryEntries.some((entry) => entry.source.state !== "fallback"),
    docs.some((doc) => doc.source.state === "connected"),
    calendarItems.length > 0,
  ].filter(Boolean).length;
  const health = 68 + connectedSignals * 10;

  return [
    {
      label: "Mission health",
      value: `${health}%`,
      detail: connectedSignals === 3 ? "Memory, docs, and routines are all locally grounded." : "Some screens still rely on clearly marked fallback data.",
      tone: connectedSignals === 3 ? "emerald" : "amber",
    },
    {
      label: "Active tasks",
      value: String(tasks.filter((task) => task.status !== "Done").length),
      detail: `${tasks.filter((task) => task.ownerType === "agent").length} currently owned by agents`,
      tone: "violet",
    },
    {
      label: "Scheduled routines",
      value: String(calendarItems.length),
      detail: calendarItems.length > 0 ? `${calendarItems.filter((item) => item.status === "Healthy").length} appear active locally` : "No accessible launchd or cron routines found",
      tone: "sky",
    },
    {
      label: "Docs connected",
      value: String(docs.filter((doc) => doc.source.state === "connected").length),
      detail: "Loaded from Workspace Engineer and this repo only",
      tone: "amber",
    },
  ] satisfies MissionStat[];
}

export async function getMissionControlSnapshot(): Promise<MissionControlSnapshot> {
  const now = new Date();
  const [memory, docs, calendar] = await Promise.all([loadMemoryEntries(now), loadDocs(now), loadCalendarItems()]);
  const notices = [...memory.notices, ...calendar.notices];
  const projects = buildProjects(memory.entries, docs, calendar.items);
  const tasks = buildTasks(memory.entries, docs, calendar.items, projects);
  const teamMembers = buildTeam(memory.connectedCount, docs.length, calendar.items.length);

  return {
    generatedAt: now.toISOString(),
    missionStats: buildMissionStats(memory.entries, docs, calendar.items, tasks),
    tasks,
    activityFeed: buildActivity(memory.entries, docs, calendar.items, notices),
    calendarItems: calendar.items,
    projects,
    memoryEntries: memory.entries,
    docs,
    teamMembers,
    officeSeats: buildOfficeSeats(teamMembers),
    sourceHealth: [
      memory.connectedCount > 0
        ? connected("Memory", `${memory.connectedCount} local memory-like entries loaded`, WORKSPACE_ENGINEER_MEMORY)
        : fallback("Memory", "No dedicated memory directory found; using recent workspace files plus fallback cards."),
      docs.length > 0
        ? connected("Docs", `${docs.length} local docs indexed`, WORKSPACE_ENGINEER_ROOT)
        : fallback("Docs", "No local docs found in the chosen directories."),
      calendar.items.length > 0
        ? connected("Calendar", `${calendar.items.length} local routine entries visible`, path.join(process.env.HOME ?? "", "Library/LaunchAgents"))
        : fallback("Calendar", "No accessible launchd or crontab entries were detected."),
    ],
    notices,
  };
}
