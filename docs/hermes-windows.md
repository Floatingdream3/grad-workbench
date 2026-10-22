# Windows 配置 Hermes Agent

工作台桥服务和 `agent_runner.py` 使用相同的配置规则。配置可以来自环境变量，也可以来自本机 JSON 文件，无须修改源码中的磁盘路径。本教程不包含 API 密钥，离线测试也不使用真实 Hermes 服务或密钥。

## 1. 确认安装目录

需要 Node.js 18+ 和可运行 Hermes 的 Python 3.10+ 虚拟环境（若你的 Hermes 版本要求更新的 Python，以其要求为准）。`HERMES_HOME` 表示现有 Hermes 的工作目录，同时作为传给 Hermes 的同名环境变量；`HERMES_PYTHON` 必须指向安装了 `hermes_cli.main` 的 Python 可执行文件。

例如原来的两层安装布局迁移到 D 盘后可以是：

```text
D:/AI/Hermes/                         ← HERMES_HOME
└── hermes-agent/
    └── .venv/Scripts/python.exe      ← HERMES_PYTHON
```

也支持 `HERMES_HOME/.venv/Scripts/python.exe`，或安装在其他目录、其他磁盘的独立虚拟环境。两项路径都支持空格和中文。保留原来 Hermes 的本地配置和会话文件；仅修改路径不会迁移这些文件。

## 2. 推荐：本地配置文件

在工作台仓库根目录打开 PowerShell：

```powershell
Copy-Item -LiteralPath .\hermes.config.example.json -Destination .\hermes.local.json
notepad .\hermes.local.json
```

将路径改成自己机器上的实际路径，例如：

```json
{
  "HERMES_HOME": "D:/AI/Hermes",
  "HERMES_PYTHON": "C:/Tools/HermesVenv/Scripts/python.exe",
  "HERMES_TIMEOUT_SECONDS": 470
}
```

JSON 路径推荐使用 `/`；如果使用反斜杠，需要写成 `D:\\AI\\Hermes`。路径值中不要再包一层引号。`hermes.local.json` 已被 Git 忽略，示例文件可以提交到仓库。此文件只放路径和超时设置，凭据继续由现有 Hermes 配置管理。

如果没有设置 `HERMES_PYTHON`，会依次查找：

1. `HERMES_HOME/hermes-agent/.venv/Scripts/python.exe`
2. `HERMES_HOME/.venv/Scripts/python.exe`

两个文件都不存在时，会提示填写解释器完整路径，不会转而调用系统中不确定的 `python`。

## 3. 可选：环境变量

当前 PowerShell 窗口启动桥服务时：

```powershell
$env:HERMES_HOME = 'D:\AI\Hermes'
$env:HERMES_PYTHON = 'C:\Tools\HermesVenv\Scripts\python.exe'
$env:HERMES_TIMEOUT_SECONDS = '470'
node .\bridge-server.js
```

需要持久保存时，可在 Windows「编辑账户的环境变量」中设置以上两项，然后重新打开终端或重启自启程序。自启/计划任务必须以同一用户运行并继承相同配置。

若希望把配置放在其他位置，设置：

```powershell
$env:HERMES_CONFIG = 'C:\Users\你的用户名\workbench-config\hermes.json'
node .\bridge-server.js
```

`HERMES_CONFIG` 只通过环境变量指定。显式指定的配置文件不存在、不可读或 JSON 错误时会报错，即使同时提供了其他环境变量。JSON 文件支持 UTF-8 和 UTF-8 BOM。

## 4. 配置规则

| 设置 | 含义 | 默认值 |
|---|---|---|
| `HERMES_CONFIG` | 本机 JSON 配置文件 | 工作台根目录的 `hermes.local.json`，未创建时允许仅使用环境变量 |
| `HERMES_HOME` | Hermes 工作目录及传给 CLI 的 `HERMES_HOME` | 必须显式设置，无固定盘符 |
| `HERMES_PYTHON` | 启动运行器和 Hermes CLI 的同一个 Python | 上述两个虚拟环境候选路径 |
| `HERMES_TIMEOUT_SECONDS` | CLI 超时时间，单位秒 | `470`，允许大于 0 且不超过 86400 的十进制数 |

每项设置的优先级为：非空环境变量 → 本地配置文件 → 默认值。空白环境变量视为未设置。

JSON 内的相对路径以**配置文件所在目录**为基准；环境变量中的相对路径（包括 `HERMES_CONFIG`）以**工作台根目录**为基准。两种启动方式都遵循此规则，不受终端当前目录影响。推荐在开机自启时使用绝对路径。不会展开路径里的 `%USERPROFILE%`、`~` 或其他变量；PowerShell 中可先用 `$env:USERPROFILE` 或 `Join-Path` 生成实际路径。

桥服务会在自身启动时检查一次配置，每次 Agent 请求前再检查一次。修改 JSON 后下一次请求即可生效；修改环境变量后需要重新启动桥服务。未配置 Hermes 时，桥服务会提示「Agent 尚不可用」，其他本地功能仍可使用。

## 5. 检查并启动

在工作台根目录执行以下离线检查，只会显示路径与超时设置：

```powershell
node -e "const c = require('./hermes-config'); c.validateRunner(); console.log(c.loadHermesConfig());"
node .\bridge-server.js
```

检查包括 Hermes 工作目录、Python 文件、`agent_runner.py` 和 `hermes_config.py`。解释器文件存在但无效、缺少 Hermes 模块、CLI 异常退出时，请求也会返回清楚的错误信息。不会将 Hermes 的完整错误日志或凭据转发给网页。

