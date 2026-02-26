# Helix Router Plugin

OpenClaw 的智能路由插件：先做复杂度判断，再把请求路由到 PRO / MID / LOW 模型。

## 功能

- 两阶段路由：复杂度评估 + 目标模型路由
- 支持三档 provider：`pro` / `mid` / `low`
- 支持阈值配置（`proThreshold`、`midThreshold`）
- 提供健康检查与统计接口

## 目录结构

- `src/`：TypeScript 源码
- `cli.ts`：CLI 入口
- `openclaw.plugin.json`：OpenClaw 插件声明与配置 Schema
- `helix-router.js`：兼容启动脚本

## 环境要求

- Node.js 18+
- TypeScript 构建工具（项目内已定义）

## 安装与构建

```bash
npm install
npm run build
```

## 运行

开发模式：

```bash
npm run dev
```

构建后运行（按你的接入方式）：

```bash
node dist/index.js
```

或使用项目内启动脚本：

```bash
./start.sh
```

## 配置（环境变量）

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

> 本仓库已移除硬编码密钥；请仅通过环境变量注入。

## API

- `POST /v1/chat/completions`
- `GET /v1/models`
- `GET /health`
- `GET /stats`

## 安全说明

- 不要提交任何真实 API Key
- 使用 `.env`（并确保被 `.gitignore` 忽略）

## License

MIT
