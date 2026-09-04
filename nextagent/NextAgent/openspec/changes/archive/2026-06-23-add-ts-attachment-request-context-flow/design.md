## 背景与目标

本设计只冻结附件进入 request context 的主流程与判断规则，不约束未来的具体代码组织。

第一性原则：附件只要影响当前请求回答，就必须从权威附件事实进入上下文；系统不能信任客户端副本，不能绕过 Agent Scope / Owner Scope，不能在附件缺失时把请求静默降级为纯文本执行。

目标：

- 明确触发点：提交、retry latest、edit latest 在 runtime request lifecycle 的哪个阶段触发附件校验与上下文消费。
- 明确输入：哪些对象、状态、配置、refs、预算与安全上下文是前置条件。
- 明确输出：Context Engine 产出什么安全 descriptor、首版 Markdown 受控投影、context decision、degradation evidence 或 insufficient-context outcome。
- 明确失败与降级：附件不可用、预算不足、受控投影缺失、读取失败、依赖缺失时如何显式处理。

非目标：

- 不规定附件解析器内部实现。
- 不规定 future ref/summarization/compression change 的具体存储结构。
- 不生成新的附件 summary、长期 ref 或异步预展开 job；这些能力只可作为后续 change 的输入或已存在受控替代物被消费。

## 选定方案

### 1. 主流程接入

附件 request context flow 接入以下主链路：

1. 用户提交请求、retry latest 或 edit latest。
2. `agent-runtime` 在 request acceptance 前按 owner scope 和 agent scope 解析并校验每个 `attachmentId` 的权威附件事实。
3. acceptance 成功时，runtime/session owner 把该 request 的最终附件引用集写入 immutable root user message 或等价唯一权威 message fact。
4. 只有 acceptance 成功且 durable attachment set 已落入该权威 fact 的 request 才会进入 queued / executing 生命周期。
5. `agent-context-engine` 在本次 request/run 的同步 context build 中重新读取并判定附件上下文。
6. 若 context build 成功，rendered model input 才能消费 attachment descriptor、首版 Markdown 受控内容投影，或已由其他 capability 批准的受控 ref。
7. 若 context build 失败或附件必须降级，则 runtime 按结果投影 safe failure 或 degradation notice。

这个 flow 是同步 request execution 路径的一部分，不依赖后台 job、预计算任务或异步回填结果。

### 2. 触发机制与阶段

附件 request context flow 只由以下动作触发：

- submit request
- retry latest
- edit latest

阶段顺序固定为：

1. runtime admission / acceptance 检查
2. context build
3. model invoke 前最终预算与可用性判断

其中：

- acceptance 检查负责“这个 request 是否允许携带这些附件进入生命周期”；
- root message attachment set write 负责“后续 retry/context/cleanup 到底以哪一份附件集合为权威”；
- context build 负责“这些附件在本次上下文里以什么形态参与装配”；
- model invoke 前 guard 负责“最终结果是否仍满足最低安全上下文要求”。

### 3. 输入与前置条件

要进入附件 request context flow，系统必须已具备：

- trusted channel/auth boundary 提供的 `tenantId` 和 `subjectId`
- 已接受 session/run 固化的可信 `agentId`
- request command 或 root `SessionMessage` 上的 `attachmentIds`
- 对每个 `attachmentId` 可查询的权威 `RequestAttachment`
- `RequestAttachment.validationStatus=ACCEPTED`
- `RequestAttachment.availabilityStatus=AVAILABLE`
- request 所属 `sessionId`、`requestId`、`runId`、`requestContextId`
- 当前 request 的 context budget / history budget / reserved output budget
- 当前 request 已完成 intake change 规定的附件暂存与 owner-scoped、agent-scoped 绑定

accepted request 还必须具备一份 durable、可重读的最终附件引用集：

- submit request：该集合来自当前 submit command 的全部 accepted `attachmentIds`；
- retry latest：该集合来自被 retry 的 immutable root user message；
- edit latest：该集合来自 edited request 的最终附件引用集，而不是“旧集合 + 本次新增附件”的隐式合并。

Context Engine 消费附件时，不能信任来自 command、message metadata、模型输出或 capability 参数中的附件名称、类型、大小、状态或存储引用副本；只能按 owner scope 和 agent scope 重新读取权威附件事实以及其受控投影结果。

### 4. 核心判断顺序

Context Engine 必须按以下顺序判断附件上下文，不得把关键判断留到实现阶段自由决定：

1. 读取当前 request 直接绑定的附件集合。
   - 该集合必须来自 immutable root user message 或等价唯一权威 message fact；
   - Context Engine 不得直接从瞬时 command 对象、上传入口临时状态或运行时缓存推断“最终附件集合”。
