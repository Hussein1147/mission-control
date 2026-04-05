import { NextResponse } from "next/server";
import { readJSON, writeJSON } from "@/lib/store";
import type { MissionControlSettings } from "@/lib/mission-control-data";

const FILE = "settings.json";

const DEFAULTS: MissionControlSettings = {
  autoPickup: false,
  deliberationMaxRounds: 99,
  deliberationTimeout: 60,
  spawnIdleTimeout: 45,
};

export async function GET() {
  const stored = await readJSON<MissionControlSettings[]>(FILE);
  // Settings is a single object stored as first element
  const settings = stored.length > 0 ? { ...DEFAULTS, ...stored[0] } : DEFAULTS;
  return NextResponse.json(settings);
}

export async function PATCH(request: Request) {
  const body = await request.json();
  const stored = await readJSON<MissionControlSettings[]>(FILE);
  const current = stored.length > 0 ? { ...DEFAULTS, ...stored[0] } : DEFAULTS;
  const updated = { ...current, ...body };

  // Store as a single-item array (consistent with readJSON/writeJSON pattern)
  await writeJSON(FILE, [updated]);
  return NextResponse.json(updated);
}
