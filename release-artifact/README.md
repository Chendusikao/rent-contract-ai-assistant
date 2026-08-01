# 租房避坑助手 - 前端构建产物 v1.0.0

这是前端生产构建产物（dist 目录），需要配合后端服务使用。

## 部署方式

### 方式一：单进程部署（推荐，最简单）

```bash
# 1. 克隆完整项目（含后端）
git clone https://github.com/Chendusikao/rent-contract-ai-assistant
cd rent-contract-ai-assistant
npm install

# 2. 用本构建产物替换项目内 dist 目录
# （或者直接 npm run build 重新构建）

# 3. 配置 API Key 并启动
cp .env.example .env
npm run server
```

### 方式二：纯静态托管（需要单独部署后端 API）

将本目录所有文件部署到任意静态托管（Nginx/CDN/对象存储），
并在构建时设置后端地址 `VITE_API_BASE_URL=https://your-api-domain`。

## 内容

- index.html - 入口页
- assets/ - 打包后的 JS/CSS
- manifest.webmanifest - PWA 配置
- icons/ - PWA 图标

## 安全说明

⚠️ 本产物不包含任何 API Key。后端需自行配置 DeepSeek API Key。
