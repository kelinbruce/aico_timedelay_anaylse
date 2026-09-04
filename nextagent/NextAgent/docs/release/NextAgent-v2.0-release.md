# NextAgent v2.0 Release Doc

**发布日期**: 2026-07-02  
**基线**: 当前仓库 `HEAD`（当前已对齐 tag `v2.0`）  
**文档目标**: 面向发布、交付、集成和二次开发，汇总当前代码已落地的核心特性、核心能力、`agent-web` API、开源组件清单和构建指导。  
**版本说明**: 本文档的发布版本标识为 `v2.0`；当前仓库内各 workspace npm 包版本仍以 `0.1.0` / `0.1.0-SNAPSHOT` 维护。

## 1. 产品定位

NextAgent 是面向电信网络智能体的 TypeScript 后端框架，目标是为网络运维诊断、知识检索、会话协同、受控工具调用、长期记忆和发布打包提供一条可治理、可验证、可交付的主路径。当前代码基线强调以下原则：

- 电信级质量：安全、可靠、可恢复、可审计、可诊断、可维护、可测试。
- 规格优先：稳定行为以 `openspec/specs/` 和 `openspec/designs/` 为准。
- 架构分层：`agent-app` 作为唯一 composition root，runtime、channel、core、context、model、capability、gateway、memory、observability 分层清晰。
- 双 scope 隔离：主路径同时执行 Agent Scope 与 Owner Scope 校验。

## 2. 核心特性

### 2.1 最小可用智能体主链路与流式一致性

- 已具备完整的会话创建、请求提交、流式响应、历史回看、终态提交和错误安全收口能力。
- 已具备同 session lane 调度、请求取消、请求重试、请求编辑重提、stream resume/replay、stream/history consistency。
- 当前稳定基线已明确支持无游标 `session live-tail`，并区分 no-cursor live-tail、显式 `lastSeenSequence=0` replay、以及 `requestId/runId` scoped bounded replay。
- 已具备 accepted run 固化 `agentId` / `agentVersion` / `agentAssemblyRef` 的运行时约束。

### 2.2 Web 通道与本地交互

- `agent-channel-web` 提供 Fastify 路由、SSE 和 WebSocket 等价流式投影。
- 已提供 runtime bootstrap、会话列表、会话对话、请求命令、分享、收藏、标注、技能列表、建议问题等接口。
- 已支持 local configured auth 模式与本地登录态 Cookie。
- 当前前端/通道基线已收敛普通会话打开与刷新路径：历史视图由 `conversation` 建立，实时增量由 live-tail stream 承担，普通 terminal 后不再用 conversation snapshot 覆盖 live stream details。

### 2.3 统一 Capability 框架

- Tool、Skill、Agent 三类能力统一纳入 `agent-capability` 生命周期与 catalog governance。
- 支持 builtin source、local directory source、agent-owned source、skillhub source、API-backed tool source。
- 已支持 capability input schema validation、conflict resolution、invocation audit、idempotency contract 与安全降级。

### 2.4 受控工具调用与执行安全

- 已支持内置 `read`、`write`、`edit`、`glob`、`grep`、`bash`、`python`、`rag`、`ToolSearch`、`AskUserQuestion`、`Skill`、`Agent` 等能力。
- 动态执行路径通过 sandbox gateway 边界隔离，遵循 deny-by-default 安全兜底。
- 已具备 repeated capability failure guard，避免同一失败在单次 run 内无限重试。
- 已支持同轮并行工具调用。

### 2.5 Prompt / Context / Model 主链路

- `agent-context-engine` 负责 context assembly、prompt template selection、window selection 与 compaction。
- 已支持 purpose-aware prompt template assembly，内置 system prompt 双语电信输出约束。
- `agent-model` 已隔离 provider SDK、流式归一化、tool-use normalization 与 safe error mapping。
- 当前配置已支持模型 profile、provider base URL、context window、fallbackEligible 等模型治理字段。

### 2.6 RAG 与长期记忆

- 已具备 `rag` 检索工具和本地知识索引治理边界，支持 workspace-scoped local retrieval。
- 已具备长期记忆核心 persistence contract、memory tools、task trajectory 学习输入层、记忆提取和 aging 生命周期边界。
- 当前默认系统配置中 memory 已启用，包含 search、extraction、aging 三组参数。
- large content 基线已按真实容量分级收敛：tool result 默认采用更高 inline / aggregate 阈值，支持 `Read` 等 Infinity tool 不外置，并显式保留 frozen replay 以保护 prompt cache 命中。

### 2.7 会话协作与运营能力

- 已具备 conversation annotation，支持点赞、点踩、收藏和评论。
- 已具备 favorites 列表。
- 已具备 conversation share 受控只读分享。
- 已具备 suggested questions 推荐问题生成入口。

### 2.8 可观测与风险治理

- 已具备 structured logging、runtime logging、trace/log linking、runtime metrics、health surfaces 和统一 observation handoff。
- 已具备 risk policy enforcement 和统一 pending input 人机交互边界。
- 日志、metric、trace、audit 默认执行安全脱敏，不暴露 prompt、原始模型输出、凭据和高基数字段。

