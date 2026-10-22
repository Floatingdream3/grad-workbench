"""Offline hermes_cli.main stand-in. Never imports Hermes or makes network calls."""
import json
import os
from pathlib import Path
import re
import shutil
import sys
import time

home = Path.cwd()
behavior_file = home / 'behavior.json'
behavior = json.loads(behavior_file.read_text(encoding='utf-8')) if behavior_file.exists() else {}
args = sys.argv[1:]
assert args[0] == 'chat' and '-Q' in args
prompt = args[args.index('-q') + 1]
session = args[args.index('--resume') + 1] if '--resume' in args else None
(home / 'capture.json').write_text(json.dumps({
    'prompt': prompt, 'session': session, 'cwd': str(home),
    'home': os.environ['HERMES_HOME'], 'python': os.environ['HERMES_PYTHON'],
    'executable': sys.executable, 'pid': os.getpid(),
}, ensure_ascii=False), encoding='utf-8')
if behavior.get('mode') == 'sleep':
    time.sleep(60)
if behavior.get('mode') == 'fail':
    sys.stderr.write('offline fixture failure\n')
    sys.exit(7)
if '文献录入助手' in prompt:
    # Use the actual prompt paths so a wrong cwd/output prompt fails the tests.
    papers_match = re.search(r'复制一份到 (".*?") 目录', prompt)
    out_match = re.search(r'元数据写入 (".*?") 目录', prompt)
    assert papers_match and out_match, 'missing absolute workbench output paths'
    papers = Path(json.loads(papers_match[1]))
    out = Path(json.loads(out_match[1]))
    assert papers.is_absolute() and out.is_absolute()
    source = Path(prompt.split('文件路径：')[-1].strip())
    shutil.copyfile(source, papers / source.name)
    item = {'type': 'literature', 'title': 'Agent 文献发现 · 离线论文', 'time': '2026-10-22',
            'payload': [{'title': '离线论文', 'authors': 'Test Author', 'year': '2026',
                         'journal': 'Offline', 'doi': '', 'abstract': '离线摘要', 'url': '',
                         'file': 'papers/' + source.name}]}
    (out / 'lit_20261022_000001.json').write_text(json.dumps(item, ensure_ascii=False), encoding='utf-8')
if behavior.get('mode') != 'no-session':
    sys.stderr.write('session_id: ' + (session or 'offline-session') + '\n')
sys.stdout.write('离线回复：' + prompt)
