"""Standard-library-only offline tests. No Hermes installation or credentials needed."""
from contextlib import redirect_stdout
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import agent_runner
from hermes_config import load_hermes_config


def clean_env(extra: dict | None = None) -> dict:
    keys = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP',
            'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'LANG']
    result = {key: os.environ[key] for key in keys if key in os.environ}
    result.update({'PYTHONUTF8': '1', 'PYTHONIOENCODING': 'utf-8'})
    result.update(extra or {})
    return result


class Fixture(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory(prefix='gradwb-python-offline-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.home = self.root / 'Hermes 安装 with spaces'
        self.home.mkdir()
        self.workbench = self.root / '工作台 with spaces'
        self.workbench.mkdir()
        self.config = self.root / 'hermes.local.json'
        self.settings = {'HERMES_HOME': str(self.home), 'HERMES_PYTHON': sys.executable,
                         'HERMES_TIMEOUT_SECONDS': 3}
        self.write_config()

    def write_config(self, **overrides) -> None:
        self.config.write_text(json.dumps({**self.settings, **overrides}, ensure_ascii=False), encoding='utf-8')


class ConfigTests(Fixture):
    def test_local_file(self) -> None:
        result = load_hermes_config(self.root, {})
        self.assertEqual(result, {'home': str(self.home), 'python': sys.executable, 'timeoutSeconds': 3})

    def test_environment_overrides_file(self) -> None:
        home = self.root / '环境变量 安装'
        home.mkdir()
        env = {'HERMES_HOME': str(home), 'HERMES_PYTHON': sys.executable, 'HERMES_TIMEOUT_SECONDS': '1.5'}
        self.write_config(HERMES_HOME='missing', HERMES_PYTHON='missing')
        result = load_hermes_config(self.root, env)
        self.assertEqual(result['home'], str(home))
        self.assertEqual(result['python'], sys.executable)
        self.assertEqual(result['timeoutSeconds'], 1.5)

    def test_relative_paths_and_bom(self) -> None:
        folder = self.root / '配置 目录'
        folder.mkdir()
        config = folder / 'machine.json'
        config.write_text('\ufeff' + json.dumps({'HERMES_HOME': '../' + self.home.name,
                                               'HERMES_PYTHON': sys.executable}), encoding='utf-8')
        result = load_hermes_config(self.root, {'HERMES_CONFIG': '配置 目录/machine.json'})
        self.assertEqual(result['home'], str(self.home))
        self.assertEqual(result['timeoutSeconds'], 470)

    def test_relative_environment_path_uses_workbench(self) -> None:
        result = load_hermes_config(self.root, {'HERMES_HOME': self.home.name})
        self.assertEqual(result['home'], str(self.home))

    def test_blank_environment_falls_back_to_file(self) -> None:
        self.assertEqual(load_hermes_config(self.root, {'HERMES_HOME': ' ', 'HERMES_PYTHON': ''})['home'], str(self.home))

    def test_default_nested_and_direct_virtualenv(self) -> None:
        suffix = Path('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
        nested = self.home / 'hermes-agent' / '.venv' / suffix
        direct = self.home / '.venv' / suffix
        for executable in [nested, direct]:
            executable.parent.mkdir(parents=True)
            executable.write_text('offline placeholder')
            executable.chmod(0o755)
        self.write_config(HERMES_PYTHON=None)
        for expected in [nested, direct]:
            with self.subTest(expected=expected):
                self.assertEqual(load_hermes_config(self.root, {})['python'], str(expected))
                expected.unlink()

    def test_missing_home_and_interpreter(self) -> None:
        self.config.unlink()
        with self.assertRaisesRegex(ValueError, '未配置 HERMES_HOME'):
            load_hermes_config(self.root, {})
        for env, message in [({'HERMES_HOME': 'missing'}, 'HERMES_HOME.*不存在'),
                             ({'HERMES_HOME': str(self.home)}, 'HERMES_PYTHON.*不存在'),
                             ({'HERMES_HOME': str(self.home), 'HERMES_PYTHON': 'missing.exe'}, 'HERMES_PYTHON.*不存在')]:
            with self.subTest(env=env), self.assertRaisesRegex(ValueError, message):
                load_hermes_config(self.root, env)

    def test_missing_explicit_config_is_an_error(self) -> None:
        with self.assertRaisesRegex(ValueError, '配置文件'):
            load_hermes_config(self.root, {'HERMES_CONFIG': 'missing.json'})

    def test_malformed_config_and_non_object(self) -> None:
        for raw in ['{broken', '[]', 'null', '{"extra": NaN}', '{"extra": Infinity}']:
            self.config.write_text(raw, encoding='utf-8')
            with self.subTest(raw=raw), self.assertRaisesRegex(ValueError, '配置文件'):
                load_hermes_config(self.root, {})

    def test_wrong_types_and_invalid_timeout(self) -> None:
        for key, value, message in [('HERMES_HOME', 42, 'HERMES_HOME'), ('HERMES_PYTHON', [], 'HERMES_PYTHON')]:
            self.write_config(**{key: value})
            with self.subTest(key=key), self.assertRaisesRegex(ValueError, message):
                load_hermes_config(self.root, {})
        for timeout in [0, -1, 86401, 'NaN', 'Infinity', True, {}, '0x10', '١']:
            self.write_config(HERMES_TIMEOUT_SECONDS=timeout)
            with self.subTest(timeout=timeout), self.assertRaisesRegex(ValueError, 'HERMES_TIMEOUT_SECONDS'):
                load_hermes_config(self.root, {})

    def test_normalized_small_timeout(self) -> None:
        result = load_hermes_config(self.root, {'HERMES_TIMEOUT_SECONDS': '1e-7'})
        self.assertEqual(result['timeoutSeconds'], 0.0000001)

    @unittest.skipIf(os.name == 'nt', 'Windows executable validity is checked by actual spawn tests')
    def test_non_executable_python(self) -> None:
        python = self.home / 'python'
        python.write_text('not executable')
        python.chmod(0o644)
        self.write_config(HERMES_PYTHON=str(python))
        with self.assertRaisesRegex(ValueError, '不可执行'):
            load_hermes_config(self.root, {})


class RunnerTests(Fixture):
    def setUp(self) -> None:
        super().setUp()
        self.query = self.root / '中文 query.txt'
        self.query.write_text('中文问题与文献', encoding='utf-8')
        module = self.home / 'hermes_cli'
        module.mkdir()
        (module / '__init__.py').write_text('')
        shutil.copyfile(ROOT / 'tests' / 'fixtures' / 'fake_hermes.py', module / 'main.py')
        self.env = clean_env({'HERMES_CONFIG': str(self.config), 'GRAD_WORKBENCH_ROOT': str(self.workbench)})

    def invoke(self, scene: str = 'chat', session: str | None = None,
               query: Path | None = None) -> dict:
        args = [sys.executable, str(ROOT / 'agent_runner.py'), str(query or self.query), scene]
        if session:
            args.append(session)
        result = subprocess.run(args, cwd=self.root, env=self.env, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr.decode('utf-8', errors='replace'))
        self.assertEqual(result.stderr, b'')
        return json.loads(result.stdout.decode('utf-8'))

    def behavior(self, mode: str) -> None:
        (self.home / 'behavior.json').write_text(json.dumps({'mode': mode}), encoding='utf-8')

    def capture(self) -> dict:
        return json.loads((self.home / 'capture.json').read_text(encoding='utf-8'))

    def test_standalone_normal_call_and_unicode(self) -> None:
        result = self.invoke()
        self.assertEqual(set(result), {'reply', 'sessionId', 'code'})
        self.assertEqual(result['code'], 0)
        self.assertEqual(result['sessionId'], 'offline-session')
        self.assertIn('中文问题与文献', result['reply'])
        capture = self.capture()
        self.assertEqual(capture['cwd'], str(self.home))
        self.assertEqual(capture['home'], str(self.home))
        self.assertEqual(capture['python'], sys.executable)

    def test_session_resume_and_missing_session_marker(self) -> None:
        self.behavior('no-session')
        result = self.invoke(session='previous-session')
        self.assertEqual(result['sessionId'], 'previous-session')
        self.assertEqual(self.capture()['session'], 'previous-session')

    def test_scenes_have_dedicated_prompts(self) -> None:
        for scene, text in [('analysis', '文献分析助手'), ('report', '本周工作记录'),
                            ('writing', '学术写作助手'), ('unknown', 'AI 助手')]:
            with self.subTest(scene=scene):
                self.assertEqual(self.invoke(scene)['code'], 0)
                self.assertIn(text, self.capture()['prompt'])

    def test_import_uses_workbench_paths_and_preserves_payload(self) -> None:
        source = self.root / '离线论文.txt'
        source.write_text('离线全文', encoding='utf-8')
        self.query.write_text(str(source), encoding='utf-8')
        self.assertEqual(self.invoke('import_lit')['code'], 0)
        item = json.loads((self.workbench / 'data' / 'agent_out' / 'lit_20261022_000001.json').read_text(encoding='utf-8'))
        self.assertEqual(item['type'], 'literature')
        self.assertEqual(item['payload'][0]['file'], 'papers/离线论文.txt')
        self.assertEqual((self.workbench / item['payload'][0]['file']).read_text(encoding='utf-8'), '离线全文')
        self.assertFalse((self.home / 'data' / 'agent_out').exists())

    def test_missing_query_and_empty_message(self) -> None:
        self.assertIn('读查询文件失败', self.invoke(query=self.root / 'missing.txt')['error'])
        self.query.write_text('  \n', encoding='utf-8')
        self.assertIn('消息为空', self.invoke()['error'])

    def test_missing_interpreter_is_structured_error(self) -> None:
        self.write_config(HERMES_PYTHON='missing python.exe')
        result = self.invoke(session='old-session')
        self.assertEqual(result['code'], 1)
        self.assertEqual(result['sessionId'], 'old-session')
        self.assertIn('HERMES_PYTHON', result['error'])

    def test_cli_nonzero_exit_and_missing_module(self) -> None:
        self.behavior('fail')
        failed = self.invoke()
        self.assertEqual(failed['code'], 7)
        self.assertIn('异常退出(7)', failed['error'])
        shutil.rmtree(self.home / 'hermes_cli')
        failed = self.invoke()
        self.assertNotEqual(failed['code'], 0)
        self.assertIn('缺少模块', failed['error'])

    def test_real_timeout_returns_code_124(self) -> None:
        self.behavior('sleep')
        self.write_config(HERMES_TIMEOUT_SECONDS=0.3)
        failed = self.invoke(session='old-session')
        self.assertEqual(failed['code'], 124)
        self.assertEqual(failed['sessionId'], 'old-session')
        self.assertIn('Agent 超时', failed['error'])

    def test_os_errors_and_timeout_exceptions_stay_json(self) -> None:
        for error, code in [(FileNotFoundError('missing executable'), 1),
                            (PermissionError('permission denied'), 1),
                            (subprocess.TimeoutExpired('offline', 1), 124)]:
            output = io.StringIO()
            with self.subTest(error=error), patch.dict(os.environ, self.env, clear=True), \
                    patch.object(agent_runner.subprocess, 'run', side_effect=error), redirect_stdout(output):
                agent_runner.main([str(self.query), 'chat', 'keep'])
            result = json.loads(output.getvalue())
            self.assertEqual(result['code'], code)
            self.assertEqual(result['sessionId'], 'keep')
            self.assertTrue(result['error'])

    def test_missing_arguments_return_json_usage(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            agent_runner.main([])
        self.assertIn('用法', json.loads(output.getvalue())['error'])


if __name__ == '__main__':
    unittest.main()
