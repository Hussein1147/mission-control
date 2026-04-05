import { NextResponse } from "next/server";
import { spawn, execSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";

// PID files survive Next.js hot reloads — in-memory refs don't
const PID_DIR = path.join(process.cwd(), "data");
const ORCH_PID_FILE = path.join(PID_DIR, ".orchestrator.pid");
const SM_PID_FILE = path.join(PID_DIR, ".smartmemory.pid");

// In-memory refs for log streaming (best-effort; lost on HMR)
let orchestratorProc: ChildProcess | null = null;
let smartMemoryProc: ChildProcess | null = null;
let logs: string[] = [];
const MAX_LOGS = 150;

function addLog(line: string) {
  logs.push(line);
  if (logs.length > MAX_LOGS) logs = logs.slice(-MAX_LOGS);
}

// --- PID-based process tracking (survives HMR) ---

function savePid(file: string, pid: number) {
  writeFileSync(file, String(pid));
}

function readPid(file: string): number | null {
  try {
    if (!existsSync(file)) return null;
    return parseInt(readFileSync(file, "utf-8").trim(), 10) || null;
  } catch {
    return null;
  }
}

function clearPid(file: string) {
  try { unlinkSync(file); } catch {}
}

function isProcessAlive(pid: number | null): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0); // Signal 0 = just check if alive
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if orchestrator is running via:
 * 1. In-memory ChildProcess ref (if we spawned it this HMR cycle)
 * 2. PID file (if it was spawned before HMR)
 */
function isOrchestratorRunning(): boolean {
  // Check in-memory ref first
  if (orchestratorProc && orchestratorProc.exitCode === null) return true;
  // Fall back to PID file
  const pid = readPid(ORCH_PID_FILE);
  return isProcessAlive(pid);
}

function isSmartMemoryRunning(): boolean {
  if (smartMemoryProc && smartMemoryProc.exitCode === null) return true;
  const pid = readPid(SM_PID_FILE);
  return isProcessAlive(pid);
}

function getOrchestratorPid(): number | null {
  if (orchestratorProc?.pid) return orchestratorProc.pid;
  return readPid(ORCH_PID_FILE);
}

function getSmartMemoryPid(): number | null {
  if (smartMemoryProc?.pid) return smartMemoryProc.pid;
  return readPid(SM_PID_FILE);
}

// --- Kill any rogue orchestrator processes not started by us ---

function killRogueOrchestrators(ourPid: number | null) {
  try {
    const output = execSync("pgrep -f 'tsx orchestrator.ts'", { encoding: "utf-8" }).trim();
    const pids = output.split("\n").map((p) => parseInt(p, 10)).filter(Boolean);
    for (const pid of pids) {
      if (pid === ourPid) continue; // Don't kill our own
      try {
        process.kill(pid, "SIGTERM");
        addLog(`[System] Killed rogue orchestrator process (PID ${pid})`);
      } catch {}
    }
  } catch {
    // pgrep returns error if no matches — that's fine
  }
}

// --- Service wait ---

async function waitForService(url: string, maxWait = 15000): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < maxWait) {
    try {
      const res = await fetch(url);
      if (res.ok) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  return false;
}

// --- Start functions ---

function startSmartMemory(): ChildProcess {
  const cwd = path.join(process.cwd(), "smart-memory");
  const pythonPath = path.join(cwd, ".venv", "bin", "python");

  addLog("[System] Starting Smart Memory server...");

  const proc = spawn(pythonPath, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8000"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (proc.pid) savePid(SM_PID_FILE, proc.pid);

  proc.stdout?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach((line) => addLog(`[SmartMemory] ${line}`));
  });
  proc.stderr?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach((line) => addLog(`[SmartMemory] ${line}`));
  });
  proc.on("close", (code) => {
    addLog(`[SmartMemory] Exited with code ${code}`);
    smartMemoryProc = null;
    clearPid(SM_PID_FILE);
  });
  proc.on("error", (err) => {
    addLog(`[SmartMemory] Error: ${err.message}`);
    smartMemoryProc = null;
    clearPid(SM_PID_FILE);
  });

  return proc;
}

