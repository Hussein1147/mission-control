"""Process management for Mission Control services."""

import json
import os
import shutil
import signal
import subprocess
import sys
import time
from pathlib import Path


def _get_project_root() -> Path:
    """Find the Next.js project files.

    Priority:
    1. Current working directory (if it has package.json with mission-control)
    2. Repo root relative to this Python package (../package.json from mission_control_cli/)
    3. The installed package's project_files/ directory (future: PyPI bundle)
    """
    # Check cwd
    cwd = Path.cwd()
    if _is_mission_control_dir(cwd):
        return cwd

    # Check repo root (one level up from mission_control_cli/)
    repo_root = Path(__file__).parent.parent
    if _is_mission_control_dir(repo_root):
        return repo_root

    # Check for bundled files (future PyPI distribution)
    bundled = Path(__file__).parent / "project_files"
    if bundled.exists():
        return bundled

    return cwd


def _is_mission_control_dir(p: Path) -> bool:
    """Check if a directory is a Mission Control project root."""
    pkg_json = p / "package.json"
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            return pkg.get("name") == "mission-control"
        except (json.JSONDecodeError, KeyError):
            pass
    return False


def _pid_file() -> Path:
    pid_dir = Path.home() / ".mission-control"
    pid_dir.mkdir(exist_ok=True)
    return pid_dir / "pids.json"


def _read_pids() -> dict:
    pf = _pid_file()
    if pf.exists():
        try:
            return json.loads(pf.read_text())
        except (json.JSONDecodeError, ValueError):
            pass
    return {}


def _write_pids(pids: dict):
    _pid_file().write_text(json.dumps(pids, indent=2))


def _is_pid_alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
        return True
    except (OSError, ProcessLookupError):
        return False


def _check_node():
    """Verify Node.js is installed and meets minimum version."""
    try:
        result = subprocess.run(
            ["node", "--version"],
            capture_output=True,
            text=True,
            timeout=10,
        )
        version = result.stdout.strip().lstrip("v")
        major = int(version.split(".")[0])
        if major < 18:
            print(f"Error: Node.js 18+ required, found v{version}")
            sys.exit(1)
        return version
    except FileNotFoundError:
        print("Error: Node.js not found. Please install Node.js 18+ from https://nodejs.org")
        sys.exit(1)
    except Exception as e:
        print(f"Error checking Node.js: {e}")
        sys.exit(1)


