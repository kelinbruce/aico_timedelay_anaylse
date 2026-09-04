## 当前实现基线（Current Baseline）

`agent-memory` 已通过 `createMemoryToolsProvider` 暴露模型可调用的 `add_memory`。工具输入经过能力 JSON Schema 校验和按类别定义的内容规范化后，由 `memory-tools.ts` 构造 `SaveLongTermMemoryRequest`，再调用既有 `LongTermMemoryToolPort.saveLongTermMemory`。可信的 `tenantId`、`subjectId` 和 `agentId` 均来自能力执行上下文。

当前保存请求固定写入 `knowledgeSourceType="CONFIGURED"`。因此，通过智能体工具调用产生的记忆与管理界面手工新增的记忆使用相同来源，无法按实际写入入口区分。

现有测试通过公开提供方发现流程和能力执行器覆盖工具输入结构、可信 scope 注入、内容规范化、保存请求及安全失败结果，但保存请求测试未断言 `knowledgeSourceType`，因此未发现该分类偏差。

`KnowledgeSourceType`、`SaveLongTermMemoryRequest`、Gateway 端口、SQLite 映射和管理接口均已支持 `LEARNED`，不需要新增字段、枚举值或包间公开契约。

## 目标设计（Proposed Design）

主要 owner 保持为 `agent-memory`。唯一实施路径是在 `add_memory` 构造既有 `SaveLongTermMemoryRequest` 时，将受信来源固定为 `knowledgeSourceType="LEARNED"`。该值由工具实现注入，模型输入结构不增加来源字段；包含 `knowledgeSourceType` 的模型输入继续因未知字段被能力输入校验拒绝。

调用链保持不变：

1. 模型在请求执行期调用 `add_memory`。
2. 能力边界校验既有输入结构，并由 `agent-memory` 规范化内容。
3. `agent-memory` 从执行上下文注入 owner scope 和 agent scope，同时注入 `knowledgeSourceType="LEARNED"`。
4. 既有 `LongTermMemoryToolPort.saveLongTermMemory` 和 Gateway 按原路径保存记录。
5. 工具按既有契约返回创建结果或安全失败。

本变更不修改管理界面手工新增路径；该入口继续按其既有受信请求写入 `CONFIGURED`。也不修改 `extraction`、`dreaming`，这些入口继续写入 `LEARNED`。来源枚举、Tool 输入输出结构、Gateway 契约、持久化结构、幂等、失败映射和观测路径均保持不变。

这项冻结行为契约调整已于 2026-07-24 完成群内确认：管理界面手工新增归类为 `CONFIGURED`，智能体调用 `add_memory` 及其他自动沉淀路径归类为 `LEARNED`，不迁移历史数据。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 来源仍由受信工具实现注入；模型不能选择来源，也不能覆盖 owner scope 或 agent scope。 | 能力输入结构负例和语义审查 |
| 性能/容量 | 只替换一个既有请求字段值，不新增查询、写入或序列化步骤。 | 定向测试与代码审查 |
| 可靠性/恢复 | 保存、幂等、取消和失败路径不变；历史记录不回填，避免引入迁移失败面。 | 既有回归测试和定向测试 |
| 可维护性 | 来源判定落在产生记录的 `agent-memory` 入口，不引入映射层、配置开关或平行 DTO。 | 架构检查与语义审查 |
| 可测试性 | 通过公开能力调用观察传给保存端口的领域请求，不依赖私有辅助函数。 | 提供方契约测试 |
| 审计/可追溯性 | 既有来源引用、能力调用和观测路径保持不变；不记录记忆原文。 | 既有观测测试与代码审查 |

## 验证策略（Verification Strategy）

- 使用提供方契约测试调用公开的 `add_memory` 能力，断言成功写入请求携带 `knowledgeSourceType="LEARNED"`，同时保留 `ACTIVE`、可信 scope 和结构化内容等既有可观察结果。
- 使用能力输入校验负例确认模型传入 `knowledgeSourceType` 时被拒绝且不会调用保存端口。
- 使用 OpenSpec 严格校验验证新增需求及场景可解析。
- 使用 `agent-memory` 定向测试、根 workspace 构建与测试、契约测试和架构检查，验证该字段调整没有改变公开契约、最小内核或包归属边界。
- 通过 `nextagent-skill-review` 和 `nextagent-code-review` 分别完成冻结行为契约与提交范围的语义门禁。

## 风险与取舍（Risks / Trade-offs）

- 变更生效前由 `add_memory` 创建的记录仍保留 `CONFIGURED`，同一列表中可能存在历史分类不一致。通过明确不迁移历史数据控制变更范围，避免无法可靠识别历史写入入口而误改用户手工数据。
- 管理界面的来源筛选结果会随新记录的分类变化，但本变更不修改任何前端行为；风险由后端定向测试和独立提交范围审查控制。

## 迁移与回滚（Migration / Rollback）

发布不需要数据库迁移或兼容窗口。新版本仅影响发布后经 `add_memory` 新建的记录。

若需要回滚，可恢复 `add_memory` 保存请求的原来源值并重新部署；已写入的 `LEARNED` 记录保持不变，不执行自动反向迁移。

## 待确认问题（Open Questions）

无。冻结行为契约调整和历史数据不迁移均已确认。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-8.2-检索和写入记忆` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/memory-tools/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