桥服务仍监听 `http://127.0.0.1:5177`。按 README 启动静态网页服务后，使用现有 Agent 对话、文献分析和文献库导入入口。

如需直接运行包装器，使用同一解释器与同一配置：

```powershell
$hermesPython = 'C:\Tools\HermesVenv\Scripts\python.exe'
# query.txt 是提前保存好的 UTF-8 用户消息文件。
& $hermesPython .\agent_runner.py .\query.txt chat
# 续会话时，在末尾传入已有会话 ID。
& $hermesPython .\agent_runner.py .\query.txt chat '已有会话ID'
```

运行器 stdout 仍是 `{"reply":"...","sessionId":"...","code":0}`；失败增加 `error`，超时为 `code:124`。为兼容原协议，运行器业务失败也通过 JSON 的 `code` 表达，调用者应读取该字段。桥服务成功仍返回 HTTP 200 的 `{reply,sessionId}`，失败仍返回 HTTP 500 的 `{error}`，忙碌时仍为 HTTP 429。

## 6. 对话与文献调用链

| 功能 | 保留的入口与行为 |
|---|---|
| Agent 对话 | 网页 `sendAgentMessage` → `POST /agent/chat` → 运行器 `chat` → Hermes CLI |
| 会话恢复 | 前端 `session` 传给 CLI 的 `--resume`；显式 `null` 创建新会话，未提供 `session` 的旧调用继续使用 `data/agent_session.json` |
| 文献分析 | `/upload` 写到工作台 `data/uploads/`，`analysis` 提示词携带该文件的绝对路径 |
| 自动文献导入 | `import_lit` 使用专用提示词，将文件复制到工作台 `papers/`，将结果写入工作台 `data/agent_out/` |
| 网页入库 | 原有 30 秒轮询 `/list/agent_out`，用户点击入库提示后读取 `/read/agent_out/<文件名>`，沿用 `handleAgentOut` 和按标题去重 |
| Zotero 附件 | 沿用工作台相对路径 `papers/文件名`，原有同步逻辑继续从工作台根目录解析附件 |
| 周报与写作 | `report`、`writing` 使用各自提示词，不再回退到普通对话 |

文献结果继续使用：

```json
{
  "type": "literature",
  "title": "Agent 文献发现 · 示例论文",
  "time": "2026-10-22",
  "payload": [{
    "title": "示例论文",
    "authors": "Example Author",
    "year": "2026",
    "journal": "Unknown",
    "doi": "",
    "abstract": "示例摘要",
    "url": "",
    "file": "papers/示例论文.pdf"
  }]
}
```

会话文件仍是 `{sessionId,updatedAt}`；浏览器会话、文献库和分析历史的数据格式保持不变。迁移已有工作台时，浏览器数据、工作台 `data/`/`papers/` 和 Hermes 自己的会话文件仍需按原备份方式保留。

## 7. 运行离线测试

只需要 Node.js 18+ 和任意 Python 3.10+。无需 npm/pip 安装，不读取真实 Hermes 配置，不联网、不使用 API 密钥。测试创建临时的 `hermes_cli.main` 替身和不带 pip 的虚拟环境，在临时工作台和随机本机端口上运行，结束后清理。

```powershell
# 改为已安装的 Python 完整路径；不要求这个 Python 装有 Hermes。
$env:TEST_PYTHON = 'C:\Python312\python.exe'
node --test tests/config.test.js tests/bridge.test.js
& $env:TEST_PYTHON -m unittest discover -s tests -p 'test_*.py' -v
```

Node 测试覆盖两种解析器的一致性、环境变量优先级、不同安装布局、中文/空格路径、真实临时虚拟环境、缺失文件、无效解释器、CLI 失败、超时、进程树终止、互斥锁恢复和正常调用；还会实际执行现有前端的文献入库/去重函数。Python 测试覆盖独立运行器、配置、各场景、启动异常、UTF-8、会话和超时 JSON。

## 8. 常见错误

| 提示 | 处理方法 |
|---|---|
| 未配置 `HERMES_HOME` | 创建 `hermes.local.json` 或设置环境变量 |
| `HERMES_HOME` 工作目录不存在 | 检查实际盘符、目录和运行用户的目录权限 |
| `HERMES_PYTHON` 解释器文件不存在 | 指向实际的 `python.exe` 文件；不要填写 `python`、`py -3`、目录或附带参数的命令 |
| 启动 Hermes 失败 / `spawn UNKNOWN` | 检查是否选中了有效的 Windows Python 可执行文件及其权限，必要时重新创建虚拟环境 |
| Python 缺少模块 | 选用安装了 Hermes 及其依赖的虚拟环境；复制一个 `python.exe` 文件不能替代完整环境 |
| 缺少 Agent 运行文件 | 一并应用补丁中的运行器和配置模块，不要只复制 `bridge-server.js` |
| Agent 超时 | 检查 Hermes 或本地模型的运行状态，再按需要调整超时；桥服务还设有额外 2 秒宽限的看门狗并终止超时调用 |
| 文献入库没有提示 | 检查工作台 `data/agent_out/` 是否有 UTF-8 JSON；确认不是同名/重复标题、已导入结果，且网页已连接桥服务 |

离线测试验证启动协议和文件调用链，不验证真实模型输出质量、Hermes 工具行为或真实 Zotero/API 服务。
