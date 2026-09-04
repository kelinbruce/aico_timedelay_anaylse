---
sources:
  - openspec/designs/modules/
  - dependency-cruiser.config.cjs
  - docs/developer/02-architecture.md
last-verified: 2026-09-01
---

# 架构图：包职责、分层与依赖方向

→ 边界不变量详见 [package-ownership.md](package-ownership.md)
→ 数据流路径详见 [data-flow-atlas.md](data-flow-atlas.md)
→ "X 应该放在哪" 详见 [decision-trees.md](decision-trees.md)

## 四层架构模型

```
┌──────────────────────────────────────────────────────────┐
│  Entry Adapter Layer                                     │
│  agent-channel-web  agent-channel-task  agent-channel-common │
│  (HTTP/SSE/WS)      (HTTP/SSE/Callback)                   │
└──────────────────────┬───────────────────────────────────┘
                       │ submit / stream / cancel
┌──────────────────────▼───────────────────────────────────┐
│  Runtime Kernel                                          │
│  agent-runtime   agent-session   agent-context-engine     │
│  (lifecycle)     (facts)        (assembly)                │
└──────────────────────┬───────────────────────────────────┘
                       │ orchestrate / invoke
┌──────────────────────▼───────────────────────────────────┐
│  Controller Layer                                        │
│  agent-core         agent-workflow                        │
│  (model-driven)     (workflow-driven)                     │
└──────────────────────┬───────────────────────────────────┘
                       │ call / execute
┌──────────────────────▼───────────────────────────────────┐
│  Capability + Platform Layer                             │
│  agent-capability  agent-model  agent-memory              │
│  agent-attachment  agent-observability                    │
│  agent-platform-gateway-local  agent-platform-gateway-remote │
└──────────────────────────────────────────────────────────┘
                       │
┌──────────────────────▼───────────────────────────────────┐
│  Composition Root                                        │
│  agent-app  (唯一组装点，冻结所有配置和绑定)              │
│  agent-app-frontend-hosting (静态资源托管)                │
└──────────────────────────────────────────────────────────┘
```

## 包职责速查

| Package | 一句话职责 | 拥有 | 不拥有 |
|---|---|---|---|
| `agent-app` | 唯一 composition root | 启动编排、配置冻结、ready gate | 业务逻辑 |
| `agent-runtime` | 请求生命周期 | admission、lane、RequestRun、timeline、terminal commit、recovery | 业务语义路由 |
| `agent-core` | Agent 内部路由与编排 | request routing、model/tool loop、业务调度 | 请求生命周期状态 |
| `agent-session` | 会话事实管理 | UserSession、SessionMessage、ActiveContext、conversation preview | 请求运行 |
| `agent-context-engine` | 上下文组装 | query policy、window selection、compaction、prompt shaping、budget gate | 模型调用 |
| `agent-model` | 模型 provider 隔离 | provider SDK、stream normalization、tool-use normalization、safe error mapping | 上下文选择 |
| `agent-capability` | 统一 Capability 生命周期 | discovery、binding、authorization、invocation、result governance | 具体能力实现 |
| `agent-workflow` | Workflow 执行引擎 | recipe loading、node execution、parallel gateway、pending input bridge | request lifecycle、cancel、checkpoint、terminal commit |
| `agent-channel-web` | Web 传输层 | REST、SSE、WS、schema validation、identity injection、DTO/stream projection | 请求生命周期、可信身份 |
| `agent-channel-task` | Task Channel | HTTP/SSE/Callback 机机交互、事件映射 | 请求生命周期 |
| `agent-channel-common` | Channel 共享抽象 | channel 间复用的 helper 和类型 | 独立业务 |
| `agent-channel-web-auth-local` | 本地认证适配 | localhost-only auth | 远程认证 |
| `agent-contracts` | 边界契约 | public DTO、schema、port interface、namespace | 运行时实现 |
| `agent-common` | 跨模块词汇表 | branded ID、IdentityContext、SafeError、枚举、工具函数 | DO/DTO/Record/port/业务服务 |
| `agent-platform-gateway-local` | 本地持久化 | SQLite、file stores、sandbox、RAG、audit | 业务事件语义 |
| `agent-platform-gateway-remote` | 远程平台适配 | PaaS SDK、远程服务适配器 | 本地持久化 |
| `agent-observability` | 结构化可观测 | logging、redaction、trace/metric、audit、risk policy evaluation | 业务数据 |
| `agent-memory` | 长期记忆 | lifecycle、extraction、aging、recall、trajectory building | 请求终态提交通路 |
| `agent-attachment-runtime` | 附件管理 | 校验、暂存、引用、可用性、cleanup | 附件内容 |
| `agent-log` | 结构化日志 | logging infrastructure、diagnostic artifact writer | 业务逻辑 |
| `agent-local-file-roll` | 文件轮转 | rotation、compression、retention | 业务语义 |
| `agent-plugin-sdk` | 插件 SDK | Tool provider、routing policy、lifecycle hook SPI | 具体插件实现 |
| `agent-dev-workbench` | 开发工作台 | 开发工具 | 生产逻辑 |
| `agent-test-kit` | 测试工具 | test helper、fixture | 生产逻辑 |
| `agent-app-frontend-hosting` | 前端静态托管 | SPA fallback、静态资源路由 | API、业务状态 |
| `agent-remote-deployment` | 远程部署 | 远程部署适配组装 | 本地逻辑 |

