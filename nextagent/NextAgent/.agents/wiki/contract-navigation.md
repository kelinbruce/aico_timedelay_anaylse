---
sources:
  - openspec/config.yaml
  - openspec/overview.md
  - openspec/designs/spec-to-design-map.md
last-verified: 2026-09-01
---

# 契约导航：如何找到和使用 Contracts 与 OpenSpec

→ OpenSpec 变更工作流详见 [openspec-workflow.md](openspec-workflow.md)
→ 类型放哪的决策树详见 [decision-trees.md](decision-trees.md)

## 核心原则

**契约先行**：新增或修改 Web API、stream event、runtime command、context contract、capability contract、gateway contract、persistence owner、安全边界、可观测信号前，**必须先有 OpenSpec change**。

实施阶段默认只改 active change 文档和代码；长期基线文档在归档前更新。不得把未被 OpenSpec 定义的行为直接写进实现。

## OpenSpec 目录结构

```
openspec/
├── config.yaml                 # OpenSpec 配置
├── overview.md                 # 权威基线描述（53.8 KB）
├── changes/                    # 活跃和已归档的 OpenSpec changes
│   └── add-xxx/                # 每个 change 一个目录
│       ├── proposal.md         # 变更提议
│       ├── design.md           # 设计文档
│       └── tasks.md            # 任务清单
├── designs/
│   ├── architecture/           # 41 个架构设计文档
│   ├── features/               # D1-D11 领域特性设计
│   ├── functions/              # D1-D11 领域功能设计
│   ├── modules/                # 每包一个模块设计（24 个）
│   └── spec-to-design-map.md   # spec → design 映射（152 KB）
├── specs/                      # 229 个独立规格文档
└── schemas/                    # Schema 验证
```

### 设计领域 D1-D11

| 领域 | 名称 | 关心什么 |
|---|---|---|
| D1 | Session and Streaming Interaction | 会话、消息、流式事件、SSE/WS |
| D2 | Request Runtime | 请求生命周期、admission、lane、terminal commit |
| D3 | Agent Assembly and Main Chain | Agent 配置、路由、model/tool loop |
| D4 | Model and Context | 模型调用、上下文组装、compaction |
| D5 | Capability System | Tool/Skill/Agent/Workflow 治理 |
| D6 | Security and Governance | Risk policy、scope isolation、sandbox |
| D7 | Observability and Audit | 日志、trace、metric、audit |
| D8 | Data and Memory | 持久化、长期记忆、trajectory |
| D9 | Workflow Orchestration | Workflow 引擎、recipe、节点执行 |
| D10 | Secondary Development and Platform Integration | 插件、二次开发、平台适配 |
| D11 | Reliability and Resilience | Recovery、checkpoint、retry |

## agent-contracts 14 个 subpath

| Subpath | 用途 | 关键导出 |
|---|---|---|
| `agent-assembly` | Agent 身份与配置 | AgentAssembly, AgentAssemblyRegistry, AgentSelectionPolicy |
| `app` | App 组装契约 | Re-exports ModelProfile, ModelProviderProfile |
| `attachment` | 附件生命周期 | RequestAttachment |
| `capability` | 能力治理 | CapabilityDescriptor, Tool, SkillMetadata, CapabilityInvocationRequest/Result |
| `channel` | Channel 传输契约 | StreamEnvelope, StreamEventType |
| `context` | 上下文组装 | ContextAssemblyRequest, ContextEnginePort, TokenEstimator |
| `core` | Agent 核心 | AgentRoutingDecision, RecipeDefinition, FlowGraph, WorkflowNodeDef |
| `gateway` | Gateway 持久化 | OwnerScoped, *Record types, GatewayAdapterKind |
| `model` | 模型 provider | ModelInvocationService, ModelFinalResult, ModelStreamDelta |
| `observability` | 可观测 | RiskPolicyEvaluation, ExecutionCorrelationPort |
| `runtime` | 运行时生命周期 | SubmitRequestCommand, RequestRun, RuntimeCommandPort |
| `session` | 会话与消息 | UserSession, SessionMessage, ActiveContextView |
| `system-reminder` | 系统提醒 | SystemReminder, SystemReminderType, tag constants |

## 常见操作：从需求到实现

### 新增 Web API 端点

1. 在 `openspec/changes/` 创建 change 目录，写 proposal.md
2. 在 `agent-contracts/session` 或 `agent-contracts/channel` 定义 DTO 和 schema
3. 在 `agent-channel-web` 实现 route，注入 trusted identity
4. 在 gateway 定义 Record（如涉及持久化）
5. 写 contract test 和 architecture test

### 新增 Gateway Record

1. OpenSpec change 先行
2. 在 `agent-contracts/gateway` 定义 Record
3. Record 只引用 agent-common vocabulary 和 gateway 自身 vocabulary
4. **不得**让 gateway Record 继承 Request
5. 在 gateway-local 实现_row mapping，不反推业务语义

### 新增 Timeline Event Type

1. OpenSpec change 先行，定义 event 语义
2. 在 `agent-common` 添加 enum 值
3. 在 agent-runtime 实现发布
4. 在 agent-channel-web 实现流投影
5. 确保 timeline event 不包含敏感信息（进入 stream/history 前检查）

### 新增 Capability Kind

1. OpenSpec change 先行
2. 在 `agent-contracts/capability` 扩展 CapabilityKind
3. 在 `agent-capability` 实现治理生命周期
4. 确保注册/授权/调用三步治理完整

## 如何快速定位 spec

- **知道领域**：查 `openspec/designs/{features,functions}/D{n}/`
- **知道包名**：查 `openspec/designs/modules/{package-name}.md`
- **知道 spec 名**：查 `openspec/specs/` 下的文件
- **要映射关系**：查 `openspec/designs/spec-to-design-map.md`（152 KB，全量映射）
- **看整体基线**：查 `openspec/overview.md`
- **看架构设计**：查 `openspec/designs/architecture/` 下的专题文档

## 修改代码前必查

1. 相关 OpenSpec change 是否已存在？→ `openspec/changes/`
2. 相关 spec 是否已定义？→ `openspec/specs/`
3. 相关 design 是否已描述？→ `openspec/designs/`
4. agent-contracts 对应 subpath 是否需要扩展？→ `packages/agent-contracts/src/`
5. agent-common 是否需要新增 vocabulary？→ `packages/agent-common/src/`
