import { MissionControlAppShell } from "@/components/app-shell";
import { getMissionControlSnapshot } from "@/lib/mission-control-server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getMissionControlSnapshot();

  return <MissionControlAppShell initialData={snapshot} />;
}
