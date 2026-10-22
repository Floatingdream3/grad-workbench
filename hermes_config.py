"""Hermes paths shared by the bridge and standalone runner (see hermes-config.js)."""
import json
import math
import os
from pathlib import Path
import re
from typing import Mapping


def _reject_constant(value: str) -> None:
    raise ValueError(f'非法 JSON 常量: {value}')


def load_hermes_config(root: Path | None = None,
                       env: Mapping[str, str] | None = None) -> dict:
    root = (root or Path(__file__).resolve().parent).resolve()
    env = os.environ if env is None else env
    explicit_config = env.get('HERMES_CONFIG', '').strip()
    config_file = Path(os.path.abspath(root / (explicit_config or 'hermes.local.json')))
    local = {}
    try:
        local = json.loads(config_file.read_text(encoding='utf-8-sig'), parse_constant=_reject_constant)
    except (OSError, ValueError) as error:
        if not isinstance(error, FileNotFoundError) or explicit_config:
            raise ValueError(f'无法读取 Hermes 配置文件: {config_file}；请检查文件是否存在、可读且为合法 JSON') from error
    if not isinstance(local, dict):
        raise ValueError(f'Hermes 配置文件必须是 JSON 对象: {config_file}')

    def setting(name: str) -> tuple:
        value = env.get(name)
        if isinstance(value, str) and value.strip():
            return value.strip(), root
        return local.get(name), config_file.parent

    def file_path(name: str, required: bool = False) -> str | None:
        value, base = setting(name)
        if value is None or (isinstance(value, str) and not value.strip()):
            if required:
                raise ValueError(f'未配置 {name}；请设置环境变量或填写 {config_file}')
            return None
        if not isinstance(value, str):
            raise ValueError(f'{name} 必须是路径字符串')
        return os.path.abspath(base / value.strip())

    home = file_path('HERMES_HOME', required=True)
    if not Path(home).is_dir():
        raise ValueError(f'HERMES_HOME 工作目录不存在或不是目录: {home}')
    venv_python = ('Scripts', 'python.exe') if os.name == 'nt' else ('bin', 'python')
    candidates = [Path(home) / 'hermes-agent' / '.venv' / Path(*venv_python),
                  Path(home) / '.venv' / Path(*venv_python)]
    python = file_path('HERMES_PYTHON') or next((str(p) for p in candidates if p.is_file()), None)
    if not python or not Path(python).is_file():
        searched = python or ' 或 '.join(str(p) for p in candidates)
        raise ValueError(f'HERMES_PYTHON 解释器文件不存在: {searched}；请指定 Python 可执行文件的完整路径')
    if os.name != 'nt' and not os.access(python, os.X_OK):
        raise ValueError(f'HERMES_PYTHON 解释器不可执行: {python}')
    raw_timeout, _ = setting('HERMES_TIMEOUT_SECONDS')
    timeout = 470 if raw_timeout is None or raw_timeout == '' else raw_timeout
    if (isinstance(timeout, bool) or not isinstance(timeout, (str, int, float))
            or not re.fullmatch(r'[0-9]+(\.[0-9]+)?([eE][+-]?[0-9]+)?', str(timeout))
            or not math.isfinite(float(timeout)) or not 0 < float(timeout) <= 86400):
        raise ValueError('HERMES_TIMEOUT_SECONDS 必须是大于 0 且不超过 86400 的秒数')
    return {'home': home, 'python': python, 'timeoutSeconds': float(timeout)}
