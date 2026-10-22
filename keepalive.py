"""Local workbench supervisor. Python 3.10+, standard library only."""
from __future__ import annotations

import argparse
from dataclasses import dataclass, fields
import hashlib
import hmac
import http.client
from http.server import BaseHTTPRequestHandler, SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import os
from pathlib import Path
import secrets
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from typing import BinaryIO

ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
MAX_RESPONSE = 2 * 1024 * 1024
LOG = logging.getLogger("workbench.keepalive")


@dataclass(frozen=True)
class Config:
    bridge_port: int = 5177
    static_port: int = 8899
    check_interval: float = 30
    request_timeout: float = 2
    startup_timeout: float = 15
    failure_threshold: int = 3
    restart_delay: float = 1
    max_restart_delay: float = 60
    shutdown_timeout: float = 5
    node: str = "node"

    def validate(self) -> None:
        for name in ("bridge_port", "static_port"):
            value = getattr(self, name)
            if type(value) is not int or not 1 <= value <= 65535:
                raise ValueError(f"{name} must be an integer from 1 to 65535")
        if self.bridge_port == self.static_port:
            raise ValueError("bridge_port and static_port must be different")
        if type(self.failure_threshold) is not int or self.failure_threshold < 1:
            raise ValueError("failure_threshold must be a positive integer")
        for name in ("check_interval", "request_timeout", "startup_timeout",
                     "restart_delay", "max_restart_delay", "shutdown_timeout"):
            value = getattr(self, name)
            if type(value) not in (int, float) or not math.isfinite(value) or value <= 0:
                raise ValueError(f"{name} must be a finite positive number")
        if self.max_restart_delay < self.restart_delay:
            raise ValueError("max_restart_delay must be >= restart_delay")
        if not isinstance(self.node, str) or not self.node.strip():
            raise ValueError("node must name a Node.js executable")


def load_config(filename: str | None) -> Config:
    path = Path(filename).resolve() if filename else ROOT / "keepalive.json"
    data = json.loads(path.read_text(encoding="utf-8-sig")) if filename or path.exists() else {}
    if not isinstance(data, dict):
        raise ValueError("configuration must be a JSON object")
    unknown = data.keys() - {field.name for field in fields(Config)}
    if unknown:
        raise ValueError("unknown configuration keys: " + ", ".join(sorted(unknown)))
    config = Config(**data)
    config.validate()
    return config


def project_id() -> str:
    # The lock is per checkout, independent of config filename and port settings.
    return hashlib.sha256(os.path.normcase(str(ROOT)).encode("utf-8")).hexdigest()[:16]


def state_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA") or Path.home() / ".local" / "state")
    directory = base / "grad-workbench" / project_id()
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    return directory


class InstanceLock:
    """Hold an OS lock, never unlink its inode and never trust a recorded PID."""

    def __init__(self, directory: Path):
        self.path = directory / "instance.lock"
        self.file: BinaryIO | None = None

    def acquire(self) -> bool:
        handle = self.path.open("a+b")
        if self.path.stat().st_size == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            handle.close()
            return False
        self.file = handle
        return True

    def release(self) -> None:
        if self.file is not None:
            self.file.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.file.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.file, fcntl.LOCK_UN)
            self.file.close()
            self.file = None


def configure_logging(directory: Path) -> None:
    LOG.setLevel(logging.INFO)
    for handler in LOG.handlers[:]:
        handler.close()
        LOG.removeHandler(handler)
    handler = RotatingFileHandler(directory / "keepalive.log", maxBytes=2 * 1024 * 1024,
                                  backupCount=3, encoding="utf-8")
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    LOG.addHandler(handler)
    if sys.stdout is not None:
        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(logging.Formatter("%(levelname)s %(message)s"))
        LOG.addHandler(console)


def write_private_json(path: Path, data: object) -> None:
    temporary = path.with_suffix(".tmp")
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(data, handle)
    temporary.replace(path)


