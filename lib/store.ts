import Database from "better-sqlite3";
import path from "node:path";
import { promises as fs } from "node:fs";

const DB_PATH = path.join(process.cwd(), "data", "mission-control.db");

// Singleton database connection
let _db: Database.Database | null = null;

function getDb(): Database.Database {
  if (!_db) {
    _db = new Database(DB_PATH);
    _db.pragma("journal_mode = WAL"); // Write-Ahead Logging for concurrent reads
    _db.pragma("busy_timeout = 5000"); // Wait up to 5s if locked
    initTables(_db);
  }
  return _db;
}

function initTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      collection TEXT NOT NULL,
      id TEXT NOT NULL,
      data TEXT NOT NULL,
      PRIMARY KEY (collection, id)
    );
  `);
}

// --- Public API (same surface as before) ---

export async function readJSON<T>(file: string): Promise<T> {
  const collection = file.replace(".json", "");
  const db = getDb();
  const rows = db.prepare("SELECT data FROM kv WHERE collection = ? ORDER BY rowid").all(collection) as { data: string }[];
  const items = rows.map((r) => JSON.parse(r.data));
  return items as unknown as T;
}

export async function writeJSON<T>(file: string, data: T): Promise<void> {
  const collection = file.replace(".json", "");
  const db = getDb();
  const items = Array.isArray(data) ? data : [data];

  const txn = db.transaction(() => {
    db.prepare("DELETE FROM kv WHERE collection = ?").run(collection);
    const insert = db.prepare("INSERT INTO kv (collection, id, data) VALUES (?, ?, ?)");
    for (const item of items) {
      const id = (item as { id?: string }).id || generateId();
      insert.run(collection, id, JSON.stringify(item));
    }
  });
  txn();
}

export async function appendJSON<T>(file: string, item: T): Promise<void> {
  const collection = file.replace(".json", "");
  const db = getDb();
  const id = (item as { id?: string }).id || generateId();
  db.prepare("INSERT INTO kv (collection, id, data) VALUES (?, ?, ?)").run(collection, id, JSON.stringify(item));
}

export async function updateJSON<T extends { id: string }>(
  file: string,
  id: string,
  patch: Partial<T>
): Promise<T | null> {
  const collection = file.replace(".json", "");
  const db = getDb();

  const row = db.prepare("SELECT data FROM kv WHERE collection = ? AND id = ?").get(collection, id) as { data: string } | undefined;
  if (!row) return null;

  const existing = JSON.parse(row.data) as T;
  const updated = { ...existing, ...patch };
  db.prepare("UPDATE kv SET data = ? WHERE collection = ? AND id = ?").run(JSON.stringify(updated), collection, id);
  return updated;
}

export async function deleteJSON<T extends { id: string }>(
  file: string,
  id: string
): Promise<boolean> {
  const collection = file.replace(".json", "");
  const db = getDb();
  const result = db.prepare("DELETE FROM kv WHERE collection = ? AND id = ?").run(collection, id);
  return result.changes > 0;
}

export function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// --- Agent file helpers (unchanged, these work on .md files not DB) ---

export async function readAgentFile(filePath: string): Promise<{
  frontmatter: Record<string, string>;
  content: string;
}> {
  const fullPath = path.join(process.cwd(), filePath);
  const raw = await fs.readFile(fullPath, "utf-8");
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) return { frontmatter: {}, content: raw };

  const frontmatter: Record<string, string> = {};
  for (const line of fmMatch[1].split("\n")) {
    const [key, ...rest] = line.split(":");
    if (key && rest.length) {
      frontmatter[key.trim()] = rest.join(":").trim();
    }
  }
  return { frontmatter, content: fmMatch[2].trim() };
}

export async function writeAgentFile(
  filePath: string,
  frontmatter: Record<string, string>,
  content: string
): Promise<void> {
  const fullPath = path.join(process.cwd(), filePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  const fmLines = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const raw = `---\n${fmLines}\n---\n\n${content}\n`;
  await fs.writeFile(fullPath, raw, "utf-8");
}

// --- Seed initial agent data if DB is empty ---

export async function seedAgentsIfEmpty(): Promise<void> {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as c FROM kv WHERE collection = 'agents'").get() as { c: number };
  if (count.c > 0) return;

  // Seed from JSON files if they exist, otherwise use defaults
  const jsonPath = path.join(process.cwd(), "data", "agents.json");
  try {
    const raw = await fs.readFile(jsonPath, "utf-8");
    const agents = JSON.parse(raw);
    if (Array.isArray(agents) && agents.length > 0) {
      const insert = db.prepare("INSERT OR IGNORE INTO kv (collection, id, data) VALUES (?, ?, ?)");
      for (const a of agents) {
        insert.run("agents", a.id, JSON.stringify(a));
      }
      return;
    }
  } catch {}

  // Default agents
  const defaults = [
    { id: "claude", name: "Claude", provider: "claude", model: "claude-opus-4-6", role: "engineer", file: "agents/claude.md", status: "idle", pid: null, lastActive: null },
    { id: "codex", name: "Codex", provider: "codex", role: "engineer", file: "agents/codex.md", status: "idle", pid: null, lastActive: null },
  ];
  const insert = db.prepare("INSERT OR IGNORE INTO kv (collection, id, data) VALUES (?, ?, ?)");
  for (const a of defaults) {
    insert.run("agents", a.id, JSON.stringify(a));
  }
}

// --- Seed default channels if DB is empty ---

export async function seedChannelsIfEmpty(): Promise<void> {
  const db = getDb();
  const count = db.prepare("SELECT COUNT(*) as c FROM kv WHERE collection = 'channels'").get() as { c: number };
  if (count.c > 0) return;

  const defaults = [
    { id: "blockers", name: "blockers", description: "Blocked task announcements", createdBy: "system", createdAt: new Date().toISOString() },
    { id: "general", name: "general", description: "General discussion", createdBy: "system", createdAt: new Date().toISOString() },
    { id: "engineering", name: "engineering", description: "Engineering deliberation — discovery and retrospective discussions", createdBy: "system", createdAt: new Date().toISOString() },
  ];
  const insert = db.prepare("INSERT OR IGNORE INTO kv (collection, id, data) VALUES (?, ?, ?)");
  for (const ch of defaults) {
    insert.run("channels", ch.id, JSON.stringify(ch));
  }
}
