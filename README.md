## Mission Control

This Mission Control app is a local-only MVP wired to the machine it runs on.

Connected sources currently include:

- `~/.openclaw/workspace-engineer/memory` when present
- recent top-level markdown/text files in `~/.openclaw/workspace-engineer`
- local docs in this repo and the Workspace Engineer root
- local `launchd` jobs from LaunchAgents / LaunchDaemons
- local `crontab -l` output when readable

Fallback content is still used for sparse memory, some team data, and placeholder contact actions. The UI labels these cases explicitly.

## Getting Started

First, run the development server:

```bash
npm run dev
```

Open `http://127.0.0.1:3000` with your browser.

## Notes

- Refresh reloads the local snapshot from `/api/mission-control`.
- Search runs client-side across the loaded snapshot.
- Pause is a UI-only local state and does not modify system jobs.
- Ping Steven/Henry writes an explicit local placeholder notification only.

## Verify

```bash
npm run lint
npm run build
```