def request(port: int, path: str, timeout: float, method: str = "GET",
            token: str = "") -> tuple[int, bytes]:
    # http.client deliberately bypasses proxy variables and HTTP redirects.
    connection = http.client.HTTPConnection(HOST, port, timeout=timeout)
    try:
        headers = {"X-Workbench-Token": token} if token else {}
        connection.request(method, path, headers=headers)
        response = connection.getresponse()
        body = response.read(MAX_RESPONSE + 1)
        if len(body) > MAX_RESPONSE:
            raise ValueError("health response is too large")
        return response.status, body
    finally:
        connection.close()


def same_path(value: object, expected: Path) -> bool:
    return isinstance(value, str) and Path(value).resolve() == expected.resolve()


def health(name: str, port: int, config: Config, instance: str | None = None,
           pid: int | None = None) -> bool:
    try:
        endpoint = "/health" if name == "bridge" else "/_workbench/health"
        code, body = request(port, endpoint, config.request_timeout)
        if name == "static" and code == 404 and instance is None:
            # A manually launched `python -m http.server` has no health endpoint.
            # Verify actual project content; never accept an arbitrary open port.
            code, body = request(port, "/index.html", config.request_timeout)
            return (config.bridge_port == 5177 and code == 200
                    and body == (ROOT / "index.html").read_bytes())
        data = json.loads(body)
        expected_dir = ROOT / "data" if name == "bridge" else ROOT
        directory = data.get("dir") if name == "bridge" else data.get("project")
        valid = (code == 200 and data.get("ok") is True
                 and data.get("service") == f"grad-workbench-{name}"
                 and same_path(directory, expected_dir))
        if instance is not None:
            valid = valid and data.get("instance") == instance and data.get("pid") == pid
        if name == "static":
            valid = valid and data.get("bridge_port") == config.bridge_port
            if valid:
                code, body = request(port, "/index.html", config.request_timeout)
                valid = code == 200 and body == (ROOT / "index.html").read_bytes()
        return bool(valid)
    except (OSError, ValueError, TypeError, AttributeError, http.client.HTTPException):
        return False


def port_available(port: int) -> bool:
    with socket.socket() as sock:
        if os.name == "nt":
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        else:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind((HOST, port))
            return True
        except OSError:
            return False


def console_python() -> str:
    executable = Path(sys.executable)
    if executable.name.lower() == "pythonw.exe":
        executable = executable.with_name("python.exe")
    if not executable.is_file():
        raise ValueError("a console Python executable is required alongside pythonw.exe")
    return str(executable)


def node_executable(config: Config) -> str:
    executable = shutil.which(config.node)
    if not executable:
        raise ValueError("Node.js not found; install Node.js 18+ or set 'node' to its absolute path")
    result = subprocess.run([executable, "--version"], capture_output=True, text=True,
                            timeout=5, check=True, **hidden_process())
    if int(result.stdout.strip().lstrip("v").split(".")[0]) < 18:
        raise ValueError("Node.js 18+ is required")
    return str(Path(executable).resolve())


def hidden_process() -> dict[str, int]:
    return {"creationflags": subprocess.CREATE_NO_WINDOW} if os.name == "nt" else {}


