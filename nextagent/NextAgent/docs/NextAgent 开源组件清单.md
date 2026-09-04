# NextAgent 开源组件清单

## 范围

本文档记录当前仓库当前主动声明的开源组件，覆盖以下范围：

- 后端 Workspace 依赖
- 前端 `frontend/agent-web` 依赖
- 前端 Mock 服务 `frontend/agent-web-mock-server` 依赖

说明：

- 仅统计各 `package.json` 中 `dependencies` / `devDependencies` 主动声明的直接依赖
- 不展开 `package-lock.json` 中的传递依赖
- 不包含被动依赖进入的传递依赖
- 测试组件与 Mock 组件单独列出，便于和主产品依赖区分

## 后端 Workspace

### 运行时依赖

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `@opentelemetry/api` | `1.9.1` | 根 workspace、`packages/agent-observability` | 为可观测性接入预留的 OpenTelemetry API 依赖 |
| `@opentelemetry/resources` | `2.9.0` | `packages/agent-observability` | 构造只包含 service name/version/deployment mode 的 OTel Resource |
| `@opentelemetry/sdk-metrics` | `2.9.0` | `packages/agent-observability` | 提供 MeterProvider、PeriodicExportingMetricReader、聚合和 exporter lifecycle |
| `@opentelemetry/exporter-metrics-otlp-proto` | `0.220.0` | `packages/agent-remote-deployment` | REMOTE/PaaS entrypoint 的 official OTLP HTTP/protobuf metrics exporter |
| `pino` | `10.3.1` | `packages/agent-log` | operational log 的结构化 envelope、level 与异步 destination 组合 |
| `pino-roll` | `4.0.0` | `packages/agent-local-file-roll` | Node-only technical foundation 内的 size/daily rolling destination |
| `sonic-boom` | `4.2.1` | `packages/agent-local-file-roll` | 三个独立本地文件 owner 共用机制中的异步有界写入 primitive |
| `@sinclair/typebox` | `0.34.49` | 根 workspace、`agent-app`、`agent-app-frontend-hosting`、`agent-channel-web`、`agent-contracts` | 定义运行时 schema、契约 schema、DTO schema、配置 schema |
| `ajv` | `8.18.0` | 根 workspace、`agent-app`、`agent-capability`、`agent-core` | 执行 JSON Schema 校验 |
| `fastify` | `5.10.0` | 根 workspace、`agent-app-frontend-hosting`、`agent-channel-web`、`agent-channel-web-auth-local` | 后端 HTTP Server、Web transport、前端托管 |
| `ai` | `6.0.221` | `packages/agent-model` | 统一模型调用、流式输出、tool-call 处理 |
| `@openrouter/ai-sdk-provider` | `2.10.0` | `packages/agent-model` | OpenRouter provider 适配层 |
| `picomatch` | `4.0.5` | `packages/agent-capability` | 文件模式匹配、glob/filter 能力 |

### 构建与测试依赖

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `@types/node` | `^24.10.1` | 根 workspace | Node.js 类型定义 |
| `typescript` | `^5.9.3` | 根 workspace | TypeScript 编译与类型检查 |
| `@types/picomatch` | `^4.0.2` | `packages/agent-capability` | 为 `picomatch` 提供独立 TypeScript 类型声明；当前 `picomatch` 包未自带 `.d.ts`，因此需单独保留为构建类型依赖 |

## 前端 `frontend/agent-web`

### 产品运行时依赖

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `react` | `19.2.4` | `frontend/agent-web` | 前端 UI 基础框架 |
| `react-dom` | `19.2.4` | `frontend/agent-web` | React DOM 渲染 |
| `react-router-dom` | `6.30.3` | `frontend/agent-web` | 前端路由 |
| `zustand` | `4.5.7` | `frontend/agent-web` | 前端状态管理 |
| `antd` | `5.29.3` | `frontend/agent-web` | UI 组件库 |
| `@ant-design/icons` | `5.5.2` | `frontend/agent-web` | Ant Design 图标库 |
| `@ant-design/v5-patch-for-react-19` | `1.0.3` | `frontend/agent-web` | React 19 与 Ant Design v5 兼容补丁 |
| `@antv/g6` | `4.8.21` | `frontend/agent-web` | 流程图 / 运行图可视化 |
| `i18next` | `^25.10.10` | `frontend/agent-web` | 国际化核心能力 |
| `react-i18next` | `^15.7.4` | `frontend/agent-web` | React i18n 绑定 |
| `marked` | `15.0.7` | `frontend/agent-web` | Markdown 渲染 |
| `mermaid` | `11.15.0` | `frontend/agent-web` | Mermaid 图表渲染 |
| `xss` | `1.0.15` | `frontend/agent-web` | HTML 内容净化，降低 XSS 风险 |

### 构建与测试依赖

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `@types/node` | `^24.10.1` | `frontend/agent-web` | Node.js 类型定义 |
| `@types/react` | `19.2.2` | `frontend/agent-web` | React 类型定义 |
| `@types/react-dom` | `19.2.2` | `frontend/agent-web` | React DOM 类型定义 |
| `typescript` | `^5.9.3` | `frontend/agent-web` | 前端 TypeScript 编译与类型检查 |
| `vite` | `^5.4.21` | `frontend/agent-web` | 前端开发服务器与构建工具 |
| `vitest` | `2.1.9` | `frontend/agent-web` | 前端单元测试运行器 |

## 构建与测试组件

### 后端与 Workspace 构建 / 测试 / 治理工具

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `vitest` | `^4.0.14` | 根 workspace | 后端测试运行器 |
| `dependency-cruiser` | `^17.3.1` | 根 workspace | 架构边界与依赖方向检查 |
| `@types/json-schema` | `^7.0.15` | 根 workspace | 面向 schema 测试与工具的类型支持 |

### 前端构建 / 测试工具

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `@playwright/test` | `1.52.0` | `frontend/agent-web` | Playwright E2E 测试框架 |
| `playwright` | `1.52.0` | `frontend/agent-web` | Playwright 浏览器运行时与 CLI |
| `@testing-library/react` | `^16.3.2` | `frontend/agent-web` | React 组件测试工具 |
| `@testing-library/user-event` | `^14.6.1` | `frontend/agent-web` | 用户交互模拟 |
| `jsdom` | `^29.0.2` | `frontend/agent-web` | 前端单测 DOM 环境 |

## Mock 组件

### 前端 Mock 服务 `frontend/agent-web-mock-server`

| 组件 | 版本 | 模块 | 用途 |
| --- | --- | --- | --- |
| `express` | `^4.18.2` | `frontend/agent-web-mock-server` | 本地 Mock HTTP 服务 |
| `cors` | `^2.8.5` | `frontend/agent-web-mock-server` | 处理跨域请求 |
| `ws` | `^8.14.2` | `frontend/agent-web-mock-server` | 本地 Mock WebSocket 服务 |

## 备注

- 本清单仅统计当前主动声明的直接依赖，不包含锁文件里的传递依赖
- 当前前后端仍使用不同主版本的 `vitest`
  - 后端 Workspace：`^4.0.14`
  - 前端 `agent-web`：`2.1.9`
- `@opentelemetry/api` 仍保留在直接依赖中，如需继续收敛，应单独评估
