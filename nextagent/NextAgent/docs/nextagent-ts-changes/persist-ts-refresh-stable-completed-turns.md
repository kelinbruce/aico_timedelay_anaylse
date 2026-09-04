# persist-ts-refresh-stable-completed-turns

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：P3 — Workflow 执行范式 / Workflow 生产硬化

状态：active
类型：Workflow live/history 一致性修复 + legacy Requirement 原子迁移
主要 owner：`agent-runtime`；`agent-core`、`agent-channel-common/web`、`frontend/agent-web`为必要接入方
依赖：行为依赖 `refine-agent-web-live-envelope-lifecycle`；归档顺序依赖 `add-stream-dsl-message-type`，后者依赖 `add-structured-delta-bash-apicall-identification`

目标：

- Workflow `PRODUCT_PROCESS` 使用 closed Event-owned 例外持久化且不进入模型上下文；`TURN_ANSWER` 继续由 terminal Assistant Message 持有并进入上下文。
- Direct 与 Workflow-as-Tool inner process 使用同一 Event projector；completed live 与 cold history 在产品结构、terminal answer 和顺序上收敛。
- Direct inner `TOOL`/`SKILL`/`SUBFLOW` 不创建模型协议 Message；Workflow-as-Tool 只保留真实 outer Tool protocol pair。
- ordinary/outer Capability Result 三档策略继续生效，但不裁剪 Workflow inner product 或 terminal answer。

规格输入：

- ordinary Message-backed process 必须继续从 Message 恢复；只有 qualified Workflow inner lifecycle/product 具有 message-free 资格。
- Workflow lifecycle Event 必须不携带业务正文；completed product Event 不得进入 Active Context、provider input、token budget 或 cacheable prefix。
- settled live 与 cold history 必须组合 Message-owned answer 和 Event-owned process 得到相同最终展示；fragment 必须在 completion/terminal 后收敛。
- retry/edit/fork 不得把 Workflow Event body 转换为 Message 或 child Active Context item。

契约输入：

- 既有 Message-first contract 及其 closed Workflow inner process Event-owned exception。
- 既有 `RunTimelineEvent`、`SessionMessage`、Active Context、run history 与 fork snapshot contract。
- 既有 Tool event/message vocabulary、structured projection validation 与 Capability Result presentation policy。

实现约束：

- 不新增 Gateway port、Record、table、migration、public Web DTO 或客户端输入字段；不要求 Workflow/API/output parser 产品方适配。
- message-free 资格只能来自受信 Workflow execution/projector identity、已定义 event type 与状态，不能由 ordinary output 自报。
- ordinary Tool/Skill/Bash/LLM/ApiCall/CLIP 的 durable owner、安全投影和容量规则保持不变。
- terminal Hook、pending input、startup recovery 和 crash takeover 行为保持不变。
- 本 change 不新增内部共享 contract；需群内确认：None。

非目标：

- terminal continuation snapshot、pending handshake、recovery cursor 或有界恢复扫描。
- 通用 structured-content 安全 classifier、单 Event payload limit、per-run aggregate budget 或 Artifact/ContentRef。
- 公共化模型正文长度或新增 canonical Tool vocabulary。
- share 过程恢复、审计级全节点 input/output、`PRODUCT_PROCESS` 展示密度配置。

验收要点：

- Direct inner nodes 无 protocol Message；Workflow-as-Tool 只有 outer pair；两种入口的 inner lifecycle/product Event 同形。
- TEXT/PIU/DSL 等 completed product 在 live 与 cold history 保持结构和顺序；临时 fragment 在 completion/terminal 后清除。
- exact same TEXT 只显示一次，但 product Event 与 terminal Message 两个 durable owner 均保留。
- 三档策略对 inner Workflow product/answer deep-equal，对 ordinary/outer Capability Result 保持既有差异。
- Event body 从模型输入和 child Active Context 排除；fork 既有 preflight 与原子失败无回归。
- backend/frontend targeted gates、strict OpenSpec 和语义审查通过，最终 diff 无 terminal recovery、通用 safety/capacity 或 Gateway/schema 扩项。

并行边界：

- 本 change 独占 Workflow product owner、inner projector 与 live/history convergence 写区。
- `tool-structured-delta` 的 stable 合并顺序固定为 `add-structured-delta-bash-apicall-identification` → `add-stream-dsl-message-type` → 本 change；该顺序只阻塞归档，不阻塞本 change 实施。
- `add-ts-workflow-event-history` 保持 blocked；后续只可重新设计审计/诊断级历史。
- terminal recovery、通用 structured 安全/容量、Gateway、database migration、share 与产品适配不在本 change 写区。

[返回 Roadmap V2](../nextagent-ts-change-roadmap-v2.md)