class Service:
    def __init__(self, name: str, port: int, command: list[str], config: Config):
        self.name, self.port, self.command, self.config = name, port, command, config
        self.process: subprocess.Popen[str] | None = None
        self.reader: threading.Thread | None = None
        self.instance = ""
        self.child_token = ""
        self.started_at = 0.0
        self.healthy_since = 0.0
        self.next_start = 0.0
        self.delay = config.restart_delay
        self.failures = 0
        self.state = "pending"
        self.starts = 0

    def transition(self, state: str, message: str) -> None:
        if state != self.state:
            self.state = state
            LOG.info("%s: %s", self.name, message)

    def retry(self) -> None:
        self.next_start = time.monotonic() + self.delay
        LOG.warning("%s: retry in %.2fs", self.name, self.delay)
        self.delay = min(self.delay * 2, self.config.max_restart_delay)
        self.healthy_since = 0
        self.failures = 0

    def tick(self) -> None:
        now = time.monotonic()
        if self.process is not None:
            code = self.process.poll()
            if code is not None:
                self.close_output()
                self.process = None
                self.transition("backoff", f"child exited with code {code}")
                self.retry()
                return
            if health(self.name, self.port, self.config, self.instance, self.process.pid):
                self.failures = 0
                self.healthy_since = self.healthy_since or now
                if now - self.healthy_since >= self.config.startup_timeout:
                    self.delay = self.config.restart_delay
                self.transition("healthy", f"healthy on {HOST}:{self.port}")
                return
            self.healthy_since = 0
            if now - self.started_at < self.config.startup_timeout:
                return
            self.failures += 1
            self.transition("unhealthy", "HTTP health check failed")
            if self.failures >= self.config.failure_threshold:
                LOG.warning("%s: restarting unresponsive owned child", self.name)
                self.stop()
                self.state = "backoff"
                self.retry()
            return
        if health(self.name, self.port, self.config):
            self.transition("external", "using healthy existing service; it remains externally owned")
            return
        if now < self.next_start:
            return
        if not port_available(self.port):
            self.transition("conflict", f"port {self.port} occupied by an unhealthy/unrelated service; leaving it alone")
            self.retry()
            return
        self.instance, self.child_token = secrets.token_hex(16), secrets.token_hex(32)
        environment = dict(os.environ, WORKBENCH_INSTANCE_ID=self.instance,
                           WORKBENCH_CHILD_TOKEN=self.child_token,
                           WORKBENCH_BRIDGE_PORT=str(self.config.bridge_port),
                           PYTHONUTF8="1", PYTHONUNBUFFERED="1")
        try:
            self.process = subprocess.Popen(self.command, cwd=ROOT, env=environment,
                                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                            stderr=subprocess.STDOUT, text=True, encoding="utf-8",
                                            errors="replace", **hidden_process())
        except OSError as error:
            self.transition("backoff", f"launch failed: {error}")
            self.retry()
            return
        self.started_at = time.monotonic()
        self.healthy_since, self.failures = 0, 0
        self.starts += 1
        self.transition("starting", f"started pid={self.process.pid} on port {self.port}")
        self.reader = threading.Thread(target=self.read_output, args=(self.process,), daemon=True)
        self.reader.start()

    def read_output(self, process: subprocess.Popen[str]) -> None:
        if process.stdout is not None:
            for line in iter(lambda: process.stdout.readline(8192), ""):
                LOG.info("[%s] %s", self.name, line.rstrip())

    def close_output(self) -> None:
        if self.reader is not None:
            self.reader.join(timeout=1)
            self.reader = None
        if self.process is not None and self.process.stdout is not None:
            self.process.stdout.close()

    def stop(self) -> None:
        process = self.process
        if process is None:
            return  # Never stop an observed external service, or signal a PID from disk.
        if process.poll() is None:
            try:
                if health(self.name, self.port, self.config, self.instance, process.pid):
                    endpoint = "/control/stop" if self.name == "bridge" else "/_workbench/stop"
                    request(self.port, endpoint, self.config.request_timeout, "POST", self.child_token)
                    process.wait(timeout=self.config.shutdown_timeout)
            except (OSError, ValueError, subprocess.TimeoutExpired, http.client.HTTPException):
                LOG.warning("%s: graceful shutdown unavailable", self.name)
            if process.poll() is None:
                LOG.warning("%s: terminating owned child pid=%s", self.name, process.pid)
                try:
                    process.terminate()
                except ProcessLookupError:
                    pass  # It may have exited between poll() and terminate().
                try:
                    process.wait(timeout=self.config.shutdown_timeout)
                except subprocess.TimeoutExpired:
                    try:
                        process.kill()
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=self.config.shutdown_timeout)
        self.close_output()
        self.process = None
        self.transition("stopped", "owned child stopped")

    def snapshot(self) -> dict[str, object]:
        process = self.process
        return {"state": self.state, "port": self.port, "owned": process is not None,
                "pid": process.pid if process is not None else None, "starts": self.starts}


class LoopbackServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = os.name != "nt"

    def server_bind(self) -> None:
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def send_json(handler: BaseHTTPRequestHandler, code: int, data: object) -> None:
    body = json.dumps(data, ensure_ascii=True).encode("utf-8")
    handler.send_response(code)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class Supervisor:
    def __init__(self, config: Config, directory: Path, node: str):
        self.config, self.directory = config, directory
        self.stopping = threading.Event()
        self.token = secrets.token_hex(32)
        self.services = [
            Service("bridge", config.bridge_port, [node, str(ROOT / "bridge-server.js")], config),
            Service("static", config.static_port,
                    [console_python(), "-u", str(ROOT / "keepalive.py"), "serve-static",
                     "--port", str(config.static_port), "--bridge-port", str(config.bridge_port)], config),
        ]
        supervisor = self

        class ControlHandler(BaseHTTPRequestHandler):
            def setup(self) -> None:
                super().setup()
                self.connection.settimeout(2)

            def log_message(self, format: str, *args: object) -> None:
                pass

            def dispatch(self) -> None:
                if not hmac.compare_digest(self.headers.get("X-Workbench-Token", "").encode("utf-8"),
                                           supervisor.token.encode("ascii")):
                    send_json(self, 403, {"error": "forbidden"})
                elif self.command == "GET" and self.path == "/status":
                    send_json(self, 200, {"pid": os.getpid(), "project": str(ROOT),
                                        "stopping": supervisor.stopping.is_set(),
                                        "services": {s.name: s.snapshot() for s in supervisor.services}})
                elif self.command == "POST" and self.path == "/stop":
                    send_json(self, 200, {"ok": True})
                    supervisor.stopping.set()
                else:
                    send_json(self, 404, {"error": "not found"})

            do_GET = dispatch
            do_POST = dispatch

        self.control = LoopbackServer((HOST, 0), ControlHandler)

    def run(self) -> int:
        metadata = self.directory / "instance.json"
        thread = threading.Thread(target=self.control.serve_forever,
                                  kwargs={"poll_interval": 0.1}, daemon=True)
        thread.start()
        try:
            write_private_json(metadata, {"port": self.control.server_port, "token": self.token,
                                          "project": str(ROOT)})
            for signum in (signal.SIGINT, signal.SIGTERM):
                signal.signal(signum, lambda _number, _frame: self.stopping.set())
            LOG.info("supervisor started pid=%s project=%s", os.getpid(), ROOT)
            LOG.info("open http://%s:%s; logs: %s", HOST, self.config.static_port, self.directory)
            while not self.stopping.is_set():
                for service in self.services:
                    if self.stopping.is_set():
                        break
                    service.tick()
                # Wake for backoff deadlines as well as the regular health interval.
                now = time.monotonic()
                deadlines = [s.next_start - now for s in self.services
                             if s.process is None and s.next_start > now]
                delay = min([self.config.check_interval, *deadlines])
                self.stopping.wait(max(0.01, delay))
        finally:
            self.stopping.set()
            cleanup_errors = []
            for service in reversed(self.services):
                try:
                    service.stop()
                except (OSError, subprocess.SubprocessError) as error:
                    LOG.exception("%s: cleanup failed", service.name)
                    cleanup_errors.append(error)
            self.control.shutdown()
            self.control.server_close()
            thread.join(timeout=2)
            write_private_json(self.directory / "last-exit.json",
                               {"instance": self.token, "ok": not cleanup_errors})
            metadata.unlink(missing_ok=True)
            LOG.info("supervisor stopped; instance lock released on exit")
            if cleanup_errors:
                raise OSError("some children could not be stopped; inspect keepalive.log")
        return 0


