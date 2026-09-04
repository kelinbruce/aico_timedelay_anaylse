# 架构概览

这一篇讲 NextAgent 的分层架构：26 个 package 各自管什么、一个请求从头到尾怎么走、你能在哪里做扩展、哪些边界不能碰。架构边界和约束的权威来源是 `AGENTS.md` 和 `openspec/`，这里做面向开发者的导读。

## 分层模型

NextAgent 分为两层：

```text
┌──────────────────────────────────────────────┐
│   Network Agent Assembly (智能体装配层)        │
│   - agent.yaml + capabilityBindings           │
│   - prompts/ 提示模板 + canonical model 选择    │
│   - "你想构建什么样的 Agent"                    │
├──────────────────────────────────────────────┤
│   Generic Agent Kernel (通用内核，TS 实现)      │
│   - runtime / session / context / model        │
│   - channel / gateway / observability          │
│   - "Agent 如何可靠运行"                        │
└──────────────────────────────────────────────┘
```

- **Generic Kernel**：负责请求准入、会话隔离、执行控制、上下文组装、流式事件、持久化与恢复——所有 Agent 共享的可靠运行底座。
- **Agent Assembly**：智能体开发者的主战场。通过 `agent.yaml` + 能力实现 + 提示模板 + 配置，把通用内核装配为具体的网络智能体。

## 架构分层

```text
入口适配层 (Entry / Channel)
    Web UI (frontend/agent-web) ──→ agent-channel-web (HTTP / SSE / WS transport + DTO projection)
                                     agent-channel-web-auth-local (本地配置认证)
                     │
运行时核心 (Runtime Kernel)         ← 所有请求统一入口
    agent-runtime                   ← 准入控制、same-session lane、checkpoint、terminal commit、canonical timeline
    agent-session                   ← session / message / history read model
                     │
控制器层 (Controller / Orchestration)
    agent-core                      ← Agent orchestration + request routing（含 builtin-agents）
    agent-context-engine            ← context assembly、query policy、window selection、prompt shaping
    agent-model                     ← provider SDK 隔离、stream / tool-use normalization、safe error
                     │
能力层 (Capability Layer)
    agent-capability                ← 统一 Tool / Skill / Agent capability lifecycle + catalog governance
    agent-attachment-runtime        ← 附件可信校验、暂存、cleanup
    agent-memory                    ← 长期记忆、检索、提取、aging（不阻塞 terminal commit）
    agent-workflow                  ← workflow engine / nodes 最小边界
                     │
平台层 (Platform / Gateway)
    agent-platform-gateway-local    ← SQLite 本地持久化
    agent-platform-gateway-remote   ← 远程平台服务、sandbox、PaaS SDK 边界
                     │
支撑层 (Cross-cutting)
    agent-contracts / agent-common  ← 跨包 public contracts 与 shared vocabulary
    agent-observability             ← structured logging、redaction、trace / metric
    agent-app                       ← 唯一 composition root，装配所有组件
    agent-app-frontend-hosting      ← 前端构建产物静态托管
    agent-plugin-sdk                ← Agent 插件 authoring SDK
    agent-test-kit                  ← 测试工具包
```

## 核心组件职责

### Runtime Kernel (`agent-runtime`)

运行时内核是请求执行的权威协调者：

- 接收所有入口命令（submit / cancel / retry / edit）。
- 应用准入控制、same-session lane 串行调度和 cancellation。
- 管理 `RequestRun` 生命周期、执行锁、checkpoint 和 terminal commit。
- 发布 canonical `RunTimelineEvent`，供 channel 做 stream projection。
- acceptance 时固化 `agentId`、`agentVersion`、`agentAssemblyRef`，accepted 后执行路径不再回退到默认 Agent。

> **智能体开发者不需要修改 Runtime**。Runtime 提供稳定的执行承载，你的 Agent 通过托管接口被 Runtime 调用。

### Agent Core (`agent-core`)

负责 Agent 内部 request routing 与 orchestration：

- 请求级业务循环（调用模型 → 解析 tool_use → 执行 capability → 继续循环或结束）。
- 步骤级模型路由与 workflow routing 分支。
- 内置 `default-agent`、`network-explorer` 两个 builtin Agent（位于 `src/builtin-agents/`）。
- 工具循环收敛保护：canonical `maxTurns` 是唯一 loop-count 收敛上限，非终止失败不建 fingerprint、不设错误次数阈值、不以 `CAPABILITY_REPEATED_FAILURE` 终止；达到 `maxTurns` 时停止 Tool 执行并注入一次 `toolChoice=NONE` 无工具收尾 turn（见 `tool-loop` spec，`2026-08-09-unify-capability-failure-disposition` 移除了旧 repeat-failure guard）。

> Runtime 不做业务语义路由；Agent 的业务行为通过 `agent.yaml`、capability binding、prompt template、lifecycle hook 表达。

### Context Engine (`agent-context-engine`)

负责每次模型调用的上下文组装：