2. 读取仍然满足 visible-history 规则的历史附件集合。
3. 对每个附件重新执行 owner-scoped、agent-scoped availability / authority revalidation。
4. 判定当前装配结果中是否已经存在同一 `attachmentId` 的等价受控 Markdown 投影、excerpt 或已批准 ref。
5. 仅当附件同时满足以下条件时，才可判定为 `latest-request-critical`：
   - 该附件由当前 request 直接绑定；
   - 该附件仍满足 owner scope、agent scope、可用性和受控消费前置条件；
   - 当前装配结果中不存在同一 `attachmentId` 的等价且已保留受控替代物。
6. 若附件属于当前 request，但仅因已存在等价受控替代物而不满足 critical 条件，则判定为 `latest-request-optional`。
7. 若当前 request 绑定附件缺少受控消费前置条件且没有等价受控替代物，则不得降为 optional；若它本应属于 current request 上下文，必须显式失败。
8. 若附件只来自可见历史，则判定为 `historical`。
9. 若 owner、agent、availability、history visibility 或受控消费前置条件不满足，则判定为 `excluded`。
10. 预算决策时：
   - `latest-request-critical` 先于历史上下文竞争预算；
   - `latest-request-optional` 在不破坏 minimum safe current-request context 的前提下参与预算；
   - `historical` 只能在 prior-history budget 内竞争并允许显式降级；
   - `excluded` 不得进入 model-visible context。

### 5. 最低安全上下文

minimum safe current-request context 至少包括：

- root user message
- 当前 request 所需的协议性消息
- `latest-request-critical` 附件上下文

如果 minimum safe current-request context 本身无法被安全装配，系统必须显式返回 insufficient-context 或 safe failure，不能继续把该请求当作纯文本请求执行。

### 6. 状态与产物契约

- `request final attachment set`
  - 语义：某个 accepted request 最终生效的附件引用全集。
  - 生命周期：从 request acceptance durable write 开始，至少持续到 retry latest、history/context replay 和 cleanup 引用保护不再需要它。
  - 主承载：immutable root user message 的 `attachmentIds`，或等价唯一权威 message fact。
  - 消费方：retry latest、Context Engine、cleanup 引用保护、后续 explainability/diagnostics。
  - 安全限制：只持有 `AttachmentId`，不复制 fileName、mediaType、sizeBytes、`BlobRef` 或其它附件 metadata。

本 change 允许产生以下附件相关产物：

- `attachment descriptor`
  - 语义：供模型识别附件身份与可消费类型的安全描述，不是原始存储元数据镜像。
  - 生命周期：仅属于单次 context assembly。
  - 消费方：Context render、Model input、explainability evidence。
  - 安全限制：不得包含 `BlobRef`、本地路径、远端 SDK 句柄、原始附件内容。

- `attachment content projection`
  - 语义：首版为受控 Markdown 内容或同一附件的已存在受控 excerpt / approved ref；本 flow 不生成新的 summary 或长期 ref。
  - 生命周期：可被当次 request 直接消费；若后续 compaction / summary change 复用，必须由对应 change 定义持久化和生命周期。
  - 消费方：Context Engine、后续 summary/ref change 的受控消费入口。
  - 与原始事实关系：必须可追溯到 `attachmentId` 和本次 request context decision。
  - 安全限制：只能来自 attachment runtime 的受控投影边界。

- `attachment context decision`
  - 语义：对每个附件给出 `latest-request-critical`、`latest-request-optional`、`historical` 或 `excluded` 分类，以及 reason code。
  - 生命周期：至少覆盖本次 context build；可被 explainability / diagnostics 消费。
  - 消费方：Context budget、runtime degrade projection、测试与诊断。

- `attachment degradation evidence`
  - 语义：记录某附件为何被 summary、excerpt、metadata-only、omission 或 failure 替代。
  - 生命周期：覆盖本次 context build 和后续用户可见结果投影。
  - 消费方：observability、runtime-owned notice projection、后续 review。
  - 安全限制：reason code 与安全摘要可以暴露；原始内容、路径、blob ref 不可暴露。

### 7. 输出与副作用

成功路径输出：

- context assembly 中包含可消费 attachment descriptors
- 对必要附件包含受控 Markdown 投影或已存在受控引用
- machine-readable attachment context decisions
- 必要时包含 degradation evidence

副作用：

- runtime / context observability 记录附件分类、预算占用、降级原因和 failure 原因
- 当降级影响用户可见答案完整性时，runtime 投影 presentation-safe notice

禁止副作用：