function startOrchestrator(): ChildProcess {
  const cwd = process.cwd();

  addLog("[System] Starting orchestrator...");

  const proc = spawn("npx", ["tsx", "orchestrator.ts"], {
    cwd,
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  if (proc.pid) {
    savePid(ORCH_PID_FILE, proc.pid);
    // Kill any rogue orchestrators from previous runs
    killRogueOrchestrators(proc.pid);
  }

  proc.stdout?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach((line) => addLog(line));
  });
  proc.stderr?.on("data", (data: Buffer) => {
    data.toString().split("\n").filter(Boolean).forEach((line) => addLog(`[stderr] ${line}`));
  });
  proc.on("close", (code) => {
    addLog(`[Orchestrator] Exited with code ${code}`);
    orchestratorProc = null;
    clearPid(ORCH_PID_FILE);
  });
  proc.on("error", (err) => {
    addLog(`[Orchestrator] Error: ${err.message}`);
    orchestratorProc = null;
    clearPid(ORCH_PID_FILE);
  });

  return proc;
}

// --- Kill by PID (works even after HMR loses the ref) ---

function killByPid(pidFile: string, label: string) {
  const pid = readPid(pidFile);
  if (pid && isProcessAlive(pid)) {
    try {
      process.kill(pid, "SIGTERM");
      addLog(`[System] Stopping ${label} (PID ${pid})...`);
      // Force kill after 3s
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          try {
            process.kill(pid, "SIGKILL");
            addLog(`[System] Force killed ${label}`);
          } catch {}
        }
        clearPid(pidFile);
      }, 3000);
    } catch {}
  }
  clearPid(pidFile);
}

// --- API Routes ---

export async function GET() {
  const orchRunning = isOrchestratorRunning();
  const smRunning = isSmartMemoryRunning();
  return NextResponse.json({
    running: orchRunning,
    smartMemoryRunning: smRunning,
    pid: orchRunning ? getOrchestratorPid() : null,
    smartMemoryPid: smRunning ? getSmartMemoryPid() : null,
    logs: logs.slice(-40),
  });
}

export async function POST(request: Request) {
  const body = await request.json();
  const action = body.action as string;

  if (action === "start") {
    if (isOrchestratorRunning()) {
      return NextResponse.json({ running: true, message: "Already running" });
    }

    logs = [];

    // 1. Start Smart Memory first (if not already running)
    if (!isSmartMemoryRunning()) {
      smartMemoryProc = startSmartMemory();
      addLog("[System] Waiting for Smart Memory to be ready...");
      const ready = await waitForService("http://127.0.0.1:8000/health", 20000);
      if (ready) {
        addLog("[System] Smart Memory is ready.");
      } else {
        addLog("[System] Smart Memory did not start in time — orchestrator will run without it.");
      }
    } else {
      addLog("[System] Smart Memory already running.");
    }

    // 2. Start orchestrator
    orchestratorProc = startOrchestrator();

    return NextResponse.json({
      running: true,
      smartMemoryRunning: isSmartMemoryRunning(),
      pid: orchestratorProc.pid,
      message: "Started",
    }, { status: 201 });
  }

  if (action === "stop") {
    addLog("[System] Shutting down...");

    // Stop orchestrator (via PID file — works even after HMR)
    if (orchestratorProc && orchestratorProc.exitCode === null) {
      orchestratorProc.kill("SIGTERM");
      addLog("[System] Stopping orchestrator (in-memory ref)...");
    }
    killByPid(ORCH_PID_FILE, "orchestrator");
    orchestratorProc = null;

    // Stop Smart Memory
    if (smartMemoryProc && smartMemoryProc.exitCode === null) {
      smartMemoryProc.kill("SIGTERM");
      addLog("[System] Stopping Smart Memory (in-memory ref)...");
    }
    killByPid(SM_PID_FILE, "Smart Memory");
    smartMemoryProc = null;

    return NextResponse.json({ running: false, message: "Stopping" });
  }

  return NextResponse.json({ error: "Invalid action. Use 'start' or 'stop'." }, { status: 400 });
}