### 2.9 本地运行包与发布资格

- 已支持 `backend-only`、`with-frontend`、`frontend-only` 三种本地运行包 profile。
- 已支持 local runtime package 组装、压缩归档、config sample 生成和 release qualification。
- 已具备 release package、product journey、contract、architecture 等发布门禁脚本入口。

### 2.10 工作流与测试资产

- 已存在独立 `agent-workflow` package，承载 workflow engine / nodes 的最小边界。
- 已提供 `agent-test-kit` 包和 E2E / contract / architecture / release-package 等测试门禁。
- 当前仓库测试资产覆盖 runtime、capability、channel、memory、workflow、架构边界和发布门禁。
- 发布级 E2E 门禁已扩展到 `P1/P2 scenario gate`，覆盖 conversation share、human pending input、long-term memory、workflow routing、child agent routing、extension governance 等真实边界场景。

## 3. 当前代码中的核心能力

### 3.1 平台级能力类型

| 类型 | 当前基线 |
| --- | --- |
| Tool | 内置工具、memory tools、ToolSearch、AskUserQuestion、RAG、Agent tool、Skill tool |
| Skill | builtin skills、local directory skills、agent-owned skills、skillhub skills |
| Agent | builtin agent、top-level local agent、agent package 下的 subagent |

### 3.2 当前内置 Tool 能力

| Tool | 用途 |
| --- | --- |
| `read` | 受控读取 workspace / execution 文件，支持分页读取 |
| `write` | 受控创建或覆盖写入授权目录内文件 |
| `edit` | 受控文本编辑 |
| `glob` | 文件匹配与枚举 |
| `grep` | 文本搜索 |
| `bash` | 受治理 shell 执行，经过 sandbox / policy 边界 |
| `python` | 受治理 Python 执行，经过 sandbox / policy 边界 |
| `rag` | 本地知识检索 |
| `ToolSearch` | request-local deferred capability 激活与检索 |
| `AskUserQuestion` | 统一 pending input 人机交互入口 |
| `Skill` | 通过治理后的 Skill 能力执行具体 Skill |
| `Agent` | 通过治理后的 AGENT descriptor 执行 subagent |

### 3.3 当前记忆相关 Tool 能力

当前打包默认 Agent 已绑定以下 memory tools：

| Tool | 用途 |
| --- | --- |
| `search_memory` | 检索长期记忆 |
| `get_memory_detail` | 查看记忆详情 |
| `add_memory` | 人工新增长期记忆 |

### 3.4 当前默认 Agent 装配

当前本地运行包中的默认 Agent 为 `default-agent`，定位为电信网络运维 Agent，默认绑定：

| 能力 ID | 类型 | provider | 状态 |
| --- | --- | --- | --- |
| `network-explorer` | `AGENT` | `builtin-agents` | enabled |
| `search_memory` | `TOOL` | `memory-tools` | enabled |
| `get_memory_detail` | `TOOL` | `memory-tools` | enabled |
| `add_memory` | `TOOL` | `memory-tools` | enabled |

## 4. agent-web API 清单

当前 `agent-web` 使用或可直接消费的 API 已覆盖以下能力面：

| 分类 | 主要接口 |
| --- | --- |
| Runtime / Auth / Health | `GET /api/v1/runtime/bootstrap`、`POST /api/v1/auth/local/login`、`POST /api/v1/auth/local/logout`、`GET /health`、`GET /health/deep` |
| Session | `GET /api/v1/sessions`、`POST /api/v1/sessions`、`PUT /api/v1/sessions/{sessionId}/title`、`DELETE /api/v1/sessions/{sessionId}` |
| Conversation | `GET /api/v1/sessions/{sessionId}/conversation`、`GET /api/v1/sessions/{sessionId}/conversation/preview` |
| Request Command | `POST /api/v1/sessions/{sessionId}/requests`、`POST /api/v1/sessions/{sessionId}/cancel`、`POST /api/v1/sessions/{sessionId}/retry`、`POST /api/v1/sessions/{sessionId}/requests/latest/edit`、`POST /api/v1/sessions/{sessionId}/pending-inputs/{pendingInputId}/answer`、`POST /api/v1/requests` |
| Stream | `GET /api/v1/sessions/{sessionId}/stream`、`WebSocket /api/v1/sessions/{sessionId}/ws` |
| Annotation / Favorite | `POST /api/v1/sessions/{sessionId}/runs/{runId}/annotations`、`GET /api/v1/sessions/{sessionId}/annotations`、`GET /api/v1/favorites` |
| Share | `POST /api/v1/sessions/{sessionId}/shares`、`GET /api/v1/shares/{shareId}/conversation` |
| Skill / Suggested Questions | `GET /api/v1/skills`、`POST /api/v1/sessions/{sessionId}/requests/{requestId}/suggested-questions` |

详细字段、请求示例、响应结构见：

- [docs/apis/agent-web-api-list.md](../apis/agent-web-api-list.md)

## 5. 开源组件清单

