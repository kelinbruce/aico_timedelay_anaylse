# NextAgent

NextAgent 是面向电信网络智能体的 TypeScript 后端框架。它不是一个通用聊天 Demo，而是把模型调用、会话生命周期、能力治理、网络知识、受控工具、人工交互、可观测审计和平台集成放进同一条可验证的 Agent 主路径。

当前仓库以 TS 后端 workspace 为核心，同时包含同仓前端源码、前端托管边界、Mock Server、OpenSpec 规格资产、开发者文档和本地运行包/发布验证脚本。

## 30 秒理解

- **定位**：电信网络运维智能体后端，服务故障诊断、巡检分析、配置核查、知识问答、报告生成和行业二次开发。
- **主路径**：Session / RequestRun / timeline / checkpoint / terminal commit 构成可恢复、可追踪的请求生命周期。
- **能力体系**：Tool、Skill、Agent、Workflow recipe 统一进入 Capability governance，注册不等于授权，授权不等于当前 request 可调用。
- **交互通道**：Web channel 提供人工交互 API、SSE / WebSocket stream；Task channel 面向网管、告警平台和编排系统。
- **扩展方式**：低风险优先使用配置、Agent package、Prompt、Skill、Tool、Plugin、Lifecycle Hook；核心 runtime / gateway / contract 变更必须先走 OpenSpec

## 当前能力

| 能力域 | 当前具备 | 用户/开发者收益 |
| --- | --- | --- |
| Runtime 内核 | request admission、same-session lane、cancel/retry、checkpoint、terminal commit、本地 recovery | 长任务可接续、可取消、可恢复，结果提交有唯一权威路径 |
| Web / Task Channel | Web REST、SSE、WebSocket、Task channel、async callback、附件 intake、stream replay | 支持人工聊天式使用，也支持后台系统机机接入 |
| Agent 装配 | `default-system.yaml` / `application.yaml`、`agent.yaml`、model profiles、prompt templates、Agent Scope 固化 | 不改 runtime 也能装配不同网络领域 Agent |
| Capability Catalog | Tool / Skill / Agent / Recipe 统一 descriptor、provider、discovery、resolve、invocation/result contract | 能力可发现、可治理、可追踪，避免发现即授权 |
| 内置 Tool | `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`Rag`、`ToolSearch`、`Skill`、`Agent`、`AskUserQuestion` | 文件、检索、命令、Python、RAG、Skill、SubAgent、人工补充输入都有统一入口 |
| Skill / SkillHub | 系统级本地 Skill、Agent-owned Skill、SkillHub runtime acquisition loop、deferred ToolSearch 激活 | 可沉淀领域流程和操作手册，并按当前 Agent scope 安全加载 |
| Workflow | workflow routing、recipe loading、RECIPE capability、gateway / parallel / capability / interaction / knowledge / llm 节点族 | 标准化运维流程可从自由规划沉淀为可治理编排 |
| 多 Agent | builtin Agent、本地 Agent、subagent discovery、`Agent` tool fresh-context child run | 专家 Agent 可隔离分析，父子运行链路仍由 runtime 管理 |
| 记忆与知识 | long-term memory core、memory tools、task trajectory、memory extraction/aging、RAG logical indexes | 支持长期记忆、显式记忆调用和本地知识检索 |
| 人机协同 | pending input lifecycle、AskUserQuestion、authorization / confirmation / question / handoff 边界 | 需要澄清、确认、授权或接管时不另建状态机 |
| 安全边界 | Owner Scope + Agent Scope、risk policy、sandbox gateway、deny-by-default、trusted workspace file authority | 请求体、模型输出和 capability 参数不能扩大身份、Agent 或文件/执行权限 |
| 可观测 | structured logging、runtime logging、metrics、trace projector、audit、agent execution trajectory、OTel adapter | 支持排障、审计、容量治理和运行链路复盘 |
| Plugin / Hook | startup-only local plugin、Tool provider、agentRoutingPolicy、LifecycleHook、developer-hook-trace、context-monitor | 本地可信扩展可进入既有治理路径，调测插件可观察 loop 和上下文演化 |
| 前端与交付 | 同仓 `frontend/agent-web`，构建后由 `agent-app` 静态托管；本地 runtime 包可打包验证 | 支持后端独立开发，也支持全栈本地交付 |

## 典型使用入口

### 用户和集成方

- [用户配置和使用指导](docs/用户配置和使用指导.md)：系统配置、Agent 配置、能力启用、Web/Task 调用、路由与排错。
- [API 参考](docs/developer/10-api-reference.md)：REST API、stream event、Task channel 摘要。
- [agent-web API 清单](docs/apis/agent-web-api-list.md)：Web channel 权威字段。
- [Task Channel API](docs/apis/task-channel-api.md)：后台系统机机接口权威字段。

### Agent / Skill / 配置开发者

- [快速上手](docs/developer/01-quickstart.md)：安装、启动、验证第一个 Agent。
- [Agent 配置参考](docs/developer/03-agent-configuration.md)：`agent.yaml`、模型授权、能力绑定、runtimeSettings。
- [Skill 与 Tool 开发](docs/developer/04-skill-tool-development.md)：Tool SPI、Skill manifest、Skill source 和执行路径。
- [能力扩展](docs/developer/05-capability-extension.md)：Capability source、ToolSearch、Agent、Hook、Provider 选择。
- [提示工程](docs/developer/06-prompt-engineering.md)：Agent package prompt templates。

### 平台开发者

- [OpenSpec 总览](openspec/overview.md)：稳定基线、范围和基线外能力。
- [架构概览](docs/developer/02-architecture.md)：后端 package 职责和分层边界。
- [前端文档总入口](docs/frontend/README.md)：agent-web 宿主形态、开发方式与用户工作流。
- [Agent Plugin 开发指南](docs/developer/19-agent-plugins.md)：本地插件、Tool provider、policy、hook、context-monitor。
- [Remote Gateway 开发指南](docs/developer/20-remote-gateway-development.md)：远端 gateway provider 和 binding。
- [Observability Metrics 指标清单](docs/developer/22-observability-metrics.md)：运行时、模型、能力、网关、健康检查指标。

## 快速开始

环境要求：

- Node.js `>= 22`
- npm workspaces
- Git

安装依赖：

```bash
npm install
```

启动开发监听：

```bash
npm run dev:watch
```

默认地址：

- 后端：`http://127.0.0.1:3000`
- 前端：`http://127.0.0.1:5173`

