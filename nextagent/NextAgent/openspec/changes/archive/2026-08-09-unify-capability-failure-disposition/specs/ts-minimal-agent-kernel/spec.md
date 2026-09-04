# ts-minimal-agent-kernel Delta Specification

## REMOVED Requirements

### Requirement: RequestContext 使用可恢复执行坐标

**Reason**：该 legacy Requirement 属于 `FN-11.1 恢复运行状态`，但没有定义 `maxTurns` 在 pause、resume 和 crash recovery 后连续生效所需的 logical Agent turn coordinate；继续留在最小内核还会形成第二个 recovery contract owner。

**Migration**：完整行为迁入 `local-runtime-recovery / Executing recovery 必须从 checkpoint 和 messages 重建 RequestContext` 与 `检查点记录最小 Agent turn 恢复坐标`。`RequestContext` 既有 session/request/run/identity/locale/Agent assembly/lifecycle/tool-batch/flow-variable 坐标、`attempt`/`deadlineAt`/`messageRefs` 排除项、`listCurrentRequestMessages(CurrentRequestConversationRecordQuery)` trusted-scope 查询、assistant Tool use 与 Capability result 重建规则全部保留；只在 `RequestContext` 和对应 checkpoint 增加同一个 `agentTurnIndex`。

### Requirement: 最小 Capability Tool 集合

**Reason**：该 legacy Requirement 同时定义 Capability catalog、read Tool、runtime diagnostic、Tool loop 并行/配对、request/assembly/hook 数量预算和 loop 终止，跨越多个 Functions 且包含已被当前目标替代的平行控制机制，不能继续作为 canonical Requirement。

**Migration**：完整行为按 owner 迁移：Capability 可用性、统一 invocation boundary、safe result 与结果容量由 `capability-catalog` 承载；read Tool 的 workspace-relative path、offset/limit、bounded output、safe failure 和分页结果由 `file-operation-tools` 承载；同轮调用的有界前缀接纳、受控并行、稳定 `toolCallId`、按模型顺序配对回填、失败反馈、`maxTurns` finalizing 和 model-only guard 由 `tool-loop` 承载；loop defaults 与合法范围由 `agent-package-assembly` 承载；request allow-list 由 `routing-constraint-validation` 承载；`ToolChoice` 的合并与 provider 映射由 `model-invocation-contract`、`context-engine`、`prompt-template-assembly` 和 `lifecycle-hook-execution` 承载。旧的 normal/debug `rawToolInputLogging` 分支不迁移；runtime diagnostic 继续遵守 `runtime-logging` 和仓库 coding standard 的统一 canonical `toolInput`/`toolOutput` 规则，不在 Agent loop 保留第二套开关。

### Requirement: 同轮工具调用受控并行执行

**Reason**：该 legacy Requirement 把受控并行与已删除的 request `maxToolCalls`、assembly `maxToolIterations` 和整批超限拒绝绑定，和 canonical 顺序前缀接纳目标冲突。

**Migration**：完整行为迁入 `tool-loop / maxToolCallsPerTurn 只接纳有界 Tool call 前缀`。同轮 ordinary calls 可受控并行、独立调用隔离、原 `toolCallId` 配对、按模型顺序回填、单个失败不丢兄弟结果、请求取消传播和 pending-input 互斥全部保留；数量控制改为 assembly-owned `maxToolCallsPerTurn`，超限改为只接纳前缀。

### Requirement: Tool loop recovers empty tool-name tool calls without interrupting the run

**Reason**：该 legacy Requirement 为模型空 Tool 名称建立连续纠正计数和独立终止阈值，与 `maxTurns` 作为唯一 loop-count bound 的目标冲突。

**Migration**：完整行为迁入 `tool-loop / 空 Tool 名称只产生可修正反馈`。空名称仍在 Capability resolution 前被发现，不执行或持久化无配对 assistant tool-use，继续发布 `TOOL_NAME_EMPTY` 并向模型反馈 affected toolCallIds；删除连续计数、reset 和局部失败终止，重复空名称只受 `maxTurns` 约束。单轮前缀 admission 先于空名称校验，超限与空名称事实均可被同一安全反馈完整表达。
