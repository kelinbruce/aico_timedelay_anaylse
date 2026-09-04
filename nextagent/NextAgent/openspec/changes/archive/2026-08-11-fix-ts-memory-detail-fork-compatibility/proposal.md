## Why

Agent 在一次对话中读取长期记忆详情后，用户可能无法从该回复创建分支会话。系统把记忆的内部执行来源一并放入模型可见工具结果；当来源恰好引用待复制消息前缀中的运行时标识时，会话分支的通用安全校验会拒绝复制，且不会创建子会话。该来源信息不是模型回答问题所需的记忆业务内容，却使正常的记忆使用与会话分支不兼容。

需要收窄记忆详情的模型可见边界：模型继续获得完整的分类业务内容，内部来源继续用于记忆审计和证据融合，但两者不再共用同一个对外结果。这样既不削弱会话分支对执行期引用的 fail-closed 保护，也避免记忆工具主动制造不必要的执行期耦合。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `get_memory_detail` 的新成功结果向模型提供完整的 category-specific 结构化记忆内容，但不提供内部执行来源或来源运行标识。
- 本地 canonical `toolOutput` 继续保留按 `longTermMemoryId` 关联的内部来源，维持单条 Tool 日志内的一步式运行诊断和来源定位。
- 使用上述新结果形成的完成回复能够在不存在其他不安全执行期引用时创建分支会话。
- 长期记忆仍保留完整内部来源，既有提取、证据融合、访问统计和审计能力不因模型可见结果收窄而改变。
- 会话分支继续拒绝任意消息内容中的不安全源运行引用，并保持失败时不创建部分子会话。

**非目标：**

- 不迁移、重写或读取时清理既有 `CAPABILITY_RESULT` 历史消息；包含旧结果的历史会话仍可能触发既有分支拒绝。
- 不修改会话分支的引用识别、运行标识重映射、原子写入或错误码。
- 不改变长期记忆的持久化记录、Gateway 契约、来源提取、来源融合、生命周期或 Agent Scope / Owner Scope 校验。
- 不新增独立 provenance 审计存储、审计留存期限或记忆记录物理删除后仍可恢复来源的保证；长期追溯继续受既有记忆生命周期和授权管理查询可用性约束。
- 不为模型新增 `knowledgeSourceType`、手工来源标记或其他来源摘要；如未来需要安全的来源语义，由独立 change 定义。
- 不修改回复记忆披露的引用、新增、终态提交或前端展示语义。

## What Changes

- **BREAKING**：收窄 `get_memory_detail` 的模型可见成功结果。完整 L2 详情继续包含记忆标识、分类、业务内容及既有业务状态字段，但不再包含内部来源对象或其中的 session、request、run、message、extraction cycle 等执行标识。
- 明确“完整 L2 详情”表示各记忆 category 的完整结构化业务内容，不表示完整 retained record、持久化来源或内部执行 provenance。
- 本地 canonical `toolOutput` 继续保留与 `longTermMemoryId` 关联的内部来源；该来源不再属于记忆详情的业务结果、模型可见结果或持久化 Capability Result。
- Capability result 的通用消费边界把内部来源诊断视为模型隐藏信息，同时保留其他已接受的安全 metadata；不得通过解析业务 payload 或建立 Tool 专用例外实现该隔离。
- 保留长期记忆内部来源及其审计、提取和融合用途；模型输入、durable `CAPABILITY_RESULT`、Web/stream/timeline、SafeError、audit、metric、trace 和 `ObservabilityObservationEvent` 均不得获得该内部诊断字段。
- 保留会话分支对任何不安全执行期引用的通用拒绝行为；本 change 不增加 `get_memory_detail` 专用 fork 例外。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-8.2 检索和写入记忆` → `specs/memory-tools/spec.md`
  - 功能边界：收窄模型显式读取 L2 长期记忆详情时的可见输出，同时把来源保留在模型隐藏的 Capability metadata 中供本地诊断使用；输入、逐条未命中、公共结果容量和访问副作用保持不变。
  - 系统质量属性：安全；可靠性/恢复；可测试性；审计/可追溯性。
  - 映射说明：`memory-tools` 是本次所修改工具输出行为的 canonical spec；既有 `memory-core` 映射不变且本次不触及其 Requirements。
- `FN-5.2 调用能力` → `specs/capability-catalog/spec.md`
  - 功能边界：Capability result 中的内部来源诊断只供本地 Tool 诊断使用，不进入模型或持久化结果；其他安全 metadata 的既有投影保持不变。
  - 系统质量属性：安全；可维护性；可测试性；可诊断/可追溯性。
  - 映射说明：`capability-catalog` 继续拥有 Capability result 的通用消费和模型可见投影，不把 memory record 结构或 Tool 名称带入 core。

## 影响范围（Impact）

- Agent 模型、生命周期 Hook 的 structured result、实时 Capability result delta、持久化 Capability Result 和前端投影不再观察到新 `get_memory_detail` 结果中的内部来源；本地 canonical `toolOutput` 仍在同一条日志中记录 `longTermMemoryId`、业务结果和内部来源。
- 运维人员可先从单条 canonical `toolOutput` 直接定位来源；当本地诊断不可用时，仍可在 retained record 存在且授权管理查询可用的条件下按 `longTermMemoryId` 查询 retained source。
- 依赖旧记忆详情来源字段的自定义 Hook 或原始业务结果消费者需要停止读取该字段；既有一方消费者没有该依赖，仅本地 runtime diagnostic consumer 继续获得内部来源。
- 新产生的模型可见和持久化记忆详情结果体积会减小；原始 Capability result 中的业务 payload 与诊断 metadata 继续共同受公共单结果容量约束，超限失败语义和每次读取数量上限保持不变。
- 会话分支继续使用同一通用安全规则；验收需要同时证明 canonical 新结果可安全复制，以及人为携带源运行引用的消息仍被原子拒绝。
- 实施影响集中在记忆工具输出/诊断投影、通用模型可见 Capability metadata 投影和对应测试；不需要数据库迁移、配置变更、新依赖或公共 Gateway/`agent-contracts` 变更。