## 依赖方向规则

以下规则源自 `dependency-cruiser.config.cjs`，`npm run lint:architecture` 会强制执行。

### 允许的跨实现包依赖

实现包之间**默认禁止互引**，以下是被允许的例外：

| 包 | 可依赖的实现包 |
|---|---|
| agent-channel-web | agent-channel-common |
| agent-channel-task | agent-channel-common |
| agent-log | agent-local-file-roll |
| agent-observability | agent-local-file-roll |
| agent-platform-gateway-local | agent-local-file-roll |
| agent-app | 所有包 |

### Contracts subpath 白名单

每个实现包只能引用 `agent-contracts` 的特定 subpath（违反会报 error）：

| 包 | 允许的 contracts subpath |
|---|---|
| agent-runtime | agent-assembly, runtime, session, gateway, observability, capability, context |
| agent-session | agent-assembly, capability, context, gateway, model, runtime, session |
| agent-attachment-runtime | attachment, gateway |
| agent-context-engine | agent-assembly, context, capability, model, gateway, session, runtime, system-reminder |
| agent-memory | capability, channel, context, gateway, model |
| agent-core | agent-assembly, runtime, context, model, capability, observability, session, core |
| agent-model | agent-assembly, model, runtime, observability |
| agent-channel-common | channel, runtime |
| agent-channel-web | channel, runtime, observability |
| agent-channel-task | channel, runtime, observability |
| agent-platform-gateway-local | gateway, capability |
| agent-platform-gateway-remote | gateway, model, capability, observability |
| agent-capability | agent-assembly, capability, gateway, model, observability |
| agent-observability | context, gateway, observability |
| agent-workflow | agent-assembly, core, capability, context, model, gateway, observability |
| agent-app | agent-assembly, app, capability, channel, context, gateway, core, model, observability, runtime |

### 关键禁止规则

| 规则名 | 含义 |
|---|---|
| no-cross-package-private-imports | 跨包只能通过 public exports，禁止 deep import 到 src/ 子路径 |
| no-contract-to-implementation | contracts 不得依赖任何实现包 |
| no-common-to-contracts | agent-common 不得依赖 agent-contracts |
| no-channel-to-lifecycle-owners | channel-web/task 禁止依赖 runtime/session/context/memory/core/model/capability/app |
| no-channel-web-to-gateway-records | channel-web 禁止引用 agent-contracts/gateway |
| no-channel-web-to-gateway-adapter | channel-web 禁止依赖 gateway-local/remote |
| no-channel-task-to-gateway-records | channel-task 禁止引用 agent-contracts/gateway |
| no-channel-task-to-gateway-adapter | channel-task 禁止依赖 gateway-local/remote |
| no-runtime-to-adapter-or-app | runtime 禁止依赖 channel-web/gateway-local/gateway-remote/app |
| no-agent-assembly-to-runtime-or-wide-contracts | contracts/agent-assembly 禁止引用 runtime/app/gateway/channel/model/capability/context/session/observability/core/attachment |
| no-product-contract-root-aggregate-imports | 实现包禁止从 agent-contracts 根 index 导入，必须用具体 subpath |
| no-unauthorized-local-file-roll-consumers | 只有 agent-log/agent-observability/agent-platform-gateway-local 可依赖 agent-local-file-roll |
| no-direct-robotrouter-guardrail-import | 只有 agent-platform-gateway-remote 可引用其 guardrail 内部 |

## Minimal Kernel（最小内核）

| 职责 | 包 | 不变量 |
|---|---|---|
| 跨模块词汇与 port | agent-common, agent-contracts | 所有协作只通过 public contract |
| 请求与会话事实 | agent-runtime, agent-session | admission、lane、timeline、terminal commit |
| Agent 执行 | agent-core | 内部路由、model/tool loop |
| 模型输入与调用 | agent-context-engine, agent-model | context budget/render、provider 隔离 |
| 能力治理 | agent-capability | discovery、binding、authorization、invocation |
