# 读研工作台

一个**纯静态 + 本地优先**的个人科研工作台。所有数据保存在你自己的浏览器里（localStorage），不依赖任何云端服务——数据 100% 归你所有，离线也能用。

![技术栈](https://img.shields.io/badge/HTML%20%2B%20CSS%20%2B%20JS-零框架-blue) ![存储](https://img.shields.io/badge/存储-localStorage-green) ![协议](https://img.shields.io/badge/license-MIT-orange)

## ✨ 它能做什么

| 模块 | 功能 |
|---|---|
| 🏠 首页 | 时钟问候 / 语录轮换 / 天气 / 快记 / 周时长柱状图 / 里程碑 / 文献动态 |
| 📝 工作总结 | 每日工作记录 + 标签统计 + 周复盘 + AI 周报生成 |
| 📅 工作日历 | 月历日程、截稿/会议提醒、工作日记 |
| 📡 文献雷达 | arXiv 关键词订阅，新论文自动推送 |
| 📚 文献库 | 增删改查、分类管理、精读笔记模板、本地 PDF 导入、CSV 导出 |
| 🔬 文献分析 | 接入 AI Agent 深度分析文献（方法/创新点/可借鉴之处） |
| ✉️ 投稿管理 | 稿件状态跟踪、截稿倒计时、投稿信生成 |
| ✍️ 文章管理 | 论文分部分管理、AI 写作助手（大纲/润色/cover letter） |
| 🔤 英语学习 | 多词库背单词（六级/考研/雅思）、每日打卡、AI 例句翻译、听写测验 |
| 💪 健身记录 | 运动记录 + 热力图 + 周时长统计 |
| 🌐 网站索引 | 常用网站快捷入口（增删/拖拽排序） |
| ✅ 任务清单 / 笔记 | 待办任务、目标管理、Markdown 笔记 |
| 🔑 API 管理 | 多平台额度监控 + 密钥管理（详见下文） |
| 🤖 Agent 助手 | 多会话 AI 对话 |

## 🔑 API 管理页（特色功能）

统一管理你的 AI API 资源：

- **额度监控**：opencode 用量 / DeepSeek 余额 / 基元律动余额 / SenseNova Token Plan（5 小时窗口剩余额度 + 7 天调用趋势）/ 肖恩AI 额度
- **中转站入口**：公益站 & 付费站快捷入口 + 密钥记录（脱敏显示 / 一键复制 / 编辑）
- **密钥安全**：所有密钥只存在你自己的浏览器 localStorage，不经过任何第三方服务器

## 🚀 快速开始

### 方式一：直接打开（2 秒）

双击 `index.html` 用浏览器打开即可。文献库 / 日历 / 笔记 / 英语学习等全部核心功能立即可用。

### 方式二：接入桥服务（解锁 AI 功能）

桥服务是一个可选的本地 Node.js 服务，提供 AI 对话代理、API 额度查询、Zotero 同步、数据备份等能力：

```bash
# 1. 安装 Node.js 18+
# 2. 启动桥
node bridge-server.js        # 监听 http://127.0.0.1:5177

# 3. 启动静态服务器（任选其一）
python -m http.server 8899   # 或 npx serve -p 8899

# 4. 浏览器打开
# http://127.0.0.1:8899
```

> 💡 附带 `keepalive.py` 保活脚本：默认每 30 秒检查服务的 HTTP 响应，异常退出后自动重启。手动运行上述命令的方式保持可用。

### 方式三：开机自启（推荐重度用户）

需要 **Windows、Python 3.10+（包含 `py` 启动器和 `pythonw.exe`）以及 Node.js 18+**。无需安装 Python 包、npm 包或管理员权限。在项目根目录打开 PowerShell：

```powershell
py -3 --version
node --version

# 先在前台验证：启动桥服务和静态服务器，默认地址如下
py -3 keepalive.py run
# 浏览器打开 http://127.0.0.1:8899
# 在这个窗口按 Ctrl+C，安全停止保活程序及它启动的服务

# 安装当前用户的登录自启（安装本身不会启动服务）
py -3 keepalive.py install-startup
```

也可运行 `Startup\install.cmd`。安装器读取 Windows 的当前用户 Startup 文件夹，生成 `GradWorkbench-<项目标识>.vbs`，写入本次使用的 `pythonw.exe`、项目和配置文件的**绝对路径**。VBS 使用隐藏窗口运行，支持中文及带空格的路径。仓库中的 `Startup/grad-workbench.vbs.in` 是模板，请通过安装器生成，勿直接复制。重复安装覆盖同一项目的同名入口。

这是**用户登录后**启动；不是登录前运行的 Windows 服务。安装后可立即运行安装器输出的 VBS 文件测试，或重新登录 Windows。重复点击 VBS、重复执行 `run`，或使用不同配置再次启动同一项目，都只保留一个保活实例。可在另一个终端查看和停止：

```powershell
py -3 keepalive.py status       # 显示服务状态、端口、进程及启动次数
py -3 keepalive.py stop         # 等待安全退出；默认最多等 30 秒
py -3 keepalive.py stop --timeout 60

# 取消下次登录启动；也可运行 Startup\uninstall.cmd
py -3 keepalive.py uninstall-startup
# 卸载启动入口不会停止当前会话；需要时再执行 stop
```

#### 配置端口与运行参数

```powershell
Copy-Item keepalive.example.json keepalive.json
notepad keepalive.json
py -3 keepalive.py run

# 也支持项目目录之外的配置文件（相对路径以执行命令时的目录为准）
py -3 keepalive.py run --config "D:\我的配置\workbench.json"
py -3 keepalive.py install-startup --config "D:\我的配置\workbench.json"
```

未指定 `--config` 时，读取脚本所在目录的 `keepalive.json`；文件不存在则使用默认值。配置修改后执行 `stop`，再运行 VBS 或 `run`。`stop`、`status` 按项目定位实例，无需重复填写配置文件。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `bridge_port` | `5177` | 桥服务端口，1–65535 |
| `static_port` | `8899` | 网页端口，必须与桥端口不同 |
| `check_interval` | `30` | HTTP 健康检查间隔，秒 |
| `request_timeout` | `2` | 单次本地 HTTP 请求的超时，秒 |
| `startup_timeout` | `15` | 新进程的启动宽限时间，秒 |
| `failure_threshold` | `3` | 宽限结束后，连续检查失败几次才重启仍存活的子进程 |
| `restart_delay` | `1` | 故障后的首次重试等待，秒 |
| `max_restart_delay` | `60` | 指数退避的上限，秒；持续健康达到启动宽限时间后重置 |
| `shutdown_timeout` | `5` | 子进程优雅退出或终止的等待时间，秒 |
| `node` | `"node"` | Node 可执行文件名或绝对路径，如 `"C:/Program Files/nodejs/node.exe"` |

未知字段、无效数字和相同端口会报错，避免静默使用错误配置。新启动的桥通过 `WORKBENCH_BRIDGE_PORT` 获取端口。保活模式下，静态服务自动提供 `workbench-config.js`，网页的桥请求（包括数据恢复）使用配置后的端口，无需修改 `app.js`。更换网页端口后，直接访问 `http://127.0.0.1:<static_port>`；双击本地 HTML 的默认地址仍是 8899。

手动运行 `node bridge-server.js`、`python -m http.server 8899` 或 `npx serve -p 8899` 仍然可用。手动改桥端口时可先设置 `$env:WORKBENCH_BRIDGE_PORT = '5178'`，并修改 `workbench-config.js` 中的 `bridgePort`；自动保活会自行提供配置。浏览器的 localStorage 按网页来源区分，**更改网页端口前先导出备份**，新地址不会自动继承旧地址的数据。

#### 健康检查、恢复与退出规则

- 桥检查 `/health` 的服务标识、项目数据目录；静态服务检查 `/_workbench/health` 及 `index.html` 的实际内容。自有子进程还校验启动标识和进程号，避免把其他占用端口的服务认作自己的服务。
- 子进程异常退出在下一轮检查发现，按退避时间重启；HTTP 持续不健康时，先经过启动宽限和连续失败阈值，再重启。默认检查间隔为 30 秒，因此故障发现与恢复不是即时的。
- 已经手动运行、身份匹配且健康的服务可继续使用，状态为 `external`。普通手动静态服务器需要能通过 `/index.html` 提供本项目页面，且桥仍使用默认 5177；自定义桥端口请让保活程序启动静态服务。外部服务退出后保活可启动替代服务；仍占着端口但不健康的外部服务不会被强制终止。
- 无关程序占用端口时，状态为 `conflict`，保留该程序并记录日志，按退避时间继续重试；释放端口或修改配置后可恢复。不会按端口、进程名或旧 PID 批量杀进程。
- `stop` 和 Ctrl+C 会先停止保活循环，再尝试通过本地 HTTP 让自有子进程退出；超时后仅终止本实例持有进程句柄的子进程。手动启动的外部服务保留。若清理失败或未能确认退出结果，停止命令返回错误并提示查日志。网页中的桥操作在保活模式下显示为重启桥；**持续关闭请使用 `keepalive.py stop`**。
- 强制结束保活程序不属于安全退出：子进程可能仍运行。再次运行会通过系统锁和健康检查识别现状，避免重复启动；这些遗留服务按外部服务处理。正常停止请使用上面的停止命令。

#### 日志与排查

运行状态、带认证令牌的控制信息和日志位于 `%LOCALAPPDATA%\grad-workbench\<项目标识>\`，不放在静态网页目录中。`run` 会输出实际目录。`keepalive.log` 包含健康状态变化、启动失败、退出码、退避与子进程输出；单文件最大约 2 MiB，保留 3 个历史文件。控制端口仅监听 `127.0.0.1`，停止和查询必须带每次启动生成的令牌；停止命令不会对磁盘中的旧 PID 发送信号。系统文件锁在异常退出后自动释放，保留的 `instance.lock` 文件无需手动删除。

安装后未启动时，先在终端运行 `py -3 keepalive.py run` 查看错误。常见原因是 Node 未进入登录后的 PATH（在配置中填绝对路径）、Python/项目/配置目录被移动，或组织策略禁用了 Windows Script Host。移动项目或更换 Python 后，先从旧目录卸载启动入口，再在新目录安装。Startup 自启不提供保活程序自身崩溃后的守护；重新登录或重新运行 VBS 可启动它。

#### 离线自动化测试

```powershell
py -3 -m unittest discover -s tests -v
```

只需要本机 Python 3.10+、Node.js 18+，无需安装第三方包、登录账号、联网或准备用户数据。测试将源码复制到临时项目，使用合成网页、随机本地端口、独立状态目录和临时 Startup 目录。覆盖正常服务、真实 Node 桥、异常退出恢复、HTTP 不健康、端口冲突及释放后的恢复、重复启动、外部服务保护、带认证的安全停止，以及 Windows VBS 安装/启动/卸载。Windows 专用项在其他系统上自动跳过；测试不会修改真实用户 Startup 文件夹或仓库中的 `data/`。

## 🎨 定制属于你自己的版本

1. **改名字**：全局搜索「读研工作台」替换成你的标题
2. **改研究方向**：编辑 `bridge-server.js` 中 `analysis` prompt 里的研究领域描述
3. **加网站**：网站索引页点「＋ 添加」即可，支持拖拽排序
4. **配 API**：API 管理页各标签填入你自己的 Key / Cookie（只存本地）
5. **换词库**：`wordbooks/` 下按 JSON 格式添加自定义词库

## 📁 项目结构

```
grad-workbench/
├── index.html          # 主页面（单页应用）
├── style.css           # 全部样式
├── app.js              # 全部逻辑
├── bridge-server.js    # 可选：本地桥服务（Node）
├── keepalive.py        # 可选：服务保活脚本
├── keepalive.example.json # 保活配置示例（本地 keepalive.json 不入库）
├── workbench-config.js # 手动运行时的网页端口默认值
├── Startup/            # VBS 模板及自启安装/卸载入口
├── tests/              # 无第三方依赖的离线自动化测试
├── agent_runner.py     # 可选：AI Agent 运行器
├── assets/             # 图标资源
└── wordbooks/          # 英语词库（JSON）
```

## 🛠️ 技术栈

- **前端**：原生 HTML / CSS / JavaScript，零依赖、零构建
- **存储**：localStorage（纯本地，隐私友好）
- **桥服务**：Node.js（无第三方包依赖）
- **AI 能力**：OpenAI 兼容 API（可接 DeepSeek / SenseNova / GLM 等）

## 📋 设计原则

- **数据主权**：所有数据存你自己的浏览器，卸载即清空，无云端依赖
- **隐私优先**：密钥不出内网，API 请求直连官方或经本地桥代理
- **开箱即用**：不需要数据库、不需要 Docker、不需要构建工具
- **渐进增强**：不开桥服务也有完整体验，开了更强

## ⚠️ 已知限制

- localStorage 容量上限约 5MB（文献 PDF 建议放本地目录，工作台只存路径和元数据）
- 浏览器清理缓存会丢数据——请定期用「💾 数据备份」导出
- API 额度监控需要各平台的登录 Cookie，过期后需重新粘贴

## 📄 License

MIT — 自由使用、修改、分发。

## 相关

选 Token Plan / Coding Plan / Agent 订阅时，可用 [PlanLens](https://planlens.cn) 对比官方价格，推送限时福利。
