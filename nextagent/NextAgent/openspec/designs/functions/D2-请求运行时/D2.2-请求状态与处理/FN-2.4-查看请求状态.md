# FN-2.4 查看请求状态

> 能力域 D2 请求运行时 · 子域 [D2.2 请求状态与处理](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 覆盖特性 | [F-2.4](../../../features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md) |
| spec | `ts-run-status-visibility` |
| 接口 | SSE / WebSocket / run event history / 会话预览 |

## 描述

查看请求的当前处理状态、关键过程、系统过程提示和 Capability 执行结果。用户既能区分已受理、执行中、等待输入、已完成、失败、已取消和被取代，也能通过受治理业务标题识别正在执行的 Capability，并以固定事实性业务语言理解处理受限与上下文整理事件；过程提示不推断请求终态或行动。无业务标题的 Workflow 内部非 runtime Capability 节点不暴露技术身份；无标题正文仅在非失败终态可见，有业务标题的节点保留实际状态。

## 前置条件

- 用户已通过可信 channel/auth boundary 建立 Owner Scope。
- 目标会话属于当前用户和智能体，目标 request/run 坐标通过校验。
- 系统已接受有效的 Capability 结果呈现策略。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| sessionId | 是 | 会话标识 |
| requestId | 否 | 限定请求标识 |
| runId | 否 | 限定运行标识 |
| Capability 结果呈现策略 | 是 | 默认级别与按精确 `capabilityId` 覆盖规则组成，不来自请求体或浏览器 |
| Capability 执行事实 | 按事件 | Capability 公开身份、生命周期状态、受支持的结果类别和安全失败事实 |
| Capability 技术目标名称 | 否 | 可选 `capabilityTargetName`，仅在 `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall` 经完整模型工具调用关联校验后由后端投影 |
| 当前有效 AICOConfig 集成名称 | 否 | 由前端从启动期 AICOConfig snapshot 与当前界面语言派生的 `${kind}:${id} → name` lookup，作为纯文本输入传入过程标题 resolver |

## 输出

- 请求状态和关键过程事件。
- Capability 结果的有效呈现级别：`STATUS_ONLY`、`SUMMARY` 或 `DETAIL`。
- 由最小公开执行身份、受治理业务名称映射和平台固定模板生成的非空 Capability 过程标题。
- `SUMMARY` 使用平台生成的语言中立 `safeSummaryCode` 与有界 `safeSummaryArgs`；`DETAIL` 只增加经 schema 校验、白名单化、脱敏和容量限制的 `safeResult`/详情文本。
- Grep 摘要按实际 `output_mode` 使用 canonical 总数；详情最多包含 50 个逻辑文件路径，内容模式只额外包含 1-based 行号，不包含匹配正文。
- Capability 步骤失败显示一条事实性原因；安全错误码、错误类别和本地化调用状态默认收起为技术详情。
- 请求终态失败只在存在可靠行动依据、且当前界面确实提供该行动或明确指导目标时显示指导。
- 请求过程包含已配置业务标题及其实际状态的步骤，以及仅属于非失败 occurrence 的无标题纯正文。
- `DEGRADATION_NOTICE`、`CONTEXT_COMPACTED` 和前端兼容 `HOOK_DEGRADED` 的固定本地化业务标题、基础摘要与 warning/info 严重程度；`DEGRADATION_NOTICE` 的显式安全技术码默认收起。

## 处理过程

1. 系统校验当前用户、智能体、会话、请求和运行坐标；校验失败时安全拒绝，不搜索其他会话或结果进行猜测。
2. 系统依据权威执行事实确定请求状态、关键过程和每个 Capability 的公开身份与生命周期状态。
3. 前端只使用该公开身份、Session-scoped Provider-backed presentation resources 和平台固定模板生成标题；名称解析按当前 locale、`en-US`、stable `displayName`、合法技术标识的固定优先级命中后停止，不借用另一语言。Presentation resources 在 Session 创建或激活时并行预取，Skill 获取成功或首次未知 identity 时合并刷新；映射未命中时回退合法 id，身份非法时使用中性标题，资源不可用时保留 last-good 或按 id 降级，不从参数、结果、模型输出或描述猜测名称。
4. 系统先确定结果类别允许的平台安全上限，再读取大小写敏感的精确 `capabilityId` 策略，采用两者中更保守的呈现级别。
5. 系统删除高于有效级别的字段；Grep 缺少实际模式、模式与字段矛盾、计数非法或详情条目不安全时降为 `STATUS_ONLY`，其他未知身份、未知结果形态、校验失败或不支持安全详情的扩展 Tool 同样不高于该级别。
6. 对于可信 Workflow 内部非 runtime Capability 节点 lifecycle，系统按 matching structured `TITLE`/`SUB_TITLE` 是否存在区分事实身份与业务标题：无业务标题时两个过程 builder 均不创建 lifecycle 步骤，matching structured detail 仅在非失败终态作为纯内容 occurrence 保留；同一 occurrence 已有业务标题时把 successful/failed/timed-out 终态合并到该标题且不生成第二个步骤；具有合法 `capabilityKind` 的 lifecycle 沿用既有规则。`show_title=true` 且 `show_content=false` 的成功节点由后端投影 body-free terminal lifecycle。
6. 实时 SSE、WebSocket 与刷新后的运行历史使用同一安全投影规则；普通会话消息不作为工具过程详情来源。
7. Capability 失败按“与错误类别相容的已知具体错误 → 完整错误类别 → 通用失败”选择唯一事实语义；信息更少的降级通知不得覆盖完整失败事实。
8. 系统按当前界面语言呈现标题与安全摘要；任何客户端不得从原始结果、工具参数或本地缓存补充名称或被策略删除的详情。
9. 降级通过提示表达，不引入新的请求状态；Capability 步骤失败不自动提升为请求终态，也不凭错误码承诺自动恢复或用户行动。
10. `Skill`、`Agent` 或普通 Tool 生命周期下的 `ApiCall` 在 `CAPABILITY_STARTED` 与同一 owner、Agent、session、request、run、tool call、Capability 的模型工具调用唯一关联时，系统从已校验的 `Skill.name`、`Agent.agentId` 或 `ApiCall.apiName` 投影 optional `capabilityTargetName`；关联无法唯一证明、值缺失或格式非法时省略该字段并保留现有 wrapper 身份和状态。Agent Web 将 wrapper 身份、合法 `capabilityTargetName` 和当前本地化状态组合为同一标题，并按同一 `toolCallId` 在后续结果与完成事件中保留已观察到的名称。
11. 普通 Agent Web 只按系统过程事件类型选择固定标题、基础摘要和严重程度，忽略任意 payload 文本及宿主配置覆盖；处理受限事实不被产品配置整体隐藏。durable `DEGRADATION_NOTICE` 与 `CONTEXT_COMPACTED` 保持 live/history 语义一致，transport notice、上下文整理短暂动画和 `HOOK_DEGRADED` 保持 live-only。

## 结果

- 已知且通过安全 schema 的结果：按有效级别返回状态、摘要或有界详情。
- Grep 成功结果：文件模式与内容模式使用各自闭合摘要；合法零匹配保留实际模式，详情只披露有界逻辑路径及允许的行号。
- 内部 Skill 内容、未知/自定义结果、非法关联或无法通过安全分类的结果：返回不高于 `STATUS_ONLY` 的安全投影。
- `search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill` 成功结果：内置基线为 `STATUS_ONLY`；集成方精确覆盖请求 `SUMMARY` 或 `DETAIL` 时，配置级别被接受并冻结，但在没有平台安全 projector 时有效级别仍为 `STATUS_ONLY`，不返回结果摘要、详情或原始字段。
- AskUserQuestion accepted answer：先经专用 bounded projector 处理，并在三种普通结果配置下保留同一公开对话事实。
- Capability 失败：三种成功结果配置下均保留同一事实性原因；技术详情不得包含原始异常、路径、参数、结果正文、provider error、credential、token 或 correlation id。
- 配置非法：应用不得进入 ready。
- 会话不存在或不属于当前用户/智能体：安全拒绝。
- completion-only 历史或关联无法唯一证明的 Capability 步骤：使用现有 wrapper 身份和状态，不从结果正文恢复或猜测目标名称。
- 无业务标题的 Workflow 内部非 runtime Capability 节点：不形成 lifecycle 步骤，非失败正文保持纯内容呈现，失败或超时 occurrence 整体隐藏；有业务标题的节点继续显示真实状态。
- 系统过程提示：三种宿主和受支持语言使用同一固定事实语义；任意 payload 文本不进入普通摘要，刷新不改变 durable 事件含义，也不重播 live-only 提示；请求终态失败总结保持独立。

## 边界

- 本功能只观察并呈现已经产生的请求与 Capability 执行事实，不发起、推进、重试或恢复执行。
- 呈现策略只控制用户界面的安全投影，不改变模型上下文、Capability 实际输入输出或请求生命周期。
- 普通用户界面不提供原始结果模式；受控开发诊断属于独立安全边界。
- 实时与历史呈现使用同一安全规则，集成配置不能突破平台安全上限。
- 业务名称只影响过程标题，不改变 Capability 身份、执行、授权、审计、结果策略或过程结构。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Capability 业务名称优先级 | 当前 locale、`en-US`、stable `displayName`、合法技术标识或中性标题降级；命中后停止查找，不跨语言借用；来源为 Session-scoped Provider-backed presentation resources（Plugin Tool、Agent package、Workflow Recipe 的 optional stable 与本地化名称经统一 Capability descriptor 输出） | `ts-run-status-visibility` / `Agent Web 必须集中维护 Capability 业务名称映射` |
| Capability 结果呈现级别 | `STATUS_ONLY`、`SUMMARY`、`DETAIL`；最终级别不得突破平台安全上限。内置基线：`STATUS_ONLY` 为 `Skill`、`Agent`、`ApiCall`、`search_memory`、`get_memory_detail`、`add_memory`、`acquire_skill`；`DETAIL` 为 `AskUserQuestion`、`TodoWrite`、`Cron`、`Rag`、`Bash`、`Python`；`SUMMARY` 为 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ToolSearch`、`Workflow`。RAG SUMMARY 只显示召回数量，DETAIL 复用既有 `ragRetrieval` 安全详情；`ToolSearch`、`Cron`、`TodoWrite` typed safe result 使用当前界面语言的专用结构呈现，无详情项且无截断事实时省略展开入口。集成方精确覆盖只替换请求级别，不突破平台安全上限 | `ts-run-status-visibility` / `Capability 结果呈现策略受平台安全上限约束` |
| 单请求最大用户可见过程步骤数 | 每个 request/run 最多 500 个过程步骤 | `ts-run-status-visibility` / `大结果历史浏览不得产生逐结果请求放大` |
| 请求终态 Hook 快照返回范围 | `REQUEST_COMPLETED`、`REQUEST_FAILED`、`REQUEST_CANCELED`、`REQUEST_SUPERSEDED` 均返回当前 request/run 的完整 `hookResults`，无 invocation 时为空数组；不可完整返回时只返回固定 `hookResultsErrorCode`，live/resume/history 使用同一 persisted terminal fact | `ts-run-status-visibility` / `请求终态同步返回 Hook 执行结果快照`、`Hook 终态快照必须保持有界完整性` |
| Capability 结果逐条附加请求 | 已加载页面内的结果进入视口、展开或离开视口时为 0 次 | `ts-run-status-visibility` / `大结果历史浏览不得产生逐结果请求放大` |
| 自动历史加载边界 | 同时最多 4 个 run；单次稳定视口最多 16 个自动目标；同一 run 最多 1 个并发请求 | `ts-run-status-visibility` / `大结果历史浏览不得产生逐结果请求放大` |
| Grep 详情安全条目上限 | 每个 `DETAIL` 投影最多 50 个文件路径或“文件路径与 1-based 行号”条目 | `ts-run-status-visibility` / `Grep 结果按实际模式生成有界安全投影` |
| 技术目标名称范围 | 仅支持 `Skill.name`、`Agent.agentId`、普通 Tool 生命周期下的 `ApiCall.apiName`；值 trim 后匹配 `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$`，否则省略字段并保留 wrapper 身份 | `ts-run-status-visibility` / `Capability 生命周期可显示受限技术目标名称`、`技术目标名称不得扩大结果披露边界` |
| 技术目标名称与结果级别独立 | 名称存在不提高 `STATUS_ONLY`/`SUMMARY`/`DETAIL` 安全上限、不创建 `safeSummary`/`safeResult`、不开放结果正文 | `ts-run-status-visibility` / `技术目标名称不得扩大结果披露边界` |
| Workflow 无标题节点可见性 | 可信 Workflow 内部非 runtime Capability 节点缺少 matching 非空 `TITLE`/`SUB_TITLE` 时不形成 lifecycle 步骤，不暴露 `nodeId`/`capabilityId`/`toolCallId`/`nodeType`；matching detail 仅在非失败终态作为纯内容 occurrence 保留；有业务标题的节点合并终态到该标题；`show_title=true` 且 `show_content=false` 的成功节点投影 body-free terminal lifecycle；live/history 一致 | `ts-run-status-visibility` / `无业务标题的 Workflow 内部节点不得显示技术身份` |
| 系统过程事件业务呈现 | `DEGRADATION_NOTICE` 与前端兼容 `HOOK_DEGRADED` 使用警告级“本次任务有部分内容未完成”语义；`CONTEXT_COMPACTED` 使用信息级“已整理较早的对话”语义；任意 payload 文本不进入标题或基础摘要，显式安全 `code` 默认收起 | `ts-run-status-visibility` / `Agent Web 系统过程事件必须使用事实性业务语言`、`系统过程事件普通界面必须限制技术信息披露` |

## 验证关注点

- 三档配置、内置默认表、精确覆盖、非法配置 fail closed。
- 全部受支持内置结果类别、Skill/ToolSearch 激活来源、可信 CLIP 与 unknown/custom 安全降级。
- Grep 文件模式、内容模式、零匹配、50 条上限、匹配正文删除及缺失或矛盾模式的 `STATUS_ONLY` 降级。
- live/history、SSE/WS、local/immersive/collaborative 等价。
- 平台/集成映射、通用入口模板、合法 id 回退和非法身份中性降级。
- 失败 code/category 联合语义、技术详情默认收起、协议标识不泄漏、无虚假行动建议。
- 三类系统过程事件的固定中英文语义、warning/info 图标、任意 payload 文本不泄漏、durable live/history 一致及 live-only 例外。
- 500 个混合工具步骤、快速预览/滚动/拖动下零逐结果请求及 4/16/同 run 去重边界。