- 不得把原始附件内容、`BlobRef`、本地路径或敏感元数据写入 safe error、stream payload、audit detail 或结构化日志
- 不得创建静默吞错的“附件缺失但继续成功”路径

### 8. 失败与降级

必须显式处理以下情况：

- acceptance 阶段查不到权威 `RequestAttachment`
  - 结果：拒绝 request command

- acceptance 阶段无法把最终附件引用集 durable 写入 root user message 或等价唯一权威 message fact
  - 结果：request acceptance 失败，不得进入 queued / executing

- acceptance 阶段 owner / validation / availability 不满足
  - 结果：拒绝 request command

- context build 阶段 `latest-request-critical` 附件不可读、过期、删除、跨 owner、跨 agent、缺失受控投影
  - 结果：insufficient-context 或 safe failure

- context build 阶段 `latest-request-optional` 附件不可用或超预算
  - 结果：显式降级，可投影 notice

- context build 阶段 `historical` 附件不可用或超预算
  - 结果：显式降级，可保留 omission reason

- 依赖缺失，例如 Markdown 之外类型尚未启用受控投影
  - 若该附件是 `latest-request-critical`：失败
  - 否则：显式降级

- model invoke 前最终预算 guard 发现 minimum safe current-request context 不成立
  - 结果：阻断 model invoke，返回 safe failure

系统不得静默截断、静默丢弃或静默吞错。

## 一致性审视

与 `establish-ts-backend-architecture` 一致：

- request lifecycle 仍由 `agent-runtime` 拥有；
- `agent-context-engine` 只负责 context assembly 与预算判断；
- `agent-attachment-runtime` 保持附件可信边界；
- channel 不拥有附件上下文生命周期。

与 `establish-ts-core-contracts` 一致：

- request command 与 `SessionMessage` 只持有 `attachmentIds`；
- owner scope 只来自 trusted channel/auth boundary；
- agent scope 只来自可信 app composition、session-bound `agentId` 或 accepted run 的 frozen agent facts；
- Context Engine 通过权威附件事实消费 descriptor / projection，不信任客户端副本；
- `BlobRef` 不进入 model-visible context。
- accepted request 的 durable attachment set 仍然只保存 `attachmentIds`，不新增平行 metadata 副本。

需要审视的现状偏差：

- 当前实现若直接消费消息内联附件元数据或在 context 侧不重查权威附件事实，将与该 change 以及 `establish-ts-core-contracts` 冲突。
- 当前实现若把附件缺失降为静默继续执行，也将与本 change 冲突。
- 当前实现若只在 render 阶段收集 descriptor，而没有在同步 context build 中完成分类、critical 保护和 budget guard，则尚未满足本 change 的目标行为。
- 当前实现若 submit/edit acceptance 没有与 retry latest 同等的附件权威回查，则尚未满足本 change 的入口一致性。

## 当前业务接入基础与最小 delta

已存在基础：

- `RequestAttachmentRecord`、`LoadAttachmentRequest` 和 `ListAttachmentsByRequestIdRequest` 已携带 `agentId`，可承载 owner + agent scoped 回查。
- runtime retry latest 已有 source attachment revalidation 入口。
- Context Engine 已有 attachment store gateway 依赖和按 request 查询 descriptor 的入口。

最小 delta：

- 将 submit request 与 edit latest acceptance 接到与 retry latest 同类的附件权威回查。
- 将 Context Engine 的 descriptor 查询前移/纳入同步 context build，产出 per-attachment decision，并把 `latest-request-critical` 计入 minimum safe current-request context。
- 首版只消费 Markdown 受控投影；其他类型缺少受控投影时按 critical failure 或显式降级处理。
- 将 degradation evidence / notice 限定为 safe reason code 和安全摘要，不输出原始内容、路径、BlobRef 或高基数字段。

## 验证映射（Verification Map）

