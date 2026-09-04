## Context

`agent-context-engine` 已在 history selection 后、预算评估前执行本地微压缩。现有实现只扫描显式白名单工具，并在候选数大于 10 时保留最近 5 条，因此不能表达 RAG 的轮次生命周期：一轮可只有一条或多条 `Rag` 结果，但一旦该轮 assistant 已完成回复，下一问题不再需要携带这些原始检索 payload。

history selector 已提供两个必要边界：`currentRequestRecords` 明确保护当前问题，`priorTurnCandidates` 只包含 canonical 完整可见轮次并按时间顺序排列。因此本变更不新增 request lifecycle 或 persistence contract，只在 Context Engine 内扫描当前问题之前的全部完整历史轮次。

## Goals / Non-Goals

**Goals**

- 每次组装新问题时，替换全部完整历史轮次内的 `Rag` capability-result payload。
- RAG 专用规则不受通用 `>10 / keepRecent=5` 策略影响，也不参与其计数。
- 同一当前问题内重复组装时重放相同替换，同时不重复提交新的 compacted id。
- 保持 canonical message、工具调用配对、消息顺序及当前问题 RAG 结果不变。

**Non-Goals**

- 不修改 RAG 检索、去重、排序、结果结构或结果数量。
- 不生成模型摘要或证据胶囊。
- 不改变通用工具白名单、阈值和最近保留窗口。
- 不新增配置、API、stream event、gateway 或数据库 schema。

## Decisions

### Decision 1: 从既有 history selection 结果识别全部完整历史轮次

扫描 `priorTurnCandidates` 的全部有序记录。selector 已排除当前 request 并过滤非完整轮次，因此微压缩器不复制 lifecycle 完整性判断；metadata 缺失时也能从当前可见完整历史确定性重建全部 RAG 替换。

备选方案是在微压缩器内重新查询 timeline 或判断 assistant terminal 状态；这会跨越 Context Engine 既有 owner 边界并产生两套完成态语义，故不采用。

### Decision 2: RAG 使用独立 eligibility rule

新增全部历史轮次 RAG 候选扫描，不把 `rag` 加入 `COMPACTABLE_TOOL_NAMES`。RAG 候选全部替换；通用候选仍独立执行原有白名单、触发阈值和最近保留规则。两组候选互不参与对方计数。

这保证单条 RAG 也能处理，同时不会意外改变 bash/read/grep/glob/write/python 等既有行为。

### Decision 3: 仅替换 model-visible payload

保留 capability result record、`toolCallId`、`toolName`、顺序和配对，只把 `result` 替换为 RAG 专用的有界确定性占位。占位不尝试摘要原文，不包含 query、知识正文或 credential。

canonical persisted message 不被改写。微压缩 state 仍只记录 compacted message ids；render 从 canonical records 重建时依据 state 重放替换。

### Decision 4: 区分“重放替换”和“新增状态”

每次 assembly 都对当前可见完整历史中的全部 RAG 重新应用投影替换，以保证预算评估看不到恢复后的原始 payload；只有 state 中尚不存在的 id 才计为 `newlyCompactedCount` 并触发 metadata 写入。

这使同一问题的多次模型/工具迭代保持相同 model-visible 上下文，同时避免无意义的重复 metadata commit。

### Decision 5: render 不把 metadata 写入成功作为正确性前提

`assemble` 必须检查 active-context metadata 的版本化写入结果；首次写入发生 `VERSION_CONFLICT` 时，读取冲突返回的最新记录，合并已持久化 ids 与本次新增 ids，并只重试一次。`NOT_FOUND`、第二次冲突或 gateway 异常沿用非阻塞降级，不使请求失败。

由于 metadata 是跨次 assembly 的幂等状态而不是本次 model-visible 投影的唯一事实来源，`render` 在重新加载 canonical records 后，必须把有效 state 中的 ids 与当前 selected history 可确定识别出的全部历史 RAG ids 合并，再重放占位符。这样即使 metadata 写入尚未成功或状态缺失，本次 `assemble → render` 仍满足全部历史 RAG 剔除；当前 request id 对应的 RAG 始终排除。

### Decision 6: 在最终 ModelMessage 投影边界校验 RAG 占位

`render` 根据本次已确定 compacted 的历史 RAG records 提取 `toolCallId`，在 `DefaultModelInputRenderer` 完成 `CAPABILITY_RESULT → TOOL/tool-result` 投影后，对对应 `tool-result.output` 再执行一次确定性占位投影。该步骤是最终模型输入不变量，不重新选择候选，不处理当前 request，也不依赖中间 record 对象的可变性。这样最终发送给模型的结构直接满足 `output.results` 已移除、`toolCallId`/`toolName` 保持不变。

## Risks / Trade-offs

- 历史 assistant 回复若遗漏关键证据细节，后续问题不能直接引用对应历史轮次的原始 RAG payload。该行为是已确认的产品取舍；后续问题仍可重新调用 RAG 获取针对当前问题的证据。
- RAG 工具名解析依赖规范化 capability-result envelope。格式非法时安全跳过，不使请求失败；边界 schema validation 仍负责阻止新的非法记录。
- 历史 state 只保存 message id，不保存规则版本。render 将依据消息当前工具名选择专用占位；由于 canonical message id 与工具结果不可变，该重放是确定性的。

## Migration Plan

无需数据迁移或 contract 升级。部署后，下一次新问题组装会按现有 active-context metadata 增量记录全部历史 RAG message ids；summary compression 仍按既有行为清理被替换历史对应的 state。

回滚时移除 RAG 专用扫描与占位分支即可；canonical message 从未被修改，不存在数据恢复步骤。

## Function 设计

### `FN-4.5 压缩转储工具结果`

- **前置条件**：history selector 已产生当前 request records 和按 canonical 顺序排列的完整 prior-turn candidates。
- **处理过程**：识别 prior candidates 的最后一个 request 分组，扫描其中全部 `Rag` results 并应用专用占位；随后独立执行既有通用微压缩策略；合并 compacted ids，重放已有替换，只对新增 ids 持久化 metadata。
- **结果**：模型看到全部历史轮次的有界 RAG 占位和当前轮完整 RAG 结果；canonical history、工具协议结构及通用工具策略不变。
- **异常语义**：非法或无法识别的 capability-result payload 被安全跳过；metadata 读取失败按空 state 重新评估；metadata 版本冲突合并最新状态并有界重试，写入仍失败时 render 从本次 selected history 确定性重放全部历史 RAG 替换。
- **可观测性**：沿用安全计数和 path 观测，不记录 RAG query、结果正文或 message id 高基数字段。

## Open Questions

无。
