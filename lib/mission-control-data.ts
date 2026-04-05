export type ScreenId =
  | "task-board"
  | "calendar"
  | "projects"
  | "memory"
  | "docs"
  | "team"
  | "office"
  | "channel"
  | "settings"
  | "approvals";

export type MissionControlSettings = {
  autoPickup: boolean;           // auto-activate new draft projects
  deliberationMaxRounds: number; // max rounds before forced transition (default 99)
  deliberationTimeout: number;   // minutes before phase timeout (default 60)
  spawnIdleTimeout: number;      // minutes of no output before killing agent (default 30)
};

export type Tone = "violet" | "sky" | "emerald" | "amber";

export type DataState = "connected" | "hybrid" | "fallback" | "placeholder";

export type Screen = {
  id: ScreenId;
  label: string;
  shortLabel: string;
  description: string;
};

export type DataSourceMeta = {
  state: DataState;
  label: string;
  detail: string;
  path?: string;
};

export type MissionStat = {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
};

export type TaskStatus = "Backlog" | "In Progress" | "Review" | "Done";

export type Task = {
  id: string;
  title: string;
  project: string;
  owner: string;
  ownerType: "human" | "agent";
  status: TaskStatus;
  priority: "P0" | "P1" | "P2";
  eta: string;
  autopilot: string;
  notes: string;
  references: string[];
  source: DataSourceMeta;
};

export type ActivityItem = {
  id: string;
  title: string;
  detail: string;
  time: string;
  tone: Tone;
};

export type CalendarItem = {
  id: string;
  title: string;
  owner: string;
  cadence: string;
  nextRun: string;
  status: "Healthy" | "Watching" | "Paused";
  channel: string;
  purpose: string;
  detail: string;
  source: DataSourceMeta;
};

export type Project = {
  id: string;
  name: string;
  lead: string;
  stage: string;
  progress: number;
  summary: string;
  taskCount: number;
  memoryRefs: string[];
  docRefs: string[];
  nextAction: string;
  source: DataSourceMeta;
};

export type MemoryEntry = {
  id: string;
  date: string;
  title: string;
  summary: string;
  tags: string[];
  excerpt: string[];
  source: DataSourceMeta;
};

export type DocItem = {
  id: string;
  title: string;
  category: string;
  updated: string;
  summary: string;
  status: "Draft" | "Live" | "Review";
  source: DataSourceMeta;
};

export type TeamMember = {
  name: string;
  role: string;
  squad: string;
  reportsTo: string;
  focus: string;
  status: "Active" | "Available" | "On Watch";
  source: DataSourceMeta;
};

export type OfficeSeat = {
  name: string;
  role: string;
  x: number;
  y: number;
  mood: string;
  status: "Working" | "Syncing" | "Idle";
  source: DataSourceMeta;
};

export type MissionControlSnapshot = {
  generatedAt: string;
  missionStats: MissionStat[];
  tasks: Task[];
  activityFeed: ActivityItem[];
  calendarItems: CalendarItem[];
  projects: Project[];
  memoryEntries: MemoryEntry[];
  docs: DocItem[];
  teamMembers: TeamMember[];
  officeSeats: OfficeSeat[];
  sourceHealth: DataSourceMeta[];
  notices: string[];
};

// --- Multi-Agent Orchestrator Types ---

export type AgentProvider = "claude" | "codex";

export type AgentRole = {
  id: string;
  name: string;
  description: string;
  instructionsFile: string; // path to role .md file (e.g. "roles/engineer.md")
};

export type AgentConfig = {
  id: string;
  name: string;
  provider: AgentProvider;
  model?: string;
  role: string;        // role id
  file: string;        // path to agent .md memory file
  status: "active" | "paused" | "idle" | "working";
  pid?: number | null;
  lastActive?: string | null;
  currentTaskId?: string | null;
  currentTaskTitle?: string | null;
  taskStartedAt?: string | null;
  autoScaled?: boolean;  // true if created by pool scaler
  currentChannelId?: string | null;  // which channel the agent is typing in (null = working on a task, not a channel)
  reasoningEffort?: "none" | "minimal" | "low" | "medium" | "high";  // codex only
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";  // codex only
  allowedDirectories?: string[];  // extra directories the agent can access
};

export type ProviderPoolConfig = {
  maxInstances: number;
  defaultModel?: string;
  defaultRole: string;
};

export type AgentPoolConfig = {
  enabled: boolean;
  maxAgents: number;
  providers: Record<string, ProviderPoolConfig>;
  scaleUpThreshold: number;
  scaleDownAfterIdleMinutes: number;
};

