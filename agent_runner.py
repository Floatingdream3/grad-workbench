# -*- coding: utf-8 -*-
"""Agent runner：桥的 Hermes 调用包装（Python→Python 避免 Windows argv 编码问题）。
用法: python agent_runner.py <query_file> <scene> [session_id]
query_file 为 UTF-8 文本（用户消息）；scene 为 chat|analysis；session_id 可选（续会话）。
stdout 输出 JSON: {"reply": str, "sessionId": str|null, "code": int}
"""
import json
import os
import re
import subprocess
import sys

SCENES = {
    'chat': '你是读研工作台的 AI 助手（Hermes Agent）。请用中文简洁、务实地回答，不要长篇大论；需要时可以调用工具或技能。\n\n用户消息：',
    'analysis': '你是读研工作台的文献分析助手（Hermes Agent）。请对以下文献内容做深度分析，输出：研究主题、核心方法、创新点、局限、对你研究的可借鉴之处（结合你自己的研究方向）。用中文，条理清晰。\n\n文献内容：',
}

# Hermes 安装位置：可通过环境变量覆盖（见 README「Agent 功能配置」）
HERMES_HOME = os.environ.get('HERMES_HOME', r'C:\hermes-agent')
HERMES_PY = os.environ.get('HERMES_PYTHON',
    os.path.join(HERMES_HOME, 'hermes-agent', '.venv', 'Scripts', 'python.exe'))

def main():
    qfile = sys.argv[1]
    scene = sys.argv[2] if len(sys.argv) > 2 else 'chat'
    prev = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] else None
    try:
        with open(qfile, encoding='utf-8') as f:
            text = f.read().strip()
    except Exception as e:
        sys.stdout.write(json.dumps({'reply': '', 'sessionId': None, 'code': 1, 'error': '读查询文件失败: %s' % e}, ensure_ascii=False))
        return
    if not text:
        sys.stdout.write(json.dumps({'reply': '', 'sessionId': None, 'code': 1, 'error': '消息为空'}, ensure_ascii=False))
        return
    env = dict(os.environ)
    env['HERMES_HOME'] = HERMES_HOME
    env['PYTHONUTF8'] = '1'
    env['PYTHONIOENCODING'] = 'utf-8'
    cmd = [HERMES_PY, '-m', 'hermes_cli.main',
           'chat', '-q', SCENES.get(scene, SCENES['chat']) + text, '-Q']
    if prev:
        cmd += ['--resume', prev]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=470,
                           cwd=HERMES_HOME, env=env, encoding='utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        sys.stdout.write(json.dumps({'reply': '', 'sessionId': prev, 'code': 124, 'error': 'Agent 超时'}, ensure_ascii=False))
        return
    m = re.search(r'session_id: (\S+)', r.stderr or '')
    sys.stdout.write(json.dumps({
        'reply': (r.stdout or '').strip(),
        'sessionId': m.group(1) if m else prev,
        'code': r.returncode,
    }, ensure_ascii=False))

if __name__ == '__main__':
    main()
