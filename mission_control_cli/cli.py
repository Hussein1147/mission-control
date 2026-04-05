"""Mission Control CLI — start, stop, and manage the dashboard + orchestrator."""

import argparse
import sys

from mission_control_cli.server import (
    start_services,
    stop_services,
    show_status,
    init_workspace,
)


def main():
    parser = argparse.ArgumentParser(
        prog="mission-control",
        description="Mission Control — multi-agent coordination dashboard",
    )
    sub = parser.add_subparsers(dest="command")

    # --- start ---
    sp_start = sub.add_parser("start", help="Start the dashboard and orchestrator")
    sp_start.add_argument("--port", type=int, default=3000, help="Dashboard port (default: 3000)")
    sp_start.add_argument("--no-orchestrator", action="store_true", help="Start dashboard only, no orchestrator")
    sp_start.add_argument("--dev", action="store_true", help="Run in development mode (hot reload)")
    sp_start.add_argument("--workdir", type=str, default=None, help="Project working directory (default: current directory)")

    # --- stop ---
    sub.add_parser("stop", help="Stop all running services")

    # --- status ---
    sub.add_parser("status", help="Show status of running services")

    # --- init ---
    sp_init = sub.add_parser("init", help="Initialize a new Mission Control workspace in the current directory")
    sp_init.add_argument("--force", action="store_true", help="Overwrite existing files")

    args = parser.parse_args()

    if args.command is None:
        parser.print_help()
        sys.exit(0)

    if args.command == "start":
        start_services(
            port=args.port,
            no_orchestrator=args.no_orchestrator,
            dev=args.dev,
            workdir=args.workdir,
        )
    elif args.command == "stop":
        stop_services()
    elif args.command == "status":
        show_status()
    elif args.command == "init":
        init_workspace(force=args.force)


if __name__ == "__main__":
    main()
