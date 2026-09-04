---
sources:
  - AGENTS.md
  - docs/nextagent-architecture.md
  - openspec/overview.md
last-verified: 2026-09-01
---

# 电信运维与 NextAgent 领域术语表

NextAgent 服务电信网络智能体场景。以下术语在代码、OpenSpec 和文档中高频出现，理解其精确含义是正确实现的前提。

## 电信运维核心术语

| 术语 | 英文 | 含义 | 在 NextAgent 中的体现 |
|---|---|---|---|
| 网元 | NE (Network Element) | 网络中可管理的设备节点，如路由器、交换机、基站 | 模型输出保留英文 NE，context engine NE 知识注入 |
| 告警 | Alarm | 网元上报的异常信号，含级别（critical/major/minor/warning） | Task Channel 接收告警触发，巡检分析关联告警 |
| 巡检 | Inspection/Patrol | 定期检查网元状态和性能指标 | 巡检分析 Skill，报告生成 Workflow |
| 配置核查 | Configuration Audit | 比对网元实际配置与预期基线 | 配置核查 Skill，diff 比对 Tool |
| 故障诊断 | Fault Diagnosis | 从告警/指标异常定位根因并推荐处置 | Agent 主路径的核心用例 |
| KPI | Key Performance Indicator | 关键性能指标，如 CPU 利用率、丢包率 | 模型输出保留英文 KPI |
| CLI | Command Line Interface | 网元命令行操作 | 模型输出保留英文 CLI；Bash Tool 执行 CLI 命令走 sandbox |
| 协议 | Protocol | 设备间通信规范，如 SNMP、NETCONF、RESTCONF | 模型输出保留英文 Protocol |
| 接口 | Interface | 网元对外暴露的管理接口 | 模型输出保留英文 Interface |
| 拓扑 | Topology | 网络设备间的连接关系图 | run-graph 可视化，@antv/g6 渲染 |
| 根因 | Root Cause | 故障的原始触发因素 | 诊断 Skill 输出 rootCause 字段 |
| 处置建议 | Remediation | 针对故障的修复操作建议 | 诊断结果包含 remediation steps |
| 编排 | Orchestration | 多步骤自动化任务的协调执行 | Workflow 引擎、Task Channel |
| 网管系统 | NMS (Network Management System) | 上层网络管理平台 | Task Channel 对接 NMS 回调 |

## NextAgent 架构术语

| 术语 | 含义 | 关键约束 |
|---|---|---|
| Agent | 配置化的智能实体，拥有 identity、model、capability、prompt、workspace policy | 由 AgentAssembly 定义；AgentId 是可信的，不能来自客户端 |
| Session | 绑定 agentId 的对话上下文 | 必须绑定 agentId；按 owner scope 隔离 |
| RequestRun | Session 内的一次执行运行 | Acceptance 时固化 agentId/agentVersion/agentAssemblyRef |
| Terminal Commit | 请求运行的唯一终态提交路径 | 只有这一条路径可以终结 run |
| Timeline | RequestRun 的权威事件序列 | 持久化事实的单一真相源 |
| Checkpoint | 运行恢复快照 | 用于 crash recovery 和 resumption |
| Capability | Tool/Skill/Agent/Workflow 的统一抽象 | 注册 != 授权，有完整的治理生命周期 |
| Owner Scope | 租户+用户身份隔离 | 只能来自 channel/auth boundary |
| Agent Scope | Agent 身份，决定配置/模型/能力 | 只能来自可信 app composition 或已持久化 session |
| Pending Input | 人机交互暂停点（QUESTION/CONFIRMATION/AUTHORIZATION/HUMAN_HANDOFF） | 默认 30 分钟超时，最长 24 小时 |
| Risk Policy | 运行时风险策略评估 | 输出 ALLOW/DENY/REQUIRE_AUTHORIZATION/DEGRADED/POLICY_FAILED |
| SafeError | 安全错误表示 | 不暴露 provider raw error、内部路径、credential |
| Active Context | 当前模型可见的消息集 | 有版本追踪，context engine 负责 assembly |
| Context Assembly | 上下文组装过程 | 包含 query policy、window selection、compaction、prompt shaping |
| System Reminder | 运行时注入模型输入的上下文片段 | turn-scoped，不持久化，包裹在 `<system-reminder>` 标签中 |
| Recipe | Workflow 定义，含流程图和节点类型 | 一种确定性编排形式 |
| Task Trajectory | 故障诊断/配置变更/规划任务的进展记录 | 用于长期记忆学习输入 |
| Long-Term Memory | owner/agent scoped 持久记忆 | 不阻塞 request terminal commit |
| Agent Assembly | Agent 的完整配置快照 | 包含 model profile、prompt、capability binding、context policy |
| IR Surface | 机机交互 HTTP 接口面 | `/api/v1/ir` 前缀，header-based auth，只暴露 6 个端点 |
| ER Surface | 人机交互 HTTP 接口面 | `/api/v1` 前缀，浏览器认证 |

## 技术枚举与 Branded ID

本表只列领域相关的枚举值含义。完整类型系统、Branded ID 列表和命名规范见 [vocabulary-ids.md](vocabulary-ids.md)。

| 枚举 | 关键值 | 领域含义 |
|---|---|---|
| PendingInputKind | QUESTION / CONFIRMATION / AUTHORIZATION / HUMAN_HANDOFF | 澄清→确认→授权→人工接管，逐级升级 |
| RiskPolicyOutcome | ALLOW / DENY / REQUIRE_AUTHORIZATION / DEGRADED / POLICY_FAILED | 风险评估五态，REQUIRE_AUTHORIZATION 触发 PendingInput |
| MemoryCategory | FACTUAL / CONCEPTUAL / PROCEDURAL / USER_CHARACTERISTICS | 事实/概念/过程/用户特征四类长期记忆 |
| CapabilityKind | TOOL / SKILL / AGENT / WORKFLOW | 四种能力形态，如何选择见 [decision-trees.md](decision-trees.md) |
| RunStatus | ACCEPTED→QUEUED→PLANNING→EXECUTING→COMPLETED/FAILED/CANCELED/SUPERSEDED | 请求运行状态机 |

## 缩写对照

| 缩写 | 全称 | 语境 |
|---|---|---|
| SSE | Server-Sent Events | Web Channel 流式传输 |
| WS | WebSocket | Web Channel 双向通道 |
| DTO | Data Transfer Object | Web/channel 层暴露的公开数据结构 |
| DO | Domain Object | 领域服务暴露的领域对象 |
| PO | Persistence Object | 数据库行/实体，只在 gateway-local 内部 |
| Record | 持久化 DTO | Gateway port 的入参或返回值，不进入 Web response |
| CAS | Compare-And-Swap | 乐观并发控制 |
| OTel | OpenTelemetry | 可观测性标准 |
| OTLP | OpenTelemetry Protocol | OTel 数据导出协议 |
| RAG | Retrieval-Augmented Generation | 本地知识检索 |
| PIU | Process Interaction Unit | collaborative 宿主模式下的嵌入单元 |
| AICO | AI Composition | 外部 UI 定制配置 |
| CLIP | Capability-Level Integration Platform | API-backed Tool Source |