- 接收 `ContextAssemblyRequest`（仅含 `sessionId`、`purpose`，**不携带预选上下文**）。
- 查询会话历史、附件、capability 结果；长期记忆不自动注入，模型需通过 governed memory tools 显式调用。
- 解析 prompt template（purpose-aware selection / rendering / fallback）。
- 应用 query policy、window selection、compaction 和 large-content externalize。
- 渲染最终 `ChatMessage` 列表并 handoff `modelOptions`。

> 智能体开发者通过**提示模板**影响上下文组装。见 [提示工程](./06-prompt-engineering.md)。

### Model (`agent-model`)

隔离 provider SDK：

- 隔离 `ai`、`@openrouter/ai-sdk-provider` 等 SDK 细节。
- stream normalization、tool-use normalization。
- safe error mapping（不向核心契约、timeline、DTO 泄漏 raw provider error）。

### Capability (`agent-capability`)

统一承载 Capability 生命周期，Tool / Skill / Agent 都是 Capability 类型：

- builtin source、local directory source、agent-owned source、skillhub source、API-backed tool source。
- capability input schema validation、conflict resolution、invocation audit、idempotency contract 与安全降级。
- `capabilityType` 取值 `TOOL` / `SKILL` / `AGENT`，在 `agent.yaml.capabilityBindings` 中显式绑定后才可被 Agent 调用。
- 内置 Tool（17 个）：`Read` / `Write` / `Edit` / `Glob` / `Grep` / `Bash` / `Python` / `Rag` / `ToolSearch` / `AskUserQuestion` / `Skill` / `Agent` / `TodoWrite` / `Workflow` / `ApiCall` / `Cron`；另有 `memory-tools` provider 下的 `search_memory` / `get_memory_detail` / `add_memory`。
- 动态执行（shell / python / 脚本）通过 sandbox gateway boundary，遵循 deny-by-default。默认配置仅放行 `clipc` / `curl` / `python` 可执行文件，`bash` / `sh` / `powershell` / `cmd` 等均在 deny 名单；需要 shell 执行时必须在 `application.yaml` 的 `nextAgent.system.sandbox` 显式调整。

> 智能体开发者的核心二开入口。见 [Skill 与 Tool 开发](./04-skill-tool-development.md) 和 [能力扩展](./05-capability-extension.md)。

### Channel (`agent-channel-web`)

只负责 transport 和 stream projection，**不拥有 request lifecycle**：

- Fastify 路由、SSE 与 WebSocket 等价流式投影。
- public DTO projection（`displayTitle`、`lastActivityAt`、`cursor`、`nextCursor` 等 alias 只在此层出现）。
- `agent-channel-web-auth-local` 提供本地配置认证（`nextagent_local_auth` HttpOnly Cookie）。

### Session (`agent-session`)

负责 session、message 和 history read model：

- `Session` 必须绑定 `agentId`。
- 会话历史读取以 `SessionMessage` 为事实源，不依赖 SSE replay。
- 提供 conversation 分页、preview/navigation、annotation、favorites、share 等读模型。

### Platform Gateway (`agent-platform-gateway-local` / `agent-platform-gateway-remote`)

隔离 persistence、remote service、sandbox、PaaS SDK 和 driver 细节：

- `agent-platform-gateway-local`：SQLite gateway-local，使用专用业务事实表（request run、session、message、active context、timeline event、checkpoint 等），禁止用 generic `records(store,key,json)` 承载。
- `agent-platform-gateway-remote`：远程平台服务边界。
- gateway public port 只暴露 `*Record` 持久化 DTO；DB row / entity 只允许停留在 gateway-local 私有实现。

### Observability (`agent-observability`)

- structured logging、redaction、TraceProjector、unified MetricsRegistry、安全字段 allowlist。
- `agent-app` 是唯一的 tracer / meter / provider / exporter composition owner。
- 日志、metric、trace、audit、safe error 不得包含 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容或高基数字段。

### Composition Root (`agent-app`)

- 唯一 composition root，装配所有组件。
- 启动期接收 trusted app / plugin composition 已装配的 `LifecycleHook` 对象，冻结 hook registration / definition / AgentAssembly activation snapshot。
- 提供 `entrypoints/backend-only.ts`、`entrypoints/with-frontend.ts`、`entrypoints/local-configured-auth.ts` 三个入口。
- `agent-app-frontend-hosting` 承载前端构建产物（`@nextagent/agent-web` npm 包）的静态托管。

## 端到端请求链路

