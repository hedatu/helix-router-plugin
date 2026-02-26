<div align="center">

# Helix Router Plugin

**中文｜English**

OpenClaw 智能路由插件：先做复杂度评估，再将请求路由到 PRO / MID / LOW 模型。

</div>

---

## 中文说明

### ✨ 功能特性

- 两阶段路由：复杂度评估 + 模型路由
- 三档 Provider：`pro` / `mid` / `low`
- 可配置阈值：`proThreshold`、`midThreshold`
- 提供健康检查与统计接口

### 📦 目录结构

- `src/`：TypeScript 源码
- `cli.ts`：CLI 入口
- `openclaw.plugin.json`：插件声明与配置 Schema
- `helix-router.js`：兼容启动脚本

### 🚀 快速开始

```bash
npm install
npm run build
node dist/index.js
```

开发模式：

```bash
npm run dev
```

### ⚙️ 环境变量

```env
HELIX_PRO_URL=http://127.0.0.1:8310/v1
HELIX_PRO_KEY=...
HELIX_PRO_MODEL=...

HELIX_MID_URL=http://127.0.0.1:8310/v1
HELIX_MID_KEY=...
HELIX_MID_MODEL=...

HELIX_LOW_URL=http://127.0.0.1:8310/v1
HELIX_LOW_KEY=...
HELIX_LOW_MODEL=...

HELIX_PRO_THRESHOLD=75
HELIX_MID_THRESHOLD=35
HELIX_PORT=8403
```

### 🔌 API

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /health`
- `GET /stats`

### 🔐 安全建议

- 所有密钥仅通过环境变量注入
- 不要提交真实 API Key

---

## English

### ✨ Features

- Two-stage routing: complexity evaluation + target model routing
- Three provider tiers: `pro`, `mid`, `low`
- Threshold-based routing (`proThreshold`, `midThreshold`)
- Health and statistics endpoints included

### 📦 Project Structure

- `src/`: TypeScript source code
- `cli.ts`: CLI entry point
- `openclaw.plugin.json`: plugin manifest and config schema
- `helix-router.js`: compatibility launcher

### 🚀 Quick Start

```bash
npm install
npm run build
node dist/index.js
```

Dev mode:

```bash
npm run dev
```

### ⚙️ Environment Variables

```env
HELIX_PRO_URL=http://127.0.0.1:8310/v1
HELIX_PRO_KEY=...
HELIX_PRO_MODEL=...

HELIX_MID_URL=http://127.0.0.1:8310/v1
HELIX_MID_KEY=...
HELIX_MID_MODEL=...

HELIX_LOW_URL=http://127.0.0.1:8310/v1
HELIX_LOW_KEY=...
HELIX_LOW_MODEL=...

HELIX_PRO_THRESHOLD=75
HELIX_MID_THRESHOLD=35
HELIX_PORT=8403
```

### 🔌 API

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /health`
- `GET /stats`

### 🔐 Security Notes

- Inject secrets via environment variables only
- Never commit real API keys

---

## License

MIT