def control_command(command: str, directory: Path, timeout: float = 30) -> int:
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be a finite positive number")
    lock = InstanceLock(directory)
    if lock.acquire():
        lock.release()
        print("Not running.")
        return 1 if command == "status" else 0
    deadline = time.monotonic() + min(timeout, 3)
    while True:
        try:
            metadata = json.loads((directory / "instance.json").read_text(encoding="utf-8"))
            break
        except FileNotFoundError:
            # A stop/status may arrive just after the lock, before startup publishes its endpoint.
            if time.monotonic() >= deadline:
                raise ValueError("supervisor is still starting; retry status or inspect keepalive.log") from None
            time.sleep(0.05)
    if (not isinstance(metadata, dict) or not same_path(metadata.get("project"), ROOT)
            or type(metadata.get("port")) is not int or not 1 <= metadata["port"] <= 65535
            or not isinstance(metadata.get("token"), str) or len(metadata["token"]) != 64
            or any(character not in "0123456789abcdef" for character in metadata["token"])):
        raise ValueError("invalid control metadata; inspect keepalive.log")
    code, body = request(metadata["port"], "/" + command, 3,
                         "POST" if command == "stop" else "GET", metadata["token"])
    if code != 200:
        raise ValueError(f"control request failed: HTTP {code}")
    if command == "status":
        print(json.dumps(json.loads(body), indent=2))
        return 0
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if lock.acquire():
            lock.release()
            try:
                result = json.loads((directory / "last-exit.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                raise ValueError("supervisor exited without confirming cleanup; inspect keepalive.log") from None
            if (not isinstance(result, dict) or result.get("instance") != metadata["token"]
                    or result.get("ok") is not True):
                raise ValueError("child cleanup was not confirmed; inspect keepalive.log")
            print("Stopped. External services, if any, were left running.")
            return 0
        time.sleep(0.1)
    raise ValueError("stop is still pending; inspect keepalive.log and retry status")


def serve_static(port: int, bridge_port: int) -> int:
    """Ordinary static files plus health, runtime port config, and owned shutdown."""
    child_token = os.environ.get("WORKBENCH_CHILD_TOKEN", "")

    class StaticHandler(SimpleHTTPRequestHandler):
        def __init__(self, *args: object, **kwargs: object):
            super().__init__(*args, directory=str(ROOT), **kwargs)

        def do_GET(self) -> None:
            pathname = self.path.split("?", 1)[0]
            if pathname == "/_workbench/health":
                send_json(self, 200, {"ok": True, "service": "grad-workbench-static",
                                     "project": str(ROOT), "pid": os.getpid(),
                                     "instance": os.environ.get("WORKBENCH_INSTANCE_ID"),
                                     "bridge_port": bridge_port})
            elif pathname == "/workbench-config.js":
                body = ("window.WORKBENCH_CONFIG = " + json.dumps(
                    {"bridgePort": bridge_port, "staticPort": port, "supervised": True}) + ";\n").encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/javascript; charset=utf-8")
                self.send_header("Content-Length", str(len(body)))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                self.wfile.write(body)
            else:
                super().do_GET()

        def do_POST(self) -> None:
            if self.path != "/_workbench/stop":
                send_json(self, 404, {"error": "not found"})
            elif not child_token or not hmac.compare_digest(
                    self.headers.get("X-Workbench-Token", "").encode("utf-8"), child_token.encode("utf-8")):
                send_json(self, 403, {"error": "forbidden"})
            else:
                send_json(self, 200, {"ok": True})
                threading.Thread(target=self.server.shutdown, daemon=True).start()

    with LoopbackServer((HOST, port), StaticHandler) as server:
        print(f"Serving workbench at http://{HOST}:{port}", flush=True)
        server.serve_forever(poll_interval=0.1)
    return 0


def startup_file(directory: Path) -> Path:
    return directory / f"GradWorkbench-{project_id()}.vbs"


def windows_startup_directory() -> Path:
    if os.name != "nt":
        raise ValueError("Startup installation is only supported on Windows")
    # Ask Windows for the actual per-user folder (including redirected profiles).
    import ctypes
    buffer = ctypes.create_unicode_buffer(32768)
    if ctypes.windll.shell32.SHGetFolderPathW(None, 0x0007, None, 0, buffer) != 0:
        raise ValueError("Windows could not locate the current user's Startup folder")
    return Path(buffer.value)


def render_vbs(pythonw: Path, config_path: str | None) -> str:
    command = [str(pythonw), str(ROOT / "keepalive.py"), "run"]
    if config_path:
        command += ["--config", str(Path(config_path).resolve())]
    values = {"@@WORKDIR@@": str(ROOT), "@@COMMAND@@": subprocess.list2cmdline(command)}
    template = (ROOT / "Startup" / "grad-workbench.vbs.in").read_text(encoding="utf-8")
    for key, value in values.items():
        template = template.replace(key, '"' + value.replace('"', '""') + '"')
    return template


def install_startup(config_path: str | None, directory: Path) -> None:
    config = load_config(config_path)
    node_executable(config)
    pythonw = Path(console_python()).with_name("pythonw.exe")
    if not pythonw.is_file():
        raise ValueError("pythonw.exe was not found beside Python; install the Windows Python distribution")
    directory.mkdir(parents=True, exist_ok=True)
    target = startup_file(directory)
    temporary = target.with_suffix(".tmp")
    # UTF-16 BOM is understood by Windows Script Host even for Chinese paths.
    temporary.write_text(render_vbs(pythonw, config_path), encoding="utf-16")
    temporary.replace(target)
    print(f"Installed: {target}\nStarts silently at the next user sign-in. Use 'run' to start now.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command")
    run_parser = commands.add_parser("run", help="supervise services in the foreground (default)")
    run_parser.add_argument("--config", help="JSON config file; defaults to keepalive.json beside this script")
    commands.add_parser("status", help="show live service state")
    stop_parser = commands.add_parser("stop", help="stop this supervisor and its owned children")
    stop_parser.add_argument("--timeout", type=float, default=30)
    for name in ("install-startup", "uninstall-startup"):
        subparser = commands.add_parser(name)
        if name == "install-startup":
            subparser.add_argument("--config")
        subparser.add_argument("--startup-dir", type=Path, help="explicit destination, also used by isolated tests")
    static_parser = commands.add_parser("serve-static", help="internal static server, normally started by run")
    static_parser.add_argument("--port", type=int, required=True)
    static_parser.add_argument("--bridge-port", type=int, required=True)
    args = parser.parse_args(argv)
    try:
        if args.command == "serve-static":
            return serve_static(args.port, args.bridge_port)
        if args.command in ("install-startup", "uninstall-startup"):
            directory = args.startup_dir or windows_startup_directory()
            if args.command == "install-startup":
                install_startup(args.config, directory)
            else:
                target = startup_file(directory)
                target.unlink(missing_ok=True)
                print(f"Removed: {target}\nUse 'stop' as well to end an active session.")
            return 0
        directory = state_dir()
        if args.command in ("stop", "status"):
            return control_command(args.command, directory, getattr(args, "timeout", 30))
        lock = InstanceLock(directory)
        if not lock.acquire():
            print("Already running for this project. Use 'status' or 'stop'.")
            return 0
        try:
            configure_logging(directory)
            config = load_config(getattr(args, "config", None))
            for filename in ("bridge-server.js", "index.html", "workbench-config.js"):
                if not (ROOT / filename).is_file():
                    raise ValueError(f"missing project file: {filename}")
            return Supervisor(config, directory, node_executable(config)).run()
        finally:
            lock.release()
    except (OSError, ValueError, subprocess.SubprocessError, http.client.HTTPException) as error:
        LOG.error("%s", error)
        if not LOG.handlers and sys.stderr is not None:
            print(f"Error: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