def _check_npm():
    """Verify npm is available."""
    try:
        subprocess.run(["npm", "--version"], capture_output=True, timeout=10, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("Error: npm not found. Please install Node.js which includes npm.")
        sys.exit(1)


def _ensure_deps(project_root: Path):
    """Run npm install if node_modules is missing or stale."""
    node_modules = project_root / "node_modules"
    if not node_modules.exists():
        print("Installing dependencies (first run)...")
        result = subprocess.run(
            ["npm", "install"],
            cwd=str(project_root),
            timeout=300,
        )
        if result.returncode != 0:
            print("Error: npm install failed")
            sys.exit(1)
        print("Dependencies installed.")


def _check_smart_memory_deps(project_root: Path) -> bool:
    """Check if Smart Memory dependencies are installed."""
    try:
        import fastapi  # noqa
        import sentence_transformers  # noqa
        return True
    except ImportError:
        return False


def _ensure_smart_memory_deps(project_root: Path):
    """Install smart-memory requirements if needed."""
    sm_dir = project_root / "smart-memory"
    if not sm_dir.exists():
        print("  Smart Memory: not found (submodule not initialized)")
        return False

    if not _check_smart_memory_deps(project_root):
        req_file = sm_dir / "requirements-cpu.txt"
        if req_file.exists():
            print("  Installing Smart Memory dependencies...")
            subprocess.run(
                [sys.executable, "-m", "pip", "install", "-r", str(req_file)],
                capture_output=True,
                timeout=300,
            )
        else:
            print("  Smart Memory: install with 'pip install mission-control-ai[memory]'")
            return False

    return True


def start_services(port: int = 3000, no_orchestrator: bool = False, no_memory: bool = False, dev: bool = True, workdir: str = None):
    """Start the Mission Control dashboard, orchestrator, and Smart Memory."""
    # Check prerequisites
    node_version = _check_node()
    _check_npm()

    project_root = Path(workdir) if workdir else _get_project_root()
    if not _is_mission_control_dir(project_root):
        print(f"Error: Could not find Mission Control project files.")
        print()
        print("Run 'python3 -m mission_control_cli init' to clone and set up the project,")
        print("or cd into an existing mission-control directory first.")
        sys.exit(1)

    # Check for existing processes
    pids = _read_pids()
    if pids.get("dashboard") and _is_pid_alive(pids["dashboard"]):
        print(f"Dashboard already running (PID {pids['dashboard']})")
        return

    _ensure_deps(project_root)

    print(f"Starting Mission Control (Node.js {node_version})...")
    print(f"  Project: {project_root}")
    print(f"  Port:    {port}")

    env = {**os.environ}

    # Start dashboard
    if dev:
        cmd = ["npm", "run", "dev"]
    else:
        # Build first if .next doesn't exist
        if not (project_root / ".next").exists():
            print("Building for production (first time)...")
            subprocess.run(["npm", "run", "build"], cwd=str(project_root), env=env, check=True)
        cmd = ["npm", "run", "start"]

    dashboard_proc = subprocess.Popen(
        cmd,
        cwd=str(project_root),
        env=env,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )

    pids = {"dashboard": dashboard_proc.pid, "port": port, "project_root": str(project_root)}

    # Start orchestrator
    orch_proc = None
    if not no_orchestrator:
        # Wait a moment for the dashboard to start accepting requests
        print("  Waiting for dashboard to be ready...")
        time.sleep(3)

        orch_proc = subprocess.Popen(
            ["npx", "tsx", "orchestrator.ts"],
            cwd=str(project_root),
            env=env,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        pids["orchestrator"] = orch_proc.pid

    # Start Smart Memory service
    memory_proc = None
    if not no_memory:
        sm_dir = project_root / "smart-memory"
        sm_server = sm_dir / "server.py"
        if sm_server.exists() and _ensure_smart_memory_deps(project_root):
            memory_proc = subprocess.Popen(
                [sys.executable, "server.py"],
                cwd=str(sm_dir),
                env=env,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            pids["memory"] = memory_proc.pid

    _write_pids(pids)

    print()
    print(f"  Dashboard:    http://localhost:{port}  (PID {dashboard_proc.pid})")
    if orch_proc:
        print(f"  Orchestrator: running                (PID {orch_proc.pid})")
    else:
        print("  Orchestrator: skipped (--no-orchestrator)")
    if memory_proc:
        print(f"  Smart Memory: running                (PID {memory_proc.pid})")
    elif not no_memory:
        print("  Smart Memory: not available (install with pip install mission-control-ai[memory])")
    else:
        print("  Smart Memory: skipped (--no-memory)")
    print()
    print("Mission Control is running. Use 'mission-control stop' to shut down.")

    # If running in foreground, wait and handle Ctrl+C
    def _shutdown(sig, frame):
        print("\nShutting down...")
        stop_services()
        sys.exit(0)

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    try:
        dashboard_proc.wait()
    except KeyboardInterrupt:
        _shutdown(None, None)


def stop_services():
    """Stop all managed Mission Control processes."""
    pids = _read_pids()
    if not pids:
        print("No running services found.")
        return

    stopped = []
    for name in ["memory", "orchestrator", "dashboard"]:
        pid = pids.get(name)
        if pid and _is_pid_alive(pid):
            try:
                os.kill(pid, signal.SIGTERM)
                stopped.append(f"{name} (PID {pid})")
            except OSError:
                pass

    _write_pids({})

    if stopped:
        print(f"Stopped: {', '.join(stopped)}")
    else:
        print("No running services found.")


def show_status():
    """Show status of managed services."""
    pids = _read_pids()
    if not pids:
        print("Mission Control is not running.")
        return

    print("Mission Control Status")
    print("-" * 40)

    dashboard_pid = pids.get("dashboard")
    port = pids.get("port", 3000)
    if dashboard_pid and _is_pid_alive(dashboard_pid):
        print(f"  Dashboard:    running (PID {dashboard_pid}, port {port})")
    else:
        print("  Dashboard:    stopped")

    orch_pid = pids.get("orchestrator")
    if orch_pid and _is_pid_alive(orch_pid):
        print(f"  Orchestrator: running (PID {orch_pid})")
    elif orch_pid:
        print("  Orchestrator: stopped")
    else:
        print("  Orchestrator: not started")

    mem_pid = pids.get("memory")
    if mem_pid and _is_pid_alive(mem_pid):
        print(f"  Smart Memory: running (PID {mem_pid})")
    elif mem_pid:
        print("  Smart Memory: stopped")

    project_root = pids.get("project_root")
    if project_root:
        print(f"  Project:      {project_root}")


REPO_URL = "https://github.com/Hussein1147/mission-control.git"


def init_workspace(force: bool = False):
    """Clone the Mission Control repo and set up the workspace."""
    cwd = Path.cwd()

    # Check if already initialized
    if _is_mission_control_dir(cwd) and not force:
        print("This directory is already a Mission Control workspace.")
        print("Use --force to re-clone.")
        return

    # Check if mission-control subdirectory already exists
    target = cwd / "mission-control"
    if target.exists() and _is_mission_control_dir(target) and not force:
        print(f"Mission Control already exists at {target}")
        print(f"  cd mission-control && python3 -m mission_control_cli start")
        return

    # Clone the repo with submodules
    print(f"Cloning Mission Control...")
    try:
        subprocess.run(
            ["git", "clone", "--recurse-submodules", REPO_URL],
            cwd=str(cwd),
            check=True,
            timeout=120,
        )
    except FileNotFoundError:
        print("Error: git not found. Please install git first.")
        sys.exit(1)
    except subprocess.CalledProcessError as e:
        print(f"Error: git clone failed (exit {e.returncode})")
        sys.exit(1)

    print(f"Installing dependencies...")
    _check_node()
    _check_npm()

    result = subprocess.run(
        ["npm", "install"],
        cwd=str(target),
        timeout=300,
    )
    if result.returncode != 0:
        print("Warning: npm install failed. You can retry manually: cd mission-control && npm install")

    print()
    print("Mission Control is ready!")
    print()
    print("Next steps:")
    print(f"  cd mission-control")
    print(f"  export ANTHROPIC_API_KEY=sk-...")
    print(f"  python3 -m mission_control_cli start")
