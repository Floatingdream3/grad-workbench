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

> 💡 附带 `keepalive.py` 保活脚本：每 30 秒自动检测两个端口，服务挂了自动重启。

### Agent 功能配置（Hermes）

Agent 对话、文献深度分析和自动文献导入需要本机 Hermes。复制 `hermes.config.example.json` 为 `hermes.local.json`，填写 `HERMES_HOME`（Hermes 工作目录）和 `HERMES_PYTHON`（其 Python 解释器完整路径），再启动桥服务。也支持同名环境变量，优先于本地文件；启动前会检查目录和运行文件，并明确提示配置或启动错误。

详见 [Windows 配置教程、故障排查与离线测试](docs/hermes-windows.md)。本地配置文件不入库，教程和测试不需要真实 API 密钥。

### 方式三：开机自启（推荐重度用户）

Windows 下把 `Startup` 目录里的 VBS 指向 `keepalive.py` 即可实现静默自启。

## 🎨 定制属于你自己的版本

1. **改名字**：全局搜索「读研工作台」替换成你的标题
2. **改研究方向**：编辑 `agent_runner.py` 中 `SCENES['analysis']` 的研究方向描述
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
├── agent_runner.py     # 可选：AI Agent 运行器
├── hermes-config.js    # 桥服务的 Hermes 配置解析与检查
├── hermes_config.py    # Python 运行器使用相同配置规则
├── agent-process.js    # Agent 子进程与超时处理
├── hermes.config.example.json # 本机配置示例
├── docs/hermes-windows.md     # Windows 配置与离线测试教程
├── tests/              # 不依赖真实 Hermes 的 Node/Python 测试
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
