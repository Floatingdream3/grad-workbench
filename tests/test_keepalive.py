"""Offline tests: synthetic projects, random loopback ports, no real user data."""
from __future__ import annotations

from dataclasses import replace
import hashlib
from http.server import BaseHTTPRequestHandler
import json
import logging
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from typing import Callable, TypeVar
import unittest
from unittest import mock

REPOSITORY = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPOSITORY))
import keepalive  # noqa: E402

T = TypeVar("T")


FAKE_BRIDGE = r"""
const http = require('http');
const fs = require('fs');
const path = require('path');
let unhealthy = false, hung = false;
function consume(name) {
  const marker = path.join(__dirname, name);
  if (!fs.existsSync(marker)) return false;
  fs.unlinkSync(marker);
  return true;
}
const server = http.createServer((req, res) => {
  if (req.url === '/_test/crash') {
    res.end('crashing');
    setTimeout(() => process.exit(23), 20);
    return;
  }
  if (req.url === '/control/stop') {
    res.end('{"ok":true}');
    server.close(() => process.exit(0));
    return;
  }
  unhealthy = consume('fail-health') || unhealthy;
  hung = consume('hang-health') || hung;
  if (hung) return;
  res.writeHead(unhealthy ? 503 : 200, {'Content-Type': 'application/json'});
  res.end(JSON.stringify({ok: !unhealthy, service: 'grad-workbench-bridge',
    dir: path.join(__dirname, 'data'), pid: process.pid,
    instance: process.env.WORKBENCH_INSTANCE_ID || null}));
});
server.listen(Number(process.env.WORKBENCH_BRIDGE_PORT), '127.0.0.1');
"""


def random_ports() -> tuple[int, int]:
    with socket.socket() as first, socket.socket() as second:
        first.bind((keepalive.HOST, 0))
        second.bind((keepalive.HOST, 0))
        return first.getsockname()[1], second.getsockname()[1]