| 约束 | 验证方法 | 优先级 |
|------|----------|--------|
| runtime acceptance 前按 owner scope 和 agent scope 校验每个 attachmentId 的权威事实 | Contract Test：验证 owner scope / agent scope 隔离，跨租户/跨用户/跨 agent 访问拒绝 | P0 |
| 只有 validationStatus=ACCEPTED 且 availabilityStatus=AVAILABLE 的附件才能进入 acceptance | Contract Test：验证状态检查逻辑 | P0 |
| latest-request-critical 附件不可用时返回 insufficient-context 或 safe failure | Contract Test：验证 critical 附件缺失的错误码和错误消息 | P0 |
| latest-request-optional 附件不可用时显式降级并投影 notice | Integration Test：验证 optional 附件降级行为和 notice 内容 | P1 |
| historical 附件不可用时显式降级并保留 omission reason | Integration Test：验证 historical 附件降级和 reason 记录 | P1 |
| Context Engine 不信任 command、message metadata、模型输出或 capability 参数中的附件信息 | Security Test：验证客户端伪造附件信息被拒绝，并验证 agent-scoped 权威回查 | P0 |
| attachment descriptor 不包含 BlobRef、本地路径、远端 SDK 句柄、原始附件内容 | Security Test：验证 descriptor 安全边界 | P0 |
| minimum safe current-request context 不成立时阻断 model invoke | Contract Test：验证 minimum context guard | P0 |
| 不得静默截断、静默丢弃或静默吞错 | Integration Test：验证所有失败路径都有显式错误响应 | P0 |
| attachment context decision 记录每个附件的分类和 reason code | Integration Test：验证 decision 日志格式和完整性 | P2 |
| attachment degradation evidence 记录降级原因和安全摘要 | Integration Test：验证 evidence 日志格式 | P2 |
| observability 日志包含附件分类、预算占用、降级原因、failure 原因 | Integration Test：验证 observability 日志格式 | P2 |

## 质量属性（Quality Attributes）

| 属性 | 需求 | 验证入口 |
|------|------|----------|
| 安全性 | 附件上下文消费必须基于 owner scope 和 agent scope 隔离，不信任客户端提供的附件元数据，不暴露 BlobRef 和原始内容 | 安全测试：跨租户/跨 agent 隔离、伪造信息拒绝、敏感信息过滤 |
| 可靠性 | 所有附件失败路径都必须显式处理，不得静默吞错；critical 附件缺失必须阻断请求 | Contract Test：验证所有错误码和错误消息 |
| 性能 | 附件上下文装配必须在同步 request execution 路径内完成，不依赖后台任务 | 性能测试：验证附件装配延迟在可接受范围内 |
| 可观测性 | 记录每个附件的分类（critical/optional/historical/excluded）、预算占用、降级原因、failure 原因 | Integration Test：验证 observability 日志格式和完整性 |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/request-attachments/spec.md`
  - 附件 request context flow 的完整行为规格
  - 触发机制、阶段顺序、判断规则、状态与产物契约
  - 失败与降级路径、安全边界、observability 要求
- 架构设计：`openspec/designs/architecture/attachment-lifecycle.md`
  - 与 runtime、context-engine、attachment-runtime 的集成设计
  - 与 attachment-intake、context-budget-explainability、large-content-references 的边界
- 模块职责：`openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-context-engine.md`、`openspec/designs/modules/agent-attachment-runtime.md`
  - runtime acceptance、durable attachment set ownership、context classification/consumption 和受控投影边界
- 导航：`openspec/designs/spec-to-design-map.md`
  - spec 到 architecture/modules/ADR/验证入口的导航

## 风险与取舍（Risks / Trade-offs）

- **风险**：同步附件装配可能增加 request acceptance 延迟
  - **缓解**：限制附件数量上限，优化附件查询性能
  - **缓解**：对 historical 附件采用懒加载策略
- **风险**：critical 附件缺失导致请求被拒绝，影响用户体验
  - **缓解**：在 attachment-intake 阶段提供清晰的错误提示
  - **缓解**：提供附件状态查询接口，让用户主动检查
- **风险**：attachment descriptor 和 projection 可能泄露敏感信息
  - **缓解**：严格的安全边界检查，不暴露 BlobRef 和原始内容
  - **缓解**：observability 日志中不记录完整 descriptor 和 projection
- **取舍**：不支持异步附件装配
  - **理由**：保持 request lifecycle 简单，避免复杂状态管理
  - **影响**：大型附件或多附件场景可能导致延迟
  - **替代方案**：不在本 change 中保留实现承诺；如未来需要异步装配，必须另提 change

## 归档前更新基线（Baseline Promotion Plan）

归档前需更新以下基线文档：

1. `openspec/specs/request-attachments/spec.md`
   - 吸收附件 request context flow 的稳定行为契约
   - 保留与 intake、cleanup、budget/degradation 的交互要求

2. `openspec/designs/architecture/attachment-lifecycle.md`
   - 记录 runtime acceptance、durable attachment set ownership、context consumption、cleanup reference protection 的跨模块流程

3. `openspec/designs/modules/agent-runtime.md`、`openspec/designs/modules/agent-context-engine.md`、`openspec/designs/modules/agent-attachment-runtime.md`
   - 更新 runtime/context/attachment-runtime 的职责、非职责和验证关注点

4. `openspec/designs/spec-to-design-map.md`
   - 添加或更新 `request-attachments` 到 architecture/modules/验证入口的导航
