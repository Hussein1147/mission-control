import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/mission-control-server";

export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(snapshot, { headers: { "Cache-Control": "no-store" } });
}
