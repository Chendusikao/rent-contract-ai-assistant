# 🏠 租房避坑助手 - AI 租房合同智能分析

上传租房合同，AI 自动揪出风险条款、给出风险评分和谈判话术。专为第一次租房的大学生设计。

## ✨ 核心特性

- 📄 **智能合同解析** - 支持 PDF / Word / 图片上传（含 OCR 中文识别）
- 📷 **手机拍照上传** - 移动端一键拍照识别，扫码即用（PWA 支持）
- 🤖 **AI 风险分析** - LangGraph 状态机编排，输出结构化风险报告（评分 / 风险等级 / 问题条款）
- 🔍 **语义检索追问** - 本地 BGE 向量模型 + sqlite-vec 向量库，追问精准命中合同条款
- ⚖️ **民法典知识库** - 内置租房相关法律依据，回答引用具体法条
- 🗣️ **语音交互** - 语音提问（ASR）+ 回答朗读（TTS）
- 🎛️ **应用内配置** - 无需改文件，网页内填写 DeepSeek API Key 验证即用

## 🛠️ 技术栈

| 层 | 技术 |
|----|------|
| **AI 编排** | LangChain + LangGraph（StateGraph 状态机 + 工具调用） |
| **LLM** | DeepSeek（OpenAI 兼容接口，支持 V3 / R1） |
| **RAG** | 本地 BGE-small-zh embedding + sqlite-vec 向量检索 |
| **OCR** | tesseract.js 中文识别 |
| **语音** | Web Speech API（ASR / TTS） |
| **后端** | Node.js + Express + TypeScript + SSE |
| **前端** | React 18 + Vite + TDesign + PWA |
| **数据库** | SQLite（better-sqlite3） |

## 🤖 一键部署（直接发给你的 AI Agent）

把这个项目部署起来，最简单的方式：把下面整段指令发给你的 AI Agent（WorkBuddy / Cursor / Claude Code 等），它会自动完成克隆、装依赖、启动。

> 前提：电脑已安装 **Node.js 18+**，并准备一个 **DeepSeek API Key**（[免费获取](https://platform.deepseek.com/api_keys)，费用自理）。

```
请帮我部署这个项目：
1. git clone https://github.com/Chendusikao/rent-contract-ai-assistant
2. cd rent-contract-ai-assistant && npm install
3. npm run dev
4. 打开 http://localhost:5173，在"设置"页填入我的 DeepSeek API Key 并点"验证并保存"
5. 首次启动会自动下载向量模型（约 90MB）和 OCR 语言包，等待完成即可使用
```

> 没有 AI Agent？按下方 [快速开始](#-快速开始下载后-5-步上手) 手动操作，步骤完全一样。

## 🚀 快速开始（下载后 5 步上手）

> 环境要求：**Node.js 18+**（推荐 20+）、npm。其他自动安装，无需手动配置。

### 1. 安装依赖

```bash
npm install
```

### 2. 配置 API Key（二选一）

**方式 A：网页内配置（推荐，无需碰文件）**

直接启动（跳到第 3 步），然后打开浏览器 → 左上角菜单 → **设置** → 粘贴你的 DeepSeek API Key → 点"**验证并保存**"，验证通过立即生效。

**方式 B：环境变量（部署场景）**

```bash
cp .env.example .env
```

编辑 `.env`，填入你的 DeepSeek API Key（获取地址: https://platform.deepseek.com/api_keys）：

```env
DEEPSEEK_API_KEY=sk-xxxx
```

### 3. 启动开发服务器

```bash
npm run dev
```

启动后两个服务同时运行：
- **前端**（操作界面）: http://localhost:5173
- **后端**（API 服务）: http://localhost:3001

> 浏览器打开 **http://localhost:5173** 即可使用。

### 4. 首次启动自动下载模型（约 1-2 分钟）

- **向量模型（约 90MB）**：从 HuggingFace 下载，缓存到 `data/models/`，之后永久离线
  - 若下载慢/失败：开启你的代理软件（默认自动检测 `127.0.0.1:7890`），或在 `.env` 设置 `EMBEDDING_PROXY=http://你的代理地址`
- **OCR 语言包**：首次上传图片时自动从 CDN 下载（几 MB），用于拍照/图片合同识别
- 模型只在**第一次**下载，之后秒开

### 5. 开始使用

1. 首页点上传区域，选择合同的 **PDF / Word / 图片**（手机端可直接拍照）
2. 等待 AI 分析（约 30 秒），生成风险评分 + 问题条款 + 谈判话术
3. 底部"还想了解哪一条？"可以继续追问，AI 会基于语义检索精准回答

### 手机访问

手机与电脑连同一 WiFi，手机浏览器访问 `http://<电脑IP>:5173`（如 `http://192.168.18.68:5173`），支持拍照上传、语音提问。也可通过浏览器菜单"添加到主屏幕"获得 App 体验（PWA）。

## 📦 生产部署

```bash
npm run build      # 构建前端到 dist/
npm run server     # 后端自动托管 dist 静态文件 + API
```

访问 http://localhost:3001 即可。

## 🗂️ 项目结构

```
├── server/                    # 后端
│   ├── index.ts              # Express 服务器 + API
│   ├── agent/
│   │   └── contract-agent.ts # LangGraph 合同分析 Agent（状态机）
│   ├── rag/
│   │   ├── embedder.ts       # 本地 BGE 向量模型
│   │   └── vector-store.ts   # sqlite-vec 向量库 + 检索
│   ├── settings.ts           # 运行时配置（网页保存的 API Key）
│   ├── contract-parser.ts    # 文档解析 + OCR
│   ├── contract-analysis.ts  # 分析提示词 + 结果解析
│   ├── deepseek.ts           # DeepSeek API 封装
│   └── db.ts                 # SQLite 操作
├── src/                      # 前端
│   ├── pages/
│   │   ├── ContractPage.tsx  # 上传 + 报告 + 追问
│   │   └── AdminPage.tsx     # 分析记录
│   ├── components/           # 组件（含 MarkdownLite 渲染）
│   └── hooks/                # useIsMobile / useTheme
└── public/                   # PWA manifest + 图标
```

## 📡 API 端点

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/contracts/analyze` | POST | 分析合同（SSE 流式，返回结构化报告） |
| `/api/contracts/upload` | POST | 上传合同文件（PDF/Word/图片） |
| `/api/contracts/:id/follow-up` | POST | 追问（LangGraph Agent + RAG 检索） |
| `/api/contracts` | GET | 历史记录列表 |
| `/api/deepseek-status` | GET | API 连接状态 |
| `/api/save-deepseek-config` | POST | 验证并保存 API Key |
| `/api/health` | GET | 健康检查 |

## ⚠️ 安全说明

- `.env` 和 `data/settings.json` 已加入 `.gitignore`，**绝不会被提交到仓库**
- 分发项目时删除本地 `.env`，别人通过网页设置页配置自己的 Key
- 分析结果由 AI 生成仅供参考，重大决策请咨询专业律师

## 📄 License

MIT