export type LoopIteration = {
  iteration: number;
  result: string;
  metricValue?: string;
  timestamp: string;
};

export type LoopConfig = {
  objective: string;
  metric: string;
  maxIterations: number;
  currentIteration: number;
  iterationHistory: LoopIteration[];
  status: "running" | "paused" | "completed" | "stopped";
};

export type SharedTask = {
  id: string;
  title: string;
  description: string;
  assignee: string;    // agent id or "unassigned"
  project?: string;    // project id
  status: "todo" | "in_progress" | "review" | "done";
  priority: "P0" | "P1" | "P2";
  dueDate?: string;    // ISO date string
  order?: number;      // position within column (lower = higher)
  blocked?: boolean;
  blockedReason?: string;
  attachments?: TaskAttachment[];
  dependsOn?: string[];  // task IDs this task depends on
  preferredRole?: string;  // preferred agent role: "engineer" | "qa" | "architect" | "researcher" | "ops"
  taskType?: "standard" | "loop";
  loopConfig?: LoopConfig;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  result?: string;
};

export type ProjectPhase = "discovery" | "execution" | "retrospective" | "completed";

export type ProjectPhaseMetadata = {
  contributedAgents: string[];   // agent IDs that have spoken this round
  maxRounds: number;             // cap on deliberation rounds
  currentRound: number;
  phaseStartedAt: string;        // ISO timestamp for timeout safety
  channelId: string;             // channel for this phase
  deliberationId: string;        // unique ID scoping messages to this deliberation session
  waitingForHuman?: boolean;     // true = deliberation paused, waiting for user input
  waitingReason?: string;        // summary of what user needs to address
};

export type ProjectConfig = {
  id: string;
  name: string;
  description: string;
  color: string;       // hex color for the project
  attachments?: TaskAttachment[];
  dependsOn?: string[];  // project IDs this project depends on (for context sharing)
  status?: "draft" | "active" | "paused" | "completed" | "archived";
  phase?: ProjectPhase;
  phaseMetadata?: ProjectPhaseMetadata;
  createdAt: string;
  updatedAt: string;
};

export type DocEntry = {
  id: string;
  title: string;
  content: string;
  project?: string;     // project id
  author: string;       // agent id or "human"
  taskId?: string;      // linked task
  createdAt: string;
  updatedAt: string;
};

export type AgentMessage = {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: string;
  read: boolean;
};

export type TaskAttachment = {
  id: string;
  name: string;
  type: "file" | "path";
  path: string;
  mimeType?: string;
  size?: number;
  addedBy: string;
  addedAt: string;
};

export type Channel = {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  createdAt: string;
};

export type ChannelMessage = {
  id: string;
  channelId: string;
  from: string;
  content: string;
  taskId?: string;
  deliberationId?: string;  // scopes message to a specific deliberation session
  timestamp: string;
};

export type AgentActivity = {
  id: string;
  agent: string;
  action: string;
  detail: string;
  timestamp: string;
};

// --- Agent Metrics (Token Tracking) ---

export type AgentMetrics = {
  id: string;
  agentId: string;
  taskId: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  durationMs: number;
  provider: string;
  model: string;
  timestamp: string;
};

// --- Task Templates (Macro Actions) ---

export type TaskTemplate = {
  id: string;
  name: string;
  description: string;
  icon: string;
  tasks: { title: string; description: string; priority: "P0" | "P1" | "P2"; dependsOn?: string[] }[];
};