```text
用户提交请求
  → agent-channel-web 接收 HTTP 请求（校验 schema + owner scope）
  → agent-runtime 准入控制（校验 Agent Scope + Owner Scope）
      → 创建 RequestRun，acceptance 时固化 agentId / agentVersion / agentAssemblyRef
  → agent-core 开始业务循环：
      ① agent-context-engine 组装模型输入（prompt template + history + window selection）
      ② agent-model 执行推理（stream + tool-use normalization）
      ③ 解析 tool_use → agent-capability 调用能力（Tool / Skill / Agent）
         - 动态执行经 sandbox gateway boundary + risk policy
      ④ 收集结果 → 继续循环或结束（repeated failure guard / terminal）
  → agent-runtime 完成 checkpoint + terminal commit（持久化写入完成后终态才对客户端可见）
  → agent-channel-web 把 canonical timeline 投影为 stream envelope（SSE / WS）
```

## 智能体开发者的四条扩展入口

| 输入面 | 说明 | 示例 |
|--------|------|------|
| **Agent 配置** | `agent.yaml` 表达 Agent 装配 | `modelIds`、`defaultModelId`、`capabilityBindings`、`runtimeSettings`、`resources`、`hooks` |
| **Capability（Tool / Skill / Agent）** | 通过 `capabilityBindings` 显式绑定后调用 | 自定义 Tool、本地 Skill、subagent |
| **Prompt template** | 放在 Agent package `prompts/{PURPOSE}/template.yaml` | `SYSTEM_PROMPT`、`SUMMARY_GENERATION`、`MEMORY_EXTRACTION` 及自定义 purpose |
| **Lifecycle Hook** | 在 `agent.yaml.hooks` 表达启用 / 关闭 / stage 收窄 / 排序 / 超时 | 请求生命周期治理扩展点，见 [Lifecycle Hook 开发指南](./17-lifecycle-hooks.md) |

> Lifecycle hook 的产品路径由 `agent-app` 在启动期接收 trusted app / plugin composition 已装配的 `LifecycleHook` 对象并冻结 snapshot；Agent package 只通过 `agent.yaml.hooks` 表达当前 Agent 的启用配置，runtime 只消费 accepted run 固化的 snapshot。

## 关键设计约束

以下约束智能体开发者必须遵守，不可绕过（权威来源：`AGENTS.md`）：

| 约束 | 说明 |
|------|------|
| 双 scope 隔离 | 主路径必须同时校验 Agent Scope（可信 app composition / hosted-agent / 已持久化 `Session.agentId`）和 Owner Scope（channel / auth identity）。请求体、模型输出、capability args 不得覆盖当前身份或当前 Agent |
| 跨包只走 public exports | 跨 package 只能通过 public package exports 和 `agent-contracts` / `agent-common` 协作，禁止 private path import。对外（仓库外）开发者只能依赖 `@nextagent/agent-plugin-sdk` 与 `@nextagent/agent-contracts` 的 public exports，其余 `packages/*/src/` 路径属于内部实现，可能变更 |
| DO / DTO / Record 分层 | 领域服务暴露 DO / read model；Web / channel 只暴露 public DTO；gateway 只暴露 `*Record`；DB row 只允许停留在 gateway-local。`*Record` 不得进入 Web response 或领域 service 的 public return |
| 请求命令单向入口 | submit / cancel / retry / edit 只经 `agent-runtime`，不可绕过 |
| 终态结果提交 | 所有持久化写入完成后，终态结果才对客户端可见（terminal commit） |
| 历史事实源 | 默认历史读取 `SessionMessage`，不依赖 SSE replay |
| 注册 ≠ 绑定 | 能力被发现不等于 Agent 有权调用；必须通过 `agent.yaml.capabilityBindings` 显式绑定 |
| 幂等锚点事实表 | idempotent write 定义业务锚点表，按 owner scope + agent scope + session/request/run 坐标建立 scoped uniqueness；重复 key 返回首次结果且不重复 side effect |
| 不直接修改 Kernel | 领域行为优先通过 Agent Assembly、capability binding、prompt template、hook 表达 |
| sandbox 边界 | 动态执行 shell / python / 脚本 / 模型生成代码必须走 sandbox gateway boundary，不得直接使用宿主进程权限 |
| 不可信边界 schema 校验 | HTTP、stream、config、gateway response、persisted JSON、capability input/output 等不可信边界必须 runtime schema validation |

## 规格优先

`openspec/` 是权威规格来源。新增或修改 Web API、stream event、runtime command、context contract、capability contract、gateway contract、persistence owner、安全边界、可观测信号前，必须先有 OpenSpec change。

- `openspec/specs/`：稳定行为契约。
- `openspec/designs/`：稳定设计与 ADR。
- `openspec/changes/`：active change。
- `openspec/overview.md`：规格总览。

## 相关资源

- [OpenSpec 总览](../../openspec/overview.md) — 产品范围、稳定基线与长期背景
- [稳定行为契约](../../openspec/specs/) — 归档后的稳定 capability 行为契约
- [稳定设计文档](../../openspec/designs/) — 架构设计与 ADR
- [项目根 README](../../README.md) — 平台定位、技术栈、架构边界
- [开发约束](../../AGENTS.md) — 规格优先、架构边界、技术约束与验证门禁
- [agent-web API 清单](../apis/agent-web-api-list.md) — 完整 API 字段参考