当前仓库已显式声明的主要开源组件可分为四组：

| 组件组 | 代表组件 | 用途 |
| --- | --- | --- |
| 后端运行时 | `fastify`、`ajv`、`@sinclair/typebox`、`ai`、`@openrouter/ai-sdk-provider`、`@opentelemetry/api` | HTTP 服务、schema 校验、模型调用、可观测接入 |
| 后端构建测试 | `typescript`、`vitest`、`dependency-cruiser` | 编译、测试、架构门禁 |
| 前端运行时 | `react`、`react-dom`、`antd`、`zustand`、`react-router-dom`、`mermaid`、`marked`、`xss`、`@antv/g6` | `agent-web` UI、状态、图表、内容渲染 |
| 前端测试与 Mock | `vite`、`playwright`、`@testing-library/react`、`express`、`ws` | 前端构建、E2E、mock server |

完整直接依赖、版本号、归属模块和用途见：

- [docs/NextAgent 开源组件清单.md](../NextAgent%20%E5%BC%80%E6%BA%90%E7%BB%84%E4%BB%B6%E6%B8%85%E5%8D%95.md)

## 6. 构建指导

### 6.1 环境要求

| 项 | 要求 |
| --- | --- |
| Node.js | `>=22.0.0` |
| npm | 与 Node.js LTS 配套版本 |
| 操作系统 | 当前本地运行包已支持 `win32-x64` 和 `linux-x64` |

### 6.2 依赖安装

```bash
npm install
```

如需前端构建与本地全栈打包，也需要安装：

```bash
cd frontend/agent-web
npm install
cd ../..
```

### 6.3 日常验证命令

```bash
npm run build
npm test
npm run test:contract
npm run lint:architecture
openspec validate --all --strict
```

说明：

- `npm run build` 为根级构建准备脚本。
- workspace 全量编译在打包阶段会通过 `npm --workspaces run build` 自动执行。
- `npm run lint` 会串联 `lint:architecture` 与 `lint:openspec`。

### 6.4 前端开发与构建

```bash
cd frontend/agent-web
npm run dev
npm run test
npm run build
npm run build:vite
```

常用扩展命令：

```bash
npm run build:vite:modes
npm run test:e2e
```

### 6.5 本地运行包构建

根目录提供以下打包命令：

```bash
npm run pack:release
npm run pack:backend
npm run pack:front
```

对应 profile：

| 命令 | profile | 说明 |
| --- | --- | --- |
| `npm run pack:release` | `with-frontend` | 打包后端和前端产物 |
| `npm run pack:backend` | `backend-only` | 仅打包后端运行时 |
| `npm run pack:front` | `frontend-only` | 仅打包前端产物 |

打包过程会执行以下关键步骤：

- 重建 workspace dist
- `with-frontend` 模式下重建 `agent-web` 产物并组装 `@nextagent/agent-web` artifact
- 校验 release E2E gate
- 生成 `default-system.yaml` 样例与 package archive

### 6.6 Release Qualification

发布资格校验命令：

```bash
npm run release:qualify -- --candidate <candidate-root> --scope <scope-file>
```

当前 release qualification 结果包含：

- `QUALIFIED`
- `QUALIFIED_WITH_DECLARED_DEGRADATIONS`
- `BLOCKED`

校验维度覆盖：

- contract
- architecture
- security
- resilience
- p1-p2-scenario-gate
- release-package
- product-journey
- capacity
- health proof
- smoke result

### 6.7 推荐发布门禁

建议在对外交付或正式发布前至少完成：

```bash
npm test
npm run test:contract
npm run lint
openspec validate --all --strict
npm run test:e2e:release
npm run pack:release
```

其中当前 `npm run test:e2e:release` 已串联：

- `npm run test:e2e:product-journey`
- security / resilience release config tests
- `npm run test:e2e:p1-p2-scenario-gate`
- `npm run test:e2e:release-package`

## 7. 关键代码与文档入口

| 主题 | 路径 |
| --- | --- |
| 规格概览 | `openspec/overview.md` |
| 稳定规格 | `openspec/specs/` |
| 稳定设计 | `openspec/designs/` |
| API 清单 | `docs/apis/agent-web-api-list.md` |
| 开源组件清单 | `docs/NextAgent 开源组件清单.md` |
| 发布文档目录 | `docs/release/` |
| 默认系统配置 | `packages/agent-app/config/default-system.yaml` |
| 默认 Agent 配置 | `packages/agent-core/src/builtin-agents/default-agent/agent.yaml` |
| 打包脚本 | `scripts/pack-local-runtime.mjs` |
| 发布资格脚本 | `scripts/release-qualify.mjs` |

## 8. 总结

基于当前代码，NextAgent `v2.0` 已形成一条完整的本地可运行、可治理、可测试、可打包的电信智能体主路径。它不仅具备最小问答内核，还已经覆盖受控工具调用、RAG、长期记忆、会话运营、Web 交互、风险治理、发布打包和资格校验等核心能力，可作为本地产品化验证、行业能力集成和后续多 Agent / 远端化演进的稳定基础。
