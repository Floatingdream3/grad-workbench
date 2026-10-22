# -*- coding: utf-8 -*-
"""Agent runner：桥的 Hermes 调用包装（Python→Python 避免 Windows argv 编码问题）。
用法: python agent_runner.py <query_file> <scene> [session_id]
query_file 为 UTF-8 文本（用户消息）；scene 为 chat|analysis|report|writing|import_lit。
session_id 可选（续会话）。路径配置见 docs/hermes-windows.md。
stdout 输出 JSON: {"reply": str, "sessionId": str|null, "code": int}
"""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from hermes_config import load_hermes_config

SCENES = {
    'chat': '你是读研工作台的 AI 助手（Hermes Agent）。请用中文简洁、务实地回答，不要长篇大论；需要时可以调用工具或技能。\n\n用户消息：',
    'analysis': '你是读研工作台的文献分析助手（Hermes Agent）。请对以下文献内容做深度分析，输出：研究主题、核心方法、创新点、局限、对你研究的可借鉴之处（结合你自己的研究方向）。用中文，条理清晰。\n\n文献内容：',
    'report': '你是科研助手。根据下面的本周工作记录（日期/时长/标签/内容），生成一份简洁周报：**本周概况**（总时长、有效天数）、**主要工作**（按标签归类要点）、**本周成果与亮点**、**下周建议**（1-2 条）。客观简洁，中文输出，可直接粘贴到组会汇报。\n\n本周工作记录：\n',
    'writing': '你是学术写作助手。用户会指定任务：①论文大纲 ②文本润色/改写 ③投稿 cover letter。按用户指令执行，输出规范、可直接使用的完整文本（中文），不要多余解释。\n',
    'import_lit': '你是读研工作台的文献录入助手（Hermes Agent）。请完整读取用户提供的本地文献文件（PDF/文本，read_file 或 pdf 工具），提取元数据：title(标题)、authors(作者，逗号分隔)、year(年份)、journal(期刊/会议，未知填 Unknown)、doi(可空)、abstract(摘要，截取前 500 字)、url(原文链接，可空)。',
}


def emit(reply: str = '', session: str | None = None, code: int = 1,
         error: str | None = None) -> None:
    result = {'reply': reply, 'sessionId': session, 'code': code}
    if error:
        result['error'] = error
    sys.stdout.write(json.dumps(result, ensure_ascii=False))


def scene_prompt(scene: str, text: str) -> str:
    prefix = SCENES.get(scene, SCENES['chat'])
    if scene == 'import_lit':
        root = Path(os.environ.get('GRAD_WORKBENCH_ROOT') or Path(__file__).resolve().parent).resolve()
        papers = root / 'papers'
        out = root / 'data' / 'agent_out'
        papers.mkdir(parents=True, exist_ok=True)
        out.mkdir(parents=True, exist_ok=True)
        # Absolute output paths are independent of the Hermes process cwd.
        prefix += (
            f'然后把该文件复制一份到 {json.dumps(papers.as_posix(), ensure_ascii=False)} 目录（文件名保持原样）。'
            f'最后把元数据写入 {json.dumps(out.as_posix(), ensure_ascii=False)} 目录下的 '
            'lit_<当前时间戳YYYYMMDD_HHMMSS>.json 文件，结构：'
            '{"type":"literature","title":"Agent 文献发现 · <标题>","time":"<当前时间>",'
            '"payload":[{"title":"","authors":"","year":"","journal":"","doi":"","abstract":"","url":"","file":""}]}。'
            'file 字段保持工作台相对路径 papers/文件名.pdf；严格 JSON，用 UTF-8 写入。文件路径：'
        )
    return prefix + text


def main(argv: list[str] | None = None) -> None:
    # JSON on stdout must stay UTF-8 even when launched directly in Windows.
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    argv = sys.argv[1:] if argv is None else argv
    if not argv:
        emit(error='用法: python agent_runner.py <query_file> <scene> [session_id]')
        return
    qfile = argv[0]
    scene = argv[1] if len(argv) > 1 else 'chat'
    prev = argv[2] if len(argv) > 2 and argv[2] else None
    try:
        with open(qfile, encoding='utf-8') as f:
            text = f.read().strip()
    except (OSError, UnicodeError) as e:
        emit(session=prev, error='读查询文件失败: %s' % e)
        return
    if not text:
        emit(session=prev, error='消息为空')
        return
    try:
        config = load_hermes_config()
        prompt = scene_prompt(scene, text)
    except (OSError, ValueError) as e:
        emit(session=prev, error=str(e))
        return
    env = dict(os.environ)
    env['HERMES_HOME'] = config['home']
    env['HERMES_PYTHON'] = config['python']
    env['PYTHONUTF8'] = '1'
    env['PYTHONIOENCODING'] = 'utf-8'
    cmd = [config['python'], '-m', 'hermes_cli.main', 'chat', '-q', prompt, '-Q']
    if prev:
        cmd += ['--resume', prev]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=config['timeoutSeconds'],
                           cwd=config['home'], env=env, encoding='utf-8', errors='replace')
    except subprocess.TimeoutExpired:
        emit(session=prev, code=124, error='Agent 超时；请检查 HERMES_TIMEOUT_SECONDS')
        return
    except OSError as e:
        emit(session=prev, error='启动 Hermes 失败: %s；请检查 HERMES_PYTHON 和 HERMES_HOME' % e)
        return
    m = re.search(r'session_id: (\S+)', r.stderr or '')
    error = None
    if r.returncode:
        error = 'Hermes 异常退出(%s)；请检查 Hermes 安装、依赖和本地模型配置' % r.returncode
        if 'No module named' in (r.stderr or ''):
            error += '；Python 缺少模块，请确认 HERMES_PYTHON 指向已安装 Hermes 的虚拟环境'
    emit(reply=(r.stdout or '').strip(), session=m.group(1) if m else prev,
         code=r.returncode, error=error)

if __name__ == '__main__':
    main()