class ConfigurationTests(unittest.TestCase):
    def test_cleanup_failure_still_stops_other_children_and_records_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            supervisor = keepalive.Supervisor(keepalive.Config(), directory, "not-launched")
            good, failing = mock.Mock(name="good"), mock.Mock(name="failing")
            good.name, failing.name = "good", "failing"
            failing.stop.side_effect = OSError("synthetic cleanup failure")
            supervisor.services = [good, failing]
            supervisor.stopping.set()
            with mock.patch.object(keepalive.signal, "signal"), mock.patch.object(keepalive, "LOG"):
                with self.assertRaises(OSError):
                    supervisor.run()
            good.stop.assert_called_once()
            failing.stop.assert_called_once()
            result = json.loads((directory / "last-exit.json").read_text(encoding="utf-8"))
            self.assertIs(result["ok"], False)
            self.assertFalse((directory / "instance.json").exists())

    def test_stop_does_not_claim_success_when_cleanup_failed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            token = "a" * 64
            keepalive.write_private_json(directory / "instance.json",
                                         {"project": str(keepalive.ROOT), "port": 1, "token": token})
            keepalive.write_private_json(directory / "last-exit.json", {"instance": token, "ok": False})
            with mock.patch.object(keepalive, "InstanceLock") as lock_class, \
                    mock.patch.object(keepalive, "request", return_value=(200, b'{}')):
                lock_class.return_value.acquire.side_effect = [False, True]
                with self.assertRaisesRegex(ValueError, "cleanup was not confirmed"):
                    keepalive.control_command("stop", directory)

    @unittest.skipUnless(shutil.which("node"), "Node.js is required for frontend configuration tests")
    def test_frontend_config_and_data_recovery_use_the_configured_bridge(self) -> None:
        result = subprocess.run([shutil.which("node"), str(REPOSITORY / "tests" / "frontend-config.js")],
                                capture_output=True, text=True, timeout=10, **keepalive.hidden_process())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_defaults_and_invalid_values(self) -> None:
        keepalive.Config().validate()
        cases = [
            {"bridge_port": 0}, {"static_port": 65536}, {"bridge_port": True},
            {"bridge_port": "5177"}, {"static_port": 5177},
            {"check_interval": 0}, {"request_timeout": float("nan")},
            {"startup_timeout": float("inf")}, {"failure_threshold": 1.5},
            {"failure_threshold": False}, {"restart_delay": -1},
            {"shutdown_timeout": "5"}, {"max_restart_delay": 0.5}, {"node": ""},
        ]
        for changes in cases:
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                replace(keepalive.Config(), **changes).validate()

    def test_configuration_accepts_utf8_bom_and_rejects_unknown_fields(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "config.json"
            path.write_text('{"static_port": 9001}', encoding="utf-8-sig")
            self.assertEqual(keepalive.load_config(str(path)).static_port, 9001)
            for text in ('{"typo": 1}', '[]', '{"static_port": null}', '{broken'):
                path.write_text(text, encoding="utf-8")
                with self.subTest(text=text), self.assertRaises(ValueError):
                    keepalive.load_config(str(path))

    def test_rotating_log_is_bounded(self) -> None:
        logger = logging.getLogger("workbench.keepalive.test-rotation")
        with tempfile.TemporaryDirectory() as temporary:
            with mock.patch.object(keepalive, "LOG", logger), mock.patch.object(sys, "stdout", None):
                keepalive.configure_logging(Path(temporary))
                try:
                    for _ in range(80):
                        logger.info("x" * 120000)
                    files = list(Path(temporary).glob("keepalive.log*"))
                    self.assertEqual(len(files), 4)
                    self.assertTrue(all(path.stat().st_size <= 2 * 1024 * 1024 for path in files))
                finally:
                    for handler in logger.handlers[:]:
                        handler.close()
                        logger.removeHandler(handler)

    def test_os_lock_is_released_after_holder_crashes(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            code = (
                "import sys,time; from pathlib import Path; "
                "sys.path.insert(0,sys.argv[1]); import keepalive; "
                "lock=keepalive.InstanceLock(Path(sys.argv[2])); "
                "assert lock.acquire(); print('locked',flush=True); time.sleep(60)"
            )
            holder = subprocess.Popen([sys.executable, "-u", "-c", code, str(REPOSITORY), temporary],
                                      stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                                      **keepalive.hidden_process())
            lock = keepalive.InstanceLock(Path(temporary))
            try:
                self.assertEqual(holder.stdout.readline().strip(), "locked")
                self.assertFalse(lock.acquire())
                holder.kill()
                holder.wait(timeout=5)
                self.assertTrue(lock.acquire())
            finally:
                lock.release()
                if holder.poll() is None:
                    holder.kill()
                holder.communicate(timeout=5)


@unittest.skipUnless(shutil.which("node"), "Node.js 18+ is required for integration tests")
class SupervisorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="workbench 中文 ")
        self.addCleanup(self.temporary.cleanup)
        # Hosted Windows runners may expose TEMP via an 8.3 alias (RUNNER~1).
        # Match the canonical paths used by the supervisor and Node.js.
        self.base = Path(self.temporary.name).resolve()
        self.project = self.base / "project with spaces 中文"
        self.project.mkdir()
        (self.project / "Startup").mkdir()
        for name in ("keepalive.py", "workbench-config.js"):
            shutil.copyfile(REPOSITORY / name, self.project / name)
        shutil.copyfile(REPOSITORY / "Startup" / "grad-workbench.vbs.in",
                        self.project / "Startup" / "grad-workbench.vbs.in")
        (self.project / "bridge-server.js").write_text(FAKE_BRIDGE, encoding="utf-8")
        (self.project / "index.html").write_text("<!doctype html><title>Synthetic fixture</title>", encoding="utf-8")
        self.bridge_port, self.static_port = random_ports()
        self.config = {
            "bridge_port": self.bridge_port, "static_port": self.static_port,
            "check_interval": 0.1, "request_timeout": 0.2,
            "startup_timeout": 0.5, "failure_threshold": 2,
            "restart_delay": 0.1, "max_restart_delay": 0.4, "shutdown_timeout": 0.5,
            "node": str(Path(shutil.which("node")).resolve()),
        }
        self.config_path = self.base / "config with spaces 中文.json"
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")
        self.env = dict(os.environ, LOCALAPPDATA=str(self.base / "local-state"),
                        PYTHONUTF8="1", PYTHONIOENCODING="utf-8",
                        WORKBENCH_BRIDGE_PORT=str(self.bridge_port))
        identifier = hashlib.sha256(os.path.normcase(str(self.project.resolve())).encode("utf-8")).hexdigest()[:16]
        self.state = self.base / "local-state" / "grad-workbench" / identifier
        self.processes: list[subprocess.Popen[bytes]] = []
        self.output = (self.base / "test-process-output.log").open("wb")
        self.addCleanup(self.output.close)
        self.addCleanup(self.cleanup_processes)

    def command(self, *arguments: str) -> list[str]:
        return [sys.executable, str(self.project / "keepalive.py"), *arguments]

    def cli(self, *arguments: str, timeout: float = 15) -> subprocess.CompletedProcess[str]:
        return subprocess.run(self.command(*arguments), cwd=self.base, env=self.env,
                              capture_output=True, text=True, encoding="utf-8", timeout=timeout,
                              **keepalive.hidden_process())

    def spawn(self, command: list[str]) -> subprocess.Popen[bytes]:
        process = subprocess.Popen(command, cwd=self.base, env=self.env,
                                   stdin=subprocess.DEVNULL, stdout=self.output,
                                   stderr=subprocess.STDOUT, **keepalive.hidden_process())
        self.processes.append(process)
        return process

    def start(self) -> subprocess.Popen[bytes]:
        return self.spawn(self.command("run", "--config", str(self.config_path)))

    def metadata(self) -> dict[str, object]:
        return json.loads((self.state / "instance.json").read_text(encoding="utf-8"))

    def status(self) -> dict[str, object]:
        meta = self.metadata()
        code, body = keepalive.request(meta["port"], "/status", 0.5, token=meta["token"])
        self.assertEqual(code, 200)
        return json.loads(body)

    def wait_for(self, predicate: Callable[[], T], timeout: float = 15) -> T:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                result = predicate()
                if result:
                    return result
            except (OSError, ValueError, KeyError, keepalive.http.client.HTTPException):
                pass
            time.sleep(0.05)
        log = self.state / "keepalive.log"
        tail = log.read_text(encoding="utf-8")[-5000:] if log.exists() else "No supervisor log"
        self.fail("Timed out waiting for fixture state:\n" + tail)

    def healthy(self, minimum_bridge_starts: int = 1) -> dict[str, object]:
        def ready():
            status = self.status()
            services = status["services"]
            if (all(service["state"] == "healthy" for service in services.values())
                    and services["bridge"]["starts"] >= minimum_bridge_starts):
                return status
            return None
        return self.wait_for(ready)

    def cleanup_processes(self) -> None:
        try:
            self.cli("stop", "--timeout", "10")
        except (subprocess.TimeoutExpired, OSError):
            pass
        for process in reversed(self.processes):
            if process.poll() is None:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

    def assert_ports_closed(self) -> None:
        def closed():
            for port in (self.bridge_port, self.static_port):
                with socket.socket() as sock:
                    sock.settimeout(0.1)
                    if sock.connect_ex((keepalive.HOST, port)) == 0:
                        return False
            return True
        self.wait_for(closed)

    def test_real_bridge_custom_ports_frontend_config_and_safe_stop(self) -> None:
        shutil.copyfile(REPOSITORY / "bridge-server.js", self.project / "bridge-server.js")
        supervisor = self.start()
        self.healthy()
        code, body = keepalive.request(self.bridge_port, "/health", 1)
        self.assertEqual(code, 200)
        self.assertEqual(Path(json.loads(body)["dir"]), self.project / "data")
        self.assertEqual(keepalive.request(self.bridge_port, "/sync", 1), (200, b"{}"))
        code, body = keepalive.request(self.static_port, "/workbench-config.js", 1)
        self.assertEqual(code, 200)
        config = json.loads(body.decode().split(" = ", 1)[1].strip().rstrip(";"))
        self.assertEqual(config, {"bridgePort": self.bridge_port, "staticPort": self.static_port, "supervised": True})
        self.assertEqual(keepalive.request(self.static_port, "/index.html", 1)[1],
                         (self.project / "index.html").read_bytes())
        self.assertEqual(self.cli("status").returncode, 0)
        stopped = self.cli("stop")
        self.assertEqual(stopped.returncode, 0, stopped.stderr)
        self.assertEqual(supervisor.wait(timeout=5), 0)
        self.assert_ports_closed()
        self.assertFalse((self.state / "instance.json").exists())
        self.assertEqual(self.cli("stop").returncode, 0)
        self.assertEqual(self.cli("status").returncode, 1)
        log = (self.state / "keepalive.log").read_text(encoding="utf-8")
        self.assertIn("[bridge]", log)
        self.assertIn("supervisor stopped", log)
        self.assertNotIn('"token"', log)

    def test_duplicate_and_concurrent_launches_keep_one_supervisor(self) -> None:
        first, second = self.start(), self.start()
        initial = self.healthy()
        self.wait_for(lambda: first.poll() is not None or second.poll() is not None)
        self.assertEqual(sum(process.poll() is None for process in (first, second)), 1)
        another_config = self.base / "different-config.json"
        another_config.write_text(json.dumps(dict(self.config, static_port=random_ports()[0])), encoding="utf-8")
        duplicate = self.cli("run", "--config", str(another_config))
        self.assertEqual(duplicate.returncode, 0)
        self.assertIn("Already running", duplicate.stdout)
        current = self.status()
        self.assertEqual(initial["pid"], current["pid"])
        for name in ("bridge", "static"):
            self.assertEqual(current["services"][name]["starts"], 1)
            self.assertEqual(initial["services"][name]["pid"], current["services"][name]["pid"])

    def test_crashed_bridge_is_restarted_with_nonzero_exit_logged(self) -> None:
        self.start()
        original = self.healthy()["services"]["bridge"]["pid"]
        keepalive.request(self.bridge_port, "/_test/crash", 1, "POST")
        current = self.healthy(minimum_bridge_starts=2)
        self.assertNotEqual(current["services"]["bridge"]["pid"], original)
        self.assertIn("code 23", (self.state / "keepalive.log").read_text(encoding="utf-8"))

    def test_crashed_static_server_is_restarted(self) -> None:
        self.start()
        initial = self.healthy()
        pid = initial["services"]["static"]["pid"]
        # Only crash the synthetic child's PID after verifying project and identity.
        identity = json.loads(keepalive.request(self.static_port, "/_workbench/health", 1)[1])
        self.assertEqual(Path(identity["project"]), self.project)
        self.assertEqual(identity["pid"], pid)
        os.kill(pid, signal.SIGTERM)

        def restarted():
            service = self.status()["services"]["static"]
            return service["state"] == "healthy" and service["starts"] >= 2 and service["pid"] != pid
        self.wait_for(restarted)

    def test_unhealthy_http_child_is_restarted(self) -> None:
        self.start()
        initial = self.healthy()["services"]["bridge"]["pid"]
        (self.project / "fail-health").write_text("synthetic failure", encoding="utf-8")
        current = self.healthy(minimum_bridge_starts=2)
        self.assertNotEqual(current["services"]["bridge"]["pid"], initial)
        self.assertIn("restarting unresponsive", (self.state / "keepalive.log").read_text(encoding="utf-8"))

    def test_stalled_http_child_times_out_and_recovers(self) -> None:
        self.start()
        self.healthy()
        (self.project / "hang-health").write_text("synthetic stall", encoding="utf-8")
        self.healthy(minimum_bridge_starts=2)
        self.assertIn("terminating owned child", (self.state / "keepalive.log").read_text(encoding="utf-8"))

    def check_occupied_port(self, name: str) -> None:
        port = self.bridge_port if name == "bridge" else self.static_port

        class ForeignHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                # A random server returning {ok:true} must not count as our service.
                keepalive.send_json(self, 200, {"ok": True})

            def log_message(self, *args):
                pass

        foreign = keepalive.LoopbackServer((keepalive.HOST, port), ForeignHandler)
        thread = threading.Thread(target=foreign.serve_forever, daemon=True)
        thread.start()
        try:
            self.start()
            self.wait_for(lambda: self.status()["services"][name]["state"] == "conflict")
            self.assertEqual(self.status()["services"][name]["starts"], 0)
            self.assertEqual(keepalive.request(port, "/", 1), (200, b'{"ok": true}'))
            self.assertIn("occupied", (self.state / "keepalive.log").read_text(encoding="utf-8"))
        finally:
            foreign.shutdown()
            foreign.server_close()
            thread.join(timeout=2)
        self.healthy()

    def test_bridge_port_conflict_recovers_when_released(self) -> None:
        self.check_occupied_port("bridge")

    def test_static_port_conflict_recovers_when_released(self) -> None:
        self.check_occupied_port("static")

    def test_bound_non_listening_port_is_also_a_conflict(self) -> None:
        with socket.socket() as bound:
            if os.name == "nt":
                bound.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
            bound.bind((keepalive.HOST, self.bridge_port))
            self.start()
            self.wait_for(lambda: self.status()["services"]["bridge"]["state"] == "conflict")
            self.assertEqual(self.status()["services"]["bridge"]["starts"], 0)
        self.healthy()

    def test_existing_services_are_observed_and_survive_stop(self) -> None:
        bridge = self.spawn([self.config["node"], str(self.project / "bridge-server.js")])
        static = self.spawn(self.command("serve-static", "--port", str(self.static_port),
                                         "--bridge-port", str(self.bridge_port)))
        self.wait_for(lambda: keepalive.request(self.bridge_port, "/health", 0.2)[0] == 200)
        self.wait_for(lambda: keepalive.request(self.static_port, "/_workbench/health", 0.2)[0] == 200)
        self.start()

        def observed():
            services = self.status()["services"]
            return all(service["state"] == "external" and not service["owned"] and service["starts"] == 0
                       for service in services.values())
        self.wait_for(observed)
        self.assertEqual(self.cli("stop").returncode, 0)
        self.assertIsNone(bridge.poll())
        self.assertIsNone(static.poll())
        self.assertEqual(keepalive.request(self.bridge_port, "/health", 1)[0], 200)
        self.assertEqual(keepalive.request(self.static_port, "/index.html", 1)[0], 200)

    def test_manual_python_static_server_is_recognized_by_page_content(self) -> None:
        self.spawn([sys.executable, "-m", "http.server", str(self.static_port),
                    "--bind", keepalive.HOST, "--directory", str(self.project)])
        self.wait_for(lambda: keepalive.request(self.static_port, "/index.html", 0.2)[0] == 200)
        config = keepalive.Config(static_port=self.static_port)
        with mock.patch.object(keepalive, "ROOT", self.project):
            self.assertTrue(keepalive.health("static", self.static_port, config))
            (self.project / "index.html").write_text("changed", encoding="utf-8")
            with mock.patch.object(Path, "read_bytes", return_value=b"different project"):
                self.assertFalse(keepalive.health("static", self.static_port, config))

    def test_unauthenticated_control_and_static_stop_are_rejected(self) -> None:
        supervisor = self.start()
        self.healthy()
        meta = self.metadata()
        for method, path in (("GET", "/status"), ("POST", "/stop")):
            self.assertEqual(keepalive.request(meta["port"], path, 1, method)[0], 403)
            self.assertEqual(keepalive.request(meta["port"], path, 1, method, "wrong-token")[0], 403)
        self.assertEqual(keepalive.request(self.static_port, "/_workbench/stop", 1, "POST")[0], 403)
        self.assertIsNone(supervisor.poll())
        self.healthy()

    def test_stale_metadata_does_not_block_a_new_instance(self) -> None:
        self.state.mkdir(parents=True)
        (self.state / "instance.json").write_text('{"pid": 1, "port": 1, "token": "stale"}', encoding="utf-8")
        self.assertEqual(self.cli("status").returncode, 1)
        self.start()
        self.healthy()
        self.assertNotEqual(self.metadata()["token"], "stale")

    def test_corrupt_live_metadata_reports_a_clean_error_and_can_be_restored(self) -> None:
        self.start()
        self.healthy()
        path = self.state / "instance.json"
        original = path.read_bytes()
        try:
            for content in ('[]', '{"project": null}', '{"port": "bad"}'):
                path.write_text(content, encoding="utf-8")
                result = self.cli("status")
                self.assertEqual(result.returncode, 2)
                self.assertNotIn("Traceback", result.stderr)
        finally:
            path.write_bytes(original)
        self.healthy()

    def test_stop_timeout_must_be_finite_and_positive(self) -> None:
        for value in ("nan", "inf", "0", "-1"):
            result = self.cli("stop", "--timeout", value)
            self.assertEqual(result.returncode, 2)
            self.assertNotIn("Traceback", result.stderr)

    def test_missing_node_or_bad_config_fails_without_starting_children(self) -> None:
        for data in (dict(self.config, node="missing-node-for-offline-test"),
                     dict(self.config, bridge_port=0), dict(self.config, typo=True)):
            self.config_path.write_text(json.dumps(data), encoding="utf-8")
            result = self.cli("run", "--config", str(self.config_path))
            self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
            self.assertNotIn("Traceback", result.stderr)
            self.assertFalse((self.state / "instance.json").exists())
            self.assert_ports_closed()

    @unittest.skipUnless(os.name == "nt", "Windows Script Host integration test")
    def test_vbs_install_launch_duplicate_stop_and_uninstall_in_temporary_folder(self) -> None:
        if not Path(sys.executable).with_name("pythonw.exe").is_file():
            self.skipTest("pythonw.exe is not available in this Python distribution")
        startup = self.base / "temporary Startup 中文"
        args = ("install-startup", "--config", str(self.config_path), "--startup-dir", str(startup))
        for _ in range(2):
            installed = self.cli(*args)
            self.assertEqual(installed.returncode, 0, installed.stdout + installed.stderr)
        entries = list(startup.glob("GradWorkbench-*.vbs"))
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        content = entry.read_text(encoding="utf-16")
        self.assertNotIn("@@", content)
        self.assertIn(str(self.project), content)
        self.assertIn(str(self.config_path), content)
        self.assertIn("pythonw.exe", content)
        self.assertIn(", 0, False", content)
        for _ in range(2):
            result = subprocess.run(["cscript.exe", "//nologo", str(entry)], env=self.env,
                                    capture_output=True, timeout=10, **keepalive.hidden_process())
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        initial = self.healthy()
        self.assertEqual(initial["services"]["bridge"]["starts"], 1)
        self.assertEqual(initial["services"]["static"]["starts"], 1)
        sentinel = startup / "other-program.vbs"
        sentinel.write_text("' untouched", encoding="utf-8")
        for _ in range(2):
            removed = self.cli("uninstall-startup", "--startup-dir", str(startup))
            self.assertEqual(removed.returncode, 0, removed.stdout + removed.stderr)
        self.assertFalse(entry.exists())
        self.assertTrue(sentinel.exists())
        self.assertEqual(self.status()["pid"], initial["pid"])
        self.assertEqual(self.cli("stop").returncode, 0)
        self.assert_ports_closed()


if __name__ == "__main__":
    unittest.main()