本地全栈构建并启动：

```bash
npm run dev:fullstack
```

常规验证：

```bash
npm run build
npm test
npm run test:contract
npm run lint:architecture
npm run lint:openspec
```

发布/门禁相关脚本：

```bash
npm run test:e2e:alpha-kernel
npm run test:e2e:product-journey
npm run test:e2e:release
npm run pack:release
npm run release:qualify
```

## 最小 API 流程

```bash
BASE=http://127.0.0.1:3000

curl -s -X POST "$BASE/api/v1/sessions" \
  -H "Content-Type: application/json" \
  -d '{"locale":"zh-CN"}'

curl -s -X POST "$BASE/api/v1/sessions/sess_xxx/requests" \
  -H "Content-Type: application/json" \
  -d '{"inputText":"分析小区掉话率升高原因","idempotencyKey":"idem-001","locale":"zh-CN"}'

curl -N "$BASE/api/v1/sessions/sess_xxx/stream?requestId=req_xxx"
```

Task channel 示例见 [用户配置和使用指导](docs/用户配置和使用指导.md#task-channel-使用流程) 和 [Task Channel API](docs/apis/task-channel-api.md)。

## 配置模型

系统配置由内置 `packages/agent-app/config/default-system.yaml` 提供默认值；交付环境建议提供用户 `application.yaml` 覆盖默认配置。关键分层：

| 配置层 | 文件/来源 | 作用 |
| --- | --- | --- |
| App composition config | `application.yaml` 覆盖 `default-system.yaml` | deployment、paths、auth、channel、hostedAgent、modelProfiles、gateway、rag、sandbox、plugins、capability-providers |
| Agent package config | `agent.yaml`、`prompts/`、`skills/` | Agent 模型授权、能力绑定、runtimeSettings、hook/policy 激活、Agent-owned Skill |
| Request input | Web / Task API 请求 | inputText、attachments、routingConstraints、modelOptions、idempotencyKey |

核心原则：

- `modelProfiles[].models[].modelId` 定义系统可用的 canonical 模型；当前 Agent 可通过 `agent.yaml.modelIds` 显式收窄范围，省略时继承系统已校验模型清单。
- 顶层 `agent.yaml.defaultModelId` 是当前 Agent 的可选默认模型，必须属于解析后的 `modelIds`；省略时初始选择使用第一个 eligible model。
- `hostedAgent.activeAgentId` 来自可信 app composition，不从客户端请求体获取。
- app 配置启动期校验并冻结；运行中编辑配置不会改变当前进程。

## 仓库结构

```text
nextagent-review/
|- packages/
|  |- agent-app/                       # 唯一 composition root
|  |- agent-runtime/                   # request lifecycle / scheduler / terminal commit
|  |- agent-core/                      # Agent orchestration / routing / tool loop
|  |- agent-context-engine/            # context assembly / compaction / prompt shaping
|  |- agent-model/                     # provider SDK boundary / stream normalization
|  |- agent-capability/                # Tool / Skill / Agent capability lifecycle
|  |- agent-workflow/                  # workflow engine / recipe / node adapters
|  |- agent-memory/                    # long-term memory and learning boundary
|  |- agent-session/                   # session / message / read model
|  |- agent-attachment-runtime/        # attachment intake / validation / cleanup
|  |- agent-channel-web/               # Web REST / SSE / WS transport and DTO projection
|  |- agent-channel-web-auth-local/    # local configured auth plugin
|  |- agent-channel-task/              # Task channel for machine-to-machine integration
|  |- agent-channel-common/            # shared stream/projection transport helpers
|  |- agent-platform-gateway-local/    # local SQLite / sandbox / stores
|  |- agent-platform-gateway-remote/   # remote gateway adapter boundary
|  |- agent-remote-deployment/         # remote deployment assembly reference
|  |- agent-app-frontend-hosting/      # backend-owned frontend static hosting boundary
|  |- agent-observability/             # logging / audit / trace / metrics
|  |- agent-plugin-sdk/                # local plugin authoring SDK
|  |- agent-dev-workbench/             # development workbench utilities
|  |- agent-test-kit/                  # plugin/capability test helpers
|  |- agent-contracts/                 # public cross-package contracts
|  |- agent-common/                    # shared vocabulary / ids / safe errors
|- frontend/
|  |- agent-web/                       # React frontend source
|  |- agent-web-mock-server/           # frontend mock server
|- docs/                               # user, API and developer documentation
|- openspec/                           # authoritative specs, designs and changes
|- tests/                              # cross-package contract / e2e / architecture tests
|- scripts/                            # build, packaging and release qualification scripts
|- src/main.ts                         # local app entrypoint
```

## 核心架构边界

- `agent-app` 是唯一 composition root，负责启动期配置、provider、plugin、gateway、model、capability、hook/policy 装配。
- `agent-channel-web` 和 `agent-channel-task` 只负责 transport、schema 和 public projection，不拥有 request lifecycle。
- `agent-runtime` 拥有 request lifecycle、scheduler、same-session lane、cancellation、checkpoint、pending input、terminal commit 和 canonical timeline。
- `agent-core` 负责 Agent 内部 request routing、tool loop、capability 解析和 orchestration，不拥有持久化事实。
- `agent-context-engine` 负责 context assembly、query policy、window selection、compaction 和 prompt shaping。
- `agent-model` 隔离 provider SDK、model stream normalization、tool-use normalization 和 safe error mapping。
- `agent-capability` 统一承载 Tool、Skill、Agent、Recipe 能力发现、治理和执行入口。
- `agent-workflow` 承载 workflow recipe 和节点执行，不拥有 runtime lifecycle、terminal commit 或 pending input store。
- `agent-platform-gateway-local` / `agent-platform-gateway-remote` 隔离 persistence、sandbox、remote service 和 driver 细节。
- `agent-observability` 负责 structured logging、redaction、trace、metric、audit 和 safe observability projection。

## 内置 Agent

当前仓库包含两个关键内置 Agent：

- `default-agent`：默认对外 Agent，绑定 `network-explorer` 子 Agent 和 memory tools。
- `network-explorer`：受限、只读的电信网络证据采集 Agent，用于拓扑、告警、KPI、日志、配置快照、清单和工单上下文的安全读取。

内置配置入口：

- 默认系统配置：[packages/agent-app/config/default-system.yaml](packages/agent-app/config/default-system.yaml)
- 默认 Agent：[packages/agent-core/src/builtin-agents/default-agent/agent.yaml](packages/agent-core/src/builtin-agents/default-agent/agent.yaml)
- 只读子 Agent：[packages/agent-core/src/builtin-agents/network-explorer/agent.yaml](packages/agent-core/src/builtin-agents/network-explorer/agent.yaml)

## OpenSpec 优先

`openspec/` 是权威规格来源。新增或修改以下内容前必须先有 OpenSpec change：

- Web API、Task API、stream event、runtime command。
- context / capability / gateway / model / observability public contract。
- persistence owner、schema、Record、SQLite row 和复合事务。
- security boundary、sandbox 行为、Agent Scope / Owner Scope 行为。
- lifecycle、cancellation、terminal commit、recovery、workflow 主路径语义。

稳定规格与设计入口：

- [openspec/specs/](openspec/specs/)
- [openspec/designs/](openspec/designs/)
- [openspec/designs/spec-to-design-map.md](openspec/designs/spec-to-design-map.md)

## 开发约束摘要

- 跨 package 只能通过 public package exports、`agent-contracts` 和 `agent-common` 协作，禁止 private path import。
- 主路径必须同时满足 Agent Scope 和 Owner Scope 隔离；请求体、模型输出和 capability 参数不能覆盖可信身份或 Agent。
- 不可信边界必须做 runtime schema validation。
- 慢边界必须是 async contract，并接收 `AbortSignal` 或等价 cancellation context。
- 动态执行 shell、python、脚本或模型生成代码必须走 sandbox gateway boundary。
- 日志、metric、trace、audit、safe error 不得泄漏 prompt、模型输出、stream delta、raw provider error、路径、credential、token、附件内容或高基数字段。
- push 前按仓库规则运行 `$nextagent-code-review` 进行模型语义检视。

## 文档导航

- [用户配置和使用指导](docs/用户配置和使用指导.md)
- [开发者文档入口](docs/developer/README.md)
- [前端文档入口](docs/frontend/README.md)
- [NextAgent 对外特性介绍](docs/NextAgent对外特性介绍.md)
- [OpenSpec 总览](openspec/overview.md)
- [Web API 清单](docs/apis/agent-web-api-list.md)
- [Task Channel API](docs/apis/task-channel-api.md)
- [发布文档](docs/release/)

## 当前范围边界

- 后端可以托管前端构建产物，但后端不依赖前端源码私有路径。
- 本地插件是 startup-only trusted extension surface，不是运行时热插拔系统。
- SkillHub 是 request-time acquisition / discovery 能力，不等同插件加载或任意远端代码执行。
- Workflow 首版与 runtime 协作执行，不拥有 distributed scheduling、durable workflow history、rollback/degrade 或多实例 recovery。
- 长期记忆不阻塞 request terminal commit；Context Assembly 不自动注入长期记忆，模型通过 governed memory tools 显式调用。