export const builtinTemplates: TaskTemplate[] = [
  {
    id: "feature-build",
    name: "Feature Build",
    description: "End-to-end feature development pipeline",
    icon: "rocket",
    tasks: [
      { title: "Design & plan implementation", description: "Review requirements, design the approach, identify edge cases", priority: "P1" },
      { title: "Implement core functionality", description: "Build the main feature logic", priority: "P0", dependsOn: ["Design & plan implementation"] },
      { title: "Write tests", description: "Unit and integration tests for the new feature", priority: "P1", dependsOn: ["Implement core functionality"] },
      { title: "Code review & refactor", description: "Review code quality, refactor as needed", priority: "P1", dependsOn: ["Write tests"] },
      { title: "Deploy & verify", description: "Deploy the feature and verify it works in production", priority: "P0", dependsOn: ["Code review & refactor"] },
    ],
  },
  {
    id: "bug-fix",
    name: "Bug Fix",
    description: "Systematic bug investigation and resolution",
    icon: "bug",
    tasks: [
      { title: "Reproduce the bug", description: "Create a reliable reproduction case", priority: "P0" },
      { title: "Investigate root cause", description: "Debug and identify the underlying issue", priority: "P0", dependsOn: ["Reproduce the bug"] },
      { title: "Implement fix", description: "Write the fix with minimal side effects", priority: "P0", dependsOn: ["Investigate root cause"] },
      { title: "Test fix & regression", description: "Verify the fix works and nothing else broke", priority: "P1", dependsOn: ["Implement fix"] },
    ],
  },
  {
    id: "research-spike",
    name: "Research Spike",
    description: "Time-boxed investigation and recommendation",
    icon: "search",
    tasks: [
      { title: "Define research questions", description: "Clearly state what we need to learn", priority: "P1" },
      { title: "Investigate options", description: "Research available solutions, tools, approaches", priority: "P1", dependsOn: ["Define research questions"] },
      { title: "Document findings", description: "Write up findings with pros/cons and recommendation", priority: "P1", dependsOn: ["Investigate options"] },
    ],
  },
  {
    id: "code-review-pipeline",
    name: "Code Review",
    description: "Thorough code review and quality assurance",
    icon: "eye",
    tasks: [
      { title: "Static analysis", description: "Run linters, type checks, and static analysis tools", priority: "P1" },
      { title: "Review code patterns", description: "Check for anti-patterns, code smells, and adherence to standards", priority: "P1", dependsOn: ["Static analysis"] },
      { title: "Write review summary", description: "Summarize findings with actionable feedback", priority: "P1", dependsOn: ["Review code patterns"] },
    ],
  },
  {
    id: "performance-optimization",
    name: "Performance Optimization",
    description: "Systematic performance improvement",
    icon: "zap",
    tasks: [
      { title: "Profile & benchmark", description: "Run profiler, establish baseline metrics", priority: "P0" },
      { title: "Identify bottlenecks", description: "Analyze profiles to find top performance issues", priority: "P0", dependsOn: ["Profile & benchmark"] },
      { title: "Implement optimizations", description: "Apply targeted optimizations to bottlenecks", priority: "P0", dependsOn: ["Identify bottlenecks"] },
      { title: "Verify improvements", description: "Re-benchmark and compare against baseline", priority: "P1", dependsOn: ["Implement optimizations"] },
    ],
  },
];

// Built-in roles with customizable instructions
export const builtinRoles: AgentRole[] = [
  {
    id: "engineer",
    name: "Engineer",
    description: "Writes code, builds features, fixes bugs",
    instructionsFile: "roles/engineer.md",
  },
  {
    id: "qa",
    name: "QA Engineer",
    description: "Reviews code, writes tests, catches bugs",
    instructionsFile: "roles/qa.md",
  },
  {
    id: "architect",
    name: "Architect",
    description: "Designs systems, reviews architecture, plans implementations",
    instructionsFile: "roles/architect.md",
  },
  {
    id: "researcher",
    name: "Researcher",
    description: "Investigates solutions, reads docs, gathers context",
    instructionsFile: "roles/researcher.md",
  },
  {
    id: "ops",
    name: "Ops / DevOps",
    description: "Manages deployments, infra, CI/CD, monitoring",
    instructionsFile: "roles/ops.md",
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    description: "Coordinates agents, assigns tasks, manages workflow. Best with smaller/cheaper models.",
    instructionsFile: "roles/orchestrator.md",
  },
  {
    id: "comms",
    name: "Communications",
    description: "Responds to human messages in channels, provides status updates, relays information between human and agents.",
    instructionsFile: "roles/comms.md",
  },
];

export const missionStatement =
  "Mission Control turns local workspace activity into one operating surface for tasks, routines, docs, memory, and team coordination.";

export const screens: Screen[] = [
  { id: "task-board", label: "Task Board", shortLabel: "Board", description: "Hybrid execution board built from connected local context." },
  { id: "calendar", label: "Calendar", shortLabel: "Cal", description: "launchd and crontab visibility from this machine." },
  { id: "projects", label: "Projects", shortLabel: "Proj", description: "Mission streams linked to docs, jobs, and memory." },
  { id: "memory", label: "Memory", shortLabel: "Mem", description: "Recent local notes plus clearly marked fallback entries." },
  { id: "docs", label: "Docs", shortLabel: "Docs", description: "Real local markdown and text files from selected sources." },
  { id: "team", label: "Team", shortLabel: "Team", description: "Semi-realistic operating roles, ready for live integrations." },
  { id: "office", label: "Office", shortLabel: "Office", description: "Presence view for the human-plus-agent floor." },
];
