## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-2.4 查看请求状态` | 为全部 Capability 结果建立可配置但不可突破安全上限的统一 Web 投影，并保证失败事实、live/history 与大历史浏览一致 | canonical `ts-run-status-visibility`；legacy source `actionable-execution-failure` | `FN-2.4 查看请求状态` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | delta operation | 完整行为承载与未触及内容 |
|---|---|---|---|
| `actionable-execution-failure` / `使用者失败呈现包含阶段和固定修复指引` | `FN-2.4 查看请求状态` / `ts-run-status-visibility` | 来源 `REMOVED`；目标拆分为 `ADDED` 的 `请求终态失败只在有可靠行动依据时提供指导` 与 `Capability 安全失败投影必须只陈述已确认事实` | request terminal 的阶段和有依据的恢复指导由前者完整承载；非终态 Capability 步骤的事实性原因和行动边界由后者承载；来源 spec 的安全分类与诊断原文隔离 Requirements 原位保留，来源 spec 不退役 |
| `ts-run-status-visibility` / `Capability Path Rejected Failure Visibility` | `FN-2.4 查看请求状态` / `ts-run-status-visibility` | canonical spec 中 `MODIFIED` | 保留路径策略拒绝的安全可见性、敏感信息隔离和“不单独提升为 run failure”；补充 pair-aware 规则，只有 category 为 `AUTHORIZATION` / `POLICY_DENIED` 时使用路径策略语义，冲突等其他 category 服从 category，category 缺失时安全降级为通用事实语义 |

本迁移不改变 `SafeError` shape、model/capability 错误归一化或 request terminal lifecycle。它只消除一个 Requirement 同时要求所有失败固定给指引、而用户可见 Capability 过程步骤需要只陈述已确认事实的双重权威。归档时 `actionable-execution-failure` 删除被迁移的 Requirement 并继续承载剩余两个 Requirements；相关导航改为指向 `FN-2.4` 的 canonical spec。

canonical `ts-run-status-visibility` 内的 `Capability Path Rejected Failure Visibility` 不迁移 owner，而是在同一 delta 中完整重述。归档时以本 change 的 `MODIFIED` 版本替换稳定 Requirement，避免旧版“仅凭 code 判断路径策略拒绝”与新 pair-aware 分类同时生效。

## `FN-2.4 查看请求状态`

### 目标与规范依据

本设计把单个 `Read` 展示问题收敛为一条完整的用户可见 Capability 结果投影链：canonical Message 保留模型协议事实，timeline Event 保留时序和关联，可信后端结合平台安全上限与集成策略生成唯一 Web 投影，浏览器只呈现该投影。

#### 本 Function 的目标 Requirements

canonical spec：`ts-run-status-visibility`

- `ADDED`：`Capability 结果呈现策略受平台安全上限约束`
- `ADDED`：`请求终态失败只在有可靠行动依据时提供指导`
- `ADDED`：`Capability 安全失败投影必须只陈述已确认事实`
- `ADDED`：`Capability 生命周期事件不得显示内部协议标识`
- `ADDED`：`Capability 结果的用户可见投影由可信后端统一产生`
- `ADDED`：`工具结果投影不得因 Skill 或发现来源而变化`
- `ADDED`：`大结果历史浏览不得产生逐结果请求放大`
- `MODIFIED`：`Capability Path Rejected Failure Visibility`

设计约束：本 change 不修改 `agent-contracts`、Gateway port、Gateway Record、SQLite schema、Message 写入或 timeline Event 类型集合。completion Event 只允许增加闭合集合内、版本化且非正文的可信 projector 分类控制事实；集成配置只在启动期生效，普通 Web UI 不提供原始结果模式。

### 当前实现

- `agent-runtime` / `agent-session` 把 Capability Result 保存为 canonical Message，并由完成 Event 通过 `messageId`、`toolCallId`、`capabilityId` 关联。channel 在 live 和 timeline history 中按关联 Message 解析内容，而不是把正文复制到 Event。
- `agent-channel-common` 的 `projectTimelineEventToStreamEnvelope` 和 `projectTimelineEventsToStreamEnvelopes` 是 SSE、WebSocket 和 timeline history 的共享投影入口。其 `projectSafeCapabilityResultProjection` 内置 command、file read/list/write、RAG、Todo、Cron、Workflow、Skill 和少量 upstream safe result 识别，详情上限固定为 4,000 字符、列表 50 项。
- 共享 projector 已先按 Capability 身份处理 `Skill`、AskUserQuestion 等专属类别，再进入 command/file 等受支持 schema；未知身份或无法验证的结果安全降级。
- live stream 与 timeline history 都会通过 `resolveProcessMessages` 读取关联 Message 并复用后端 projector；解析失败时已有 `contentUnavailable` 或安全状态降级。
- 普通 conversation history 已不再请求 Capability Result Message 作为过程详情来源；非 AskUserQuestion 的显式 Capability Result conversation item 也已将 public `content` 固定投影为空字符串。Agent Web 只消费 run-event history 随页返回的后端安全投影。
- Agent Web 已有 `loadRunEvents`、`loadCompleteRunProcessHistory` 和 `ProcessHistoryScheduler`：run-event page limit 为 1,000，自动加载并发上限为 4，自动目标上限为 16，同一 run 有 queue/loading/available 去重与缓存。因此 history 不需要再从 conversation Message 构造 Capability 结果。
- `DefaultSystemConfig` 由 `agent-app` 在启动期校验、冻结，并通过 `WebChannelRegistrationContext` 向 channel 注入窄 `CapabilityResultPresentationPolicy`；channel 不读取源配置。当前策略初版还包含 `HIDDEN`，缺省为 `DETAIL`，且没有内置 Capability 基线表。
- Agent Web 三种宿主复用同一 chat workspace 和 Web contract；过程详情 formatter 只消费 `safeResult`、`safeSummary`、安全失败字段和生命周期状态。
- Capability 失败摘要已经能对少量精确错误码以及 `AUTHORIZATION`、`POLICY_DENIED`、`VALIDATION`、`TIMEOUT`、`UNAVAILABLE` 类别生成语言中立 descriptor，但 `NOT_FOUND`、`CONFLICT`、`CANCELED`、`INTERNAL` 仍落入通用失败；文件完整读取前置条件、目标已变化和平台不支持等高价值原因也没有专属语义。
- 失败详情当前会再次拼接已经显示过的摘要，并把部分上游英文 `safeSummary` 直接作为正文；生命周期投影在缺少状态文字时还可能以 Event type 作为 `text` 回退，因此用户可能看到 `CAPABILITY_STARTED` 这类内部协议标识。
- 当前 `CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` 的生产失败主事实总是携带 `safeErrorCategory`；同一次失败后追加的 `DEGRADATION_NOTICE` 只携带 code，request terminal 也可能继承为 code-only。code-only 事实是现有合法生产形态，但不能覆盖信息更完整的 Capability 主事实。
- 最新 main 的 `refine-rag-tool-output-and-display` 已同时加入后端 RAG 安全 schema、前端 `ragRetrieval` guard/formatter 和从 raw conversation Message 重建 RAG 结果的兼容路径。本 change 保留并纳入统一三级策略的是后端 RAG schema、前端 bounded guard 与专属显示；其浏览器 raw Message 重建路径被后端唯一投影和 run-event history 取代，避免 RAG 成为 Message/Event 分工的例外。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 平台安全上限先于集成配置 | 身份优先、schema 白名单和取最小值的基础路径已存在 | 需要用全类别三策略矩阵固化上限、字段清除与失败降级 |
| 三级呈现策略在启动期冻结 | 策略初版为四级，缺省 `DETAIL`，用户规则不保留平台内置工具基线 | 需要移除 `HIDDEN`、把缺省收窄为 `SUMMARY`，并以精确规则叠加内置基线 |
| live/history/三宿主使用唯一投影 | live、run-event history 与普通 conversation 职责已收敛 | 需要补齐代表类别的 transport/history 等价和三宿主刷新回归证据 |
| Message/Event 职责分离 | Message 保存协议事实，Event 保存时序、关联和必要的可信 projector 分类，channel 读时生成安全投影 | 需要保证本次三策略收敛不引入 Event 正文副本或 Gateway/Message 变更，并让 CLIP live/history 使用同一可信分类 |
| Capability 失败只陈述已确认事实 | 少量错误具有专属摘要，其他错误使用通用英文；失败卡会重复摘要，既有稳定设计还把“允许重试”从类别直接推断 | 需要覆盖全部错误类别、优先识别高价值精确错误码，并禁止从错误码推断自动恢复、用户行动或请求终态 |
| 内部协议标识不作为用户文案 | 生命周期 `text` 缺失时可能回退到 Event type，未知摘要 code 也缺少统一的本地化降级契约 | 需要由后端停止生成协议标识正文，并由前端 fail closed，保证 live/history 都不会显示内部标识 |
| 大历史浏览没有逐结果请求 | 既有调度器已限制 4 并发、16 个自动目标并对同 run 去重 | 需要把 500 步容量夹具从单一自定义工具扩展为三策略与混合工具，防止后续造成 N+1 |

### 修改方案

#### 1. 启动配置与窄策略投影

`agent-app` 在现有 `nextAgent.system` 配置组中校验 spec 定义的 `capability-result-presentation`。配置 owner 仍是 `agent-app`；可信来源是 built-in default 与用户 `application.yaml` 的启动期合并结果；该配置不持久化、不热更新、不接受 request body、Agent package、Capability 参数或模型输出覆盖。

应用校验后生成私有、深冻结的 `CapabilityResultPresentationPolicy`：

```ts
type CapabilityResultPresentationLevel = "STATUS_ONLY" | "SUMMARY" | "DETAIL";

interface CapabilityResultPresentationPolicy {
  readonly defaultLevel: CapabilityResultPresentationLevel;
  readonly levelByCapabilityId: ReadonlyMap<string, CapabilityResultPresentationLevel>;
}
```

`defaultLevel` 必填于冻结对象且缺省解析为 `SUMMARY`。`agent-app` 先建立内置策略基线：`Skill`、`Agent`、`ApiCall` 为 `STATUS_ONLY`；`AskUserQuestion`、`TodoWrite`、`Cron` 为 `DETAIL`；`Rag`、`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow` 为 `SUMMARY`。AskUserQuestion 的配置只约束非 accepted-answer 的普通结果兜底，其合法 accepted answer 作为公开对话事实单独投影。已校验、大小写敏感、无重复的集成方 `rules` 再按精确 `capabilityId` 替换基线中的同名项或添加扩展 Tool 项，不改变通用 config array overlay 机制。已识别 CLIP 和没有精确规则的其他扩展 Tool 使用 `defaultLevel`，但仍受平台安全上限限制；没有安全 projector 的扩展 Tool 上限为 `STATUS_ONLY`。最新 main 注册的 `ApiCall` 是非 model-visible 的内部编排 Tool，其正常输出直接形成终态答案而不经过普通 Capability Result 卡片；显式 `STATUS_ONLY` 基线只作为共享 projector 的防御性上限，防止 HTTP response 形状在异常或兼容路径中被误识别为安全详情。

该对象的 owner 是 app composition，`agent-channel-common` 只定义并消费窄类型，不接触 `DefaultSystemConfig`。`channel-composition` 在 local configured、trusted product 和 IR Web 注册路径中都注入同一快照，避免宿主或认证分支产生不同策略。

#### 2. 一个共享的后端结果 projector

在 `agent-channel-common` 把当前若干私有 helper 收敛到一个纯函数入口，输入为已验证的 Capability 身份、结果 payload、安全失败事实和 `CapabilityResultPresentationPolicy`，输出为以下内部结果对象：

```ts
interface CapabilityResultWebProjection {
  readonly level: "STATUS_ONLY" | "SUMMARY" | "DETAIL";
  readonly safeProjection?: SafeCapabilityResultProjection;
  readonly safeFailure?: SafeCapabilityFailureProjection;
}
```

该对象不持久化。它被合入的 stream payload 只包含安全 allowlist：`resultPresentationLevel`、生命周期字段、可选 `safeSummary` 兼容回退、平台生成的 `safeSummaryCode` / `safeSummaryArgs` 以及 DETAIL 才允许的 `safeResult` / 详情文本。浏览器通过显式 `resultPresentationLevel` 区分正常 `STATUS_ONLY` 与结果不可用，不能依靠空字符串猜测策略。

平台内置 projector 产生的摘要采用语言中立 descriptor：`safeSummaryCode` 是闭合集合内稳定业务语义，`safeSummaryArgs` 由每个 code 的字段白名单、类型和长度上限生成；后端不得按 request locale 固化显示文字，也不得复制 Message 或上游 payload 伪造的 code/args。现有英文 `safeSummary` 暂作兼容 fallback。Agent Web 新增窄解析器，将 code/args 映射到现有 `zh-CN` / `en-US` i18n 资源；无效或未知 descriptor 才回退兼容文本。这样同一 live/history payload 在界面语言切换时只重新渲染，不新增请求。

投影顺序固定为：

1. 校验 Capability 身份与 Message/Event 关联；失败直接进入安全降级。
2. 先识别 AskUserQuestion 合法 accepted answer 并调用既有 bounded projector；该公开对话事实直接返回，不进入普通三档裁剪。其余结果再按身份应用安全类别规则，`Skill` 和其他专属类别必须在 command/file 等通用形状识别之前处理。
3. 只对该类别允许的 schema 执行字段白名单投影并计算平台安全上限；unknown 或 schema failure 上限为 `STATUS_ONLY`。
4. 以大小写精确 `capabilityId` 查策略，没有规则时用 default，取其与安全上限的较低级别。
5. 按有效级别清除所有更高等级字段，但每条已形成可见生命周期事实的结果至少保留 `STATUS_ONLY` 投影。失败投影单独保留既有安全 code/category/status/用户可读原因，但不携带额外详情。

| 分类结果 | 平台安全上限 | 说明 |
|---|---|---|
| 专属身份规则判定为内部内容 | `STATUS_ONLY` | Skill 正文和源路径不进入通用 file projector |
| 命中已知类别且通过该类别安全 schema | `DETAIL` | 继续使用既有字段白名单和容量上限 |
| 未知身份、未知形状、schema/关联失败 | `STATUS_ONLY` | 不复制任意字段，不猜测类型 |

`CAPABILITY_RESULT_DELTA` 不再因呈现策略返回 `TIMELINE_ONLY`；`CAPABILITY_STARTED`、`CAPABILITY_COMPLETED` 和安全失败仍遵循既有生命周期可见性。`CAPABILITY_COMPLETED` 从关联 Message 恢复结果时调用同一 projector，但只把有效级别允许的字段合入完成 payload。

CLIP 是需要执行时可信 descriptor 分类的扩展结果。`agent-core` 不再生成 Web `safeResult` 副本，而只在确认 `providerKind=CUSTOM && providerType=clip_server` 时为 live delta 和 persisted completion 写入 `resultProjectionKind=CLIP_STREAM_V1`。该跨 core、runtime、channel 持久化的闭集控制标量由 `agent-common` 单一 owning，三个消费方不得各自复制字符串常量。completion 的 classifier 与 `messageId`、`toolCallId`、`capabilityId` 一起持久化；history 取得关联 Message 后把其中 raw canonical result 与该 classifier 交给 `agent-channel-common` 唯一 CLIP projector。classifier 不进入 Web allowlist，未知 classifier 被 runtime persistence policy 拒绝；没有 classifier 的自定义结果即使伪造 CLIP 形状也只能 `STATUS_ONLY`。

AskUserQuestion 的 accepted answer 继续由现有 bounded answer projector 负责字段裁剪；共享入口在普通呈现级别之前识别并投影该公开对话事实，`STATUS_ONLY`、`SUMMARY`、`DETAIL` 三种配置返回同一 bounded answer。`USER_INPUT_RECEIVED` 继续不携带答案，浏览器也不能直接获得 canonical content。

#### 2.1 事实性安全失败投影

Capability 失败沿用 canonical `SafeError` 的开放 `code` 和九类 `category`，不为本 change 新增 Gateway、Message 或 Event 字段。共享 projector 从现有安全字段生成闭合的失败 `safeSummaryCode`。选择顺序固定为：先匹配已审计且与当前 category 一致的具体 code，category 缺失时仅允许无歧义且已审计的 code 命中专属语义；具体 code 未命中或与 category 冲突时使用当前九类 category；两者都无法确定时使用通用失败。`safeSummaryArgs` 对失败 descriptor 固定为空对象；原始异常 message、stack、路径、参数、结果正文、provider error 和 correlation id 不参与用户文案。

Capability 卡片只消费其 `CAPABILITY_RESULT_DELTA` / `CAPABILITY_COMPLETED` 的完整安全失败事实。随后出现的 code-only `DEGRADATION_NOTICE` 不参与该卡片的原因选择，也不能覆盖、降级、改写或作为第二条原因重复 code/category 联合语义。独立 code-only notice 的 code 不属于无歧义审计映射时使用通用事实性语义；request terminal 继续按其可信 terminal code 和专属 Requirement 投影。本 change 不通过事件邻接关系猜测两条事实关联，也不新增 Event 字段来建立关联。

为保持现有 Web payload 兼容，已经发布的失败 descriptor 名称不重命名；本 change 只补齐缺失项。多个底层错误允许映射到同一个用户语义，但一个底层错误在同一 projector 版本中只能命中一个 descriptor。

具体错误码映射如下；只有 category 缺失或落在表中允许的类别时才使用专属语义，其他组合进入 category 兜底：

| `safeErrorCode` | 允许的 `safeErrorCategory` | 失败 `safeSummaryCode` |
|---|---|---|
| `COMMAND_NOT_ALLOWED` | `AUTHORIZATION`、`POLICY_DENIED` 或缺失 | `CAPABILITY_RESULT_FAILURE_COMMAND_NOT_ALLOWED` |
| `CAPABILITY_INPUT_INVALID`、`INVALID_INPUT` | `VALIDATION` 或缺失 | `CAPABILITY_RESULT_FAILURE_INVALID_INPUT` |
| `CAPABILITY_PATH_REJECTED` | `AUTHORIZATION`、`POLICY_DENIED` | `CAPABILITY_RESULT_FAILURE_PATH_REJECTED` |
| `CAPABILITY_RESULT_LIMIT_EXCEEDED`、`RESOURCE_TOO_LARGE` | `VALIDATION` 或缺失 | `CAPABILITY_RESULT_FAILURE_TOO_LARGE` |
| `WRITE_REQUIRES_FULL_READ`、`EDIT_REQUIRES_FULL_READ` | `CONFLICT` 或缺失 | `CAPABILITY_RESULT_FAILURE_FULL_READ_REQUIRED` |
| `WRITE_TARGET_CHANGED`、`EDIT_TARGET_CHANGED` | `CONFLICT` 或缺失 | `CAPABILITY_RESULT_FAILURE_TARGET_CHANGED` |
| `PLATFORM_UNSUPPORTED` | `UNAVAILABLE` 或缺失 | `CAPABILITY_RESULT_FAILURE_PLATFORM_UNSUPPORTED` |
| `INTERPRETER_UNAVAILABLE`、`SANDBOX_UNAVAILABLE` | `UNAVAILABLE` 或缺失 | `CAPABILITY_RESULT_FAILURE_UNAVAILABLE` |

`EXECUTION_FAILED` 会被现有 Agent、Workflow、ApiCall、Skill、ToolSearch 和 RAG 以 `VALIDATION`、`UNAVAILABLE`、`CANCELED`、`INTERNAL` 多种 category 使用，不能拥有覆盖 category 的专属映射。`CAPABILITY_PATH_REJECTED` 在 workspace Skill 投影冲突中也可能携带 `CONFLICT`；该组合必须显示状态冲突语义，不能误报为安全策略拒绝。所有类似一码多类的 code 都按同一规则由 category 决定。

九类 category 的兜底必须穷尽：

| `safeErrorCategory` | 失败 `safeSummaryCode` |
|---|---|
| `AUTHORIZATION`、`POLICY_DENIED` | `CAPABILITY_RESULT_FAILURE_POLICY_DENIED` |
| `VALIDATION` | `CAPABILITY_RESULT_FAILURE_VALIDATION` |
| `NOT_FOUND` | `CAPABILITY_RESULT_FAILURE_NOT_FOUND` |
| `CONFLICT` | `CAPABILITY_RESULT_FAILURE_CONFLICT` |
| `UNAVAILABLE` | `CAPABILITY_RESULT_FAILURE_UNAVAILABLE` |
| `TIMEOUT` | `CAPABILITY_RESULT_FAILURE_TIMEOUT` |
| `CANCELED` | `CAPABILITY_RESULT_FAILURE_CANCELED` |
| `INTERNAL` | `CAPABILITY_RESULT_FAILURE_INTERNAL` |
| 缺失或不受支持 | `CAPABILITY_RESULT_FAILURE` |

Agent Web 使用闭合 descriptor 映射到两段用户语义：简短状态标签和事实性原因。既有 descriptor 和新增 descriptor 的目标显示如下；相同用户语义可以复用同一 i18n 文案：

| 失败语义 | 状态标签 | 默认原因 |
|---|---|---|
| 输入无效或校验失败 | 未能执行 | 本次工具输入未满足执行要求。 |
| 修改前未完整读取 | 未能完成 | 修改文件前需要先完整读取最新内容。 |
| 目标已变化 | 未能完成 | 文件在处理期间发生变化，本次修改未应用。 |
| 对象不存在 | 未找到 | 未找到本次操作所需的对象。 |
| 命令、路径或策略拒绝 | 已阻止 | 当前安全策略不允许执行该操作。 |
| 平台不支持 | 无法执行 | 当前运行环境不支持此能力。 |
| 依赖不可用 | 暂不可用 | 执行所需能力当前不可用。 |
| 超时 | 已超时 | 未在规定时间内完成。 |
| 取消 | 已取消 | 该步骤已取消。 |
| 状态冲突 | 未能完成 | 当前状态与操作要求不一致。 |
| 结果过大 | 结果不可展示 | 返回结果超过安全展示范围。 |
| 内部异常 | 系统异常 | 系统处理该步骤时出现异常。 |
| 通用兜底 | 未能完成 | 该步骤未能完成。 |

失败卡片默认只显示 Capability 公开身份、失败状态标签和一条事实性原因，不重复“执行结果：原因”。常显事实原因使用过程正文层级，而不是工具标题/状态的紧凑元数据层级；它与执行说明保持相同字体族和行高体系，同时通过字号、次级颜色和所属步骤缩进保留层级差异，避免 13px 元数据样式让关键失败事实显得像弱提示。用户主动展开技术详情后，最多显示现有 `safeErrorCode`、`safeErrorCategory` 和由结构化状态渲染出的本地化调用状态标签；原始内部状态枚举、`safeSummaryCode`、`safeSummaryArgs` 与 Event type 永远不是用户文案。`STATUS_ONLY`、`SUMMARY`、`DETAIL` 只控制成功结果披露，不删除失败原因，也不使失败技术详情获得更多原始内容。

错误码只说明已发生的失败，不足以证明下一步一定发生什么。失败卡片不得据此显示“系统将继续处理”“系统正在重新读取”、自动重试承诺或用户操作建议，也不得仅根据 `SafeError.retryable` 生成 Capability 级 CTA。只有系统另外产生 AskUser 输入请求、显式上传要求、可重试的 request terminal control 或已配置授权流程时，对应 owner 才能显示其专属交互；模型后续选择 Read、重试其他 Capability 或输出最终答案时，界面按新产生的过程事件或 Assistant Message 自然呈现，不回写旧失败为“已恢复”。

#### 2.2 请求终态失败的可行动投影

request terminal failure 与非终态 Capability 步骤失败是不同的用户决策点。前者已经停止本轮处理，可以继续使用可信 terminal event、稳定 model/runtime code、category 和 retryable 判断失败阶段；后者不能据此推断整轮请求已经停止。三个宿主复用同一终态解释器。

已知 model terminal 失败继续保留现有有依据的指导：认证失败指向检查模型凭据或联系有权限的管理员，模型不存在指向检查模型配置，限流或网络失败只有在 request retry control 可用时才提示重试。内部错误、未知 code 或当前用户没有可执行动作时只显示事实原因和默认收起的技术详情，不生成虚假的修复建议。稳定错误码可进入终态技术详情，但不能作为主文案；阶段仍只由 terminal event 与稳定 code 决定。

本 change 不修改任何终态 code/category/retryable、请求级 retry control、用户权限或模型恢复策略，只把既有呈现 Requirement 从混合 legacy spec 迁入 `FN-2.4` 并明确动作成立条件。

#### 2.3 生命周期协议标识的显示边界

共享 projector 不再把 Event type 作为 `payload.text` 的缺省值。`CAPABILITY_STARTED` schema 只允许 Message 关联、Capability / tool call / step 身份和批次状态，不定义受治理的安全业务说明字段；因此 Agent Web 对该事件始终只使用结构化身份和状态，并在输入归一化与过程投影两层忽略任何不属于受治理字段的自由文本。模型在工具调用前生成的公开执行说明继续由 `ASSISTANT_TOOL_USE` Message 关联的 `LLM_CONTENT_DELTA` 单独投影，不能并入启动事件。`CAPABILITY_COMPLETED` 只有经可信后端结果 projector 形成的安全字段可以进入结果显示；没有可显示说明时允许省略说明，不能显示协议常量。Agent Web 的输入归一化还拒绝把 Event type、`safeSummaryCode` 或其他已知内部枚举当作自由文本，形成 fail-closed 防线。

该规则同时适用于 live 与 history。未知失败 descriptor 不回退显示 descriptor 本身或上游英文文本，而是使用当前界面的通用失败文案；安全错误码和类别只有在用户展开技术详情后才可见。

#### 2.4 Skill 激活工具与调用来源不变式

Skill manifest 的 `allowed-tools` / `tools` / `metadata.denied-tools` 只产生 Capability 约束事实，不定义新 Tool 实现或新结果投影身份。Skill 执行产生的 context patch 必须通过现有 Capability Catalog 解析到可用、Tool-kind 的 descriptor；后续执行和 timeline 使用 descriptor 的实际 `capabilityId`。

共享 projector 不接收 Skill id、激活来源或调用路径作为策略选择输入。同一 Tool 直接调用、经 Skill `allowed-tools` 激活、经 ToolSearch 激活或经其他受治理路径调用时，必须使用相同的 `capabilityId`、平台安全上限、集成级别和字段白名单。Skill 引用的内置 Tool 复用该 Tool 现有 projector；扩展 Tool 只有在后端存在按身份受控、schema 校验和容量限制的安全 projector 时才能达到 `SUMMARY` 或 `DETAIL`，否则无论配置请求级别为何都降级为 `STATUS_ONLY`。

Skill 引用不存在、非 Tool-kind、未绑定或无授权的 Capability 时，由现有 Capability 治理拒绝激活或执行；channel 只可投影已产生的安全失败事实，不得伪造成功结果卡或回退解析 Skill 内容。

#### 3. conversation 与 process history 恢复单一职责

Agent Web 的普通 conversation 请求把 `includeCapabilityResults` 改为 `false`，message page 只承担用户/助手消息、可见终态和既有 AskUserQuestion compatibility；Capability 过程详情只通过现有 run-event history 加载。`conversationAdapter` 删除从 raw `content` 调用 `buildSafeCapabilityResult` 的产品路径，不新增 `capabilityResultProjection` 或另一套 conversation DTO。

`agent-channel-web` 保留 `includeCapabilityResults` query 和 item shape 的兼容解析，但把非 AskUserQuestion Capability Result item 的 public `content` 固定投影为空字符串，并对该角色的 metadata 使用严格 allowlist，删除其他 raw payload 或工具参数复制入口；这是 proposal 已标记的 Web 行为 breaking refinement，不修改 `agent-contracts` 类型或 Message 持久化。AskUserQuestion 现有 `pendingInputAnswer` compatibility 保持其 stable spec 约束，不扩大到其他工具结果，也不由普通工具 formatter 消费。

只读 share 只承载完整请求单元中的用户问题与最终 Assistant Message。`ConversationShareService` 在继续使用 canonical Message 验证请求单元完整性后，排除普通 `CAPABILITY_RESULT` Message，不把其 content 或 metadata 放入 `SharedConversationPage`；durable Message 不变，share 也不从 raw result 重建过程详情。

run-event history 已经在服务端调用共享 projector，保持现状，只增加同一 policy 参数。每个最多 1,000 events 的页面一次返回全部安全投影；现有 `ProcessHistoryScheduler` 继续执行 4 并发、16 自动目标、同 run 去重和缓存。浏览器进入视口、展开详情或快速滚动时允许按 run/page 加载尚未取得的 event history，但不调用逐结果详情 API，也不为已完成或正在加载的同一 run 重复发起请求。

#### 4. 明确不修改的边界

- canonical Capability Result Message 的内容、`visible`、模型上下文装配和工具协议不变。
- Tool Loop 在失败后的下一模型轮次、model fallback、Capability retry/recovery 和 request terminal 判定不变；投影层不得创造或推进这些行为。
- timeline Event 继续只保存时序、状态、`messageId`、关联坐标和必要的闭集可信 projector classifier，不复制结果正文、安全摘要或详情。
- `RuntimeSessionPort.resolveProcessMessages`、Gateway port/Record/table/transaction 不变；Gateway 只按既有 bounded scope 返回关联 Message。
- StreamEventType、`safeResult` 既有 kind、SSE/WS transport 和 Agent Web formatter 结构不因配置而增加平行版本；`safeSummaryCode` / `safeSummaryArgs` 是同一投影中的语言中立摘要语义，不是第二套结果 DTO。
- 开发工作台的受控 raw diagnostics 不复用普通 Web policy，也不能通过该配置启用。

实施不得引入 `agent-contracts` DTO、平行详情 API 或 Event 结果正文副本。app-private StreamEnvelope payload 的 `resultPresentationLevel`、`safeSummaryCode` 和 `safeSummaryArgs` 只允许通过共享 projector allowlist 产生。

#### 备选方案（Alternatives Considered）

1. **在 Event 中复制一份用户可见结果。** 优点是 history 无需关联 Message；缺点是 Message/Event 双写、策略变化后旧 Event 无法统一重投影、raw 与 safe 内容容易漂移，并增加持久化与 Gateway migration。未选择。
2. **Message 与 Event 分开保存完整内容，前端分别解析。** 隔离表面清晰，但把安全判定下放浏览器，live/history 必须维护多份 parser，无法在传输前阻止泄露。未选择。
3. **按需详情 API。** 可延迟处理大结果，但会让滚动、展开和多轮历史产生 N+1 请求，并引入新的授权与缓存一致性边界。当前 4,000 字符/50 项安全投影足以满足本 change，未选择。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Capability 结果的用户可见投影由可信后端统一产生` | 身份优先分类、字段白名单、安全上限、服务端投影、raw Message 不出 channel | Skill/file 形状碰撞、unknown/custom、非法关联和浏览器 payload negative tests |
| 可靠性/恢复 | `Capability 结果的用户可见投影由可信后端统一产生`、`请求终态失败只在有可靠行动依据时提供指导`、`Capability 安全失败投影必须只陈述已确认事实` | live 与 run-event history 使用同一纯 projector 和同一冻结策略；conversation history 不再形成第二条结果详情路径；步骤失败不虚构恢复，请求终态只给可兑现的行动 | 刷新、SSE/WS、三宿主、关联缺失降级、终态指导和失败后实际下一步等价 |
| 性能/容量 | `大结果历史浏览不得产生逐结果请求放大` | 策略冻结为 exact-match map；每页服务端批量关联既有 Message；复用 4 并发/16 自动目标调度与同 run 去重；浏览器零逐结果 fetch | 500 步、多轮、预览跳转和快速滚动的请求计数、并发上限及交互流畅性 |

## 验证策略（Verification Strategy）

验证使用分层矩阵，不在浏览器层穷举所有组合：

1. **配置 unit 矩阵**：只接受 `STATUS_ONLY` / `SUMMARY` / `DETAIL`，`HIDDEN` 和其他未知值必须阻止 ready；验证 `SUMMARY` 缺省值、内置策略基线、exact case-sensitive 覆盖只替换同名项、扩展 Tool 规则可添加，以及重复/未知/越界输入。
2. **共享 projector contract 矩阵**：对 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`Python`、`ToolSearch`、`Workflow`、`TodoWrite`、`Cron`、`AskUserQuestion`、`Rag`、`Skill`、`Agent`、`ApiCall`、已识别 CLIP 和 unknown/custom 执行数据驱动的三策略断言；每个已支持结果类别覆盖 success、safe failure 和 invalid shape，带正文或列表的类别再覆盖 empty、truncated、over-budget 和敏感字段 negative case。安全失败矩阵覆盖全部九类 category、设计列出的已审计 code/category 组合、一码多类冲突、未知 code、category 兜底、空参数、同 request 的 code-only degradation 不覆盖完整 Capability 失败，以及三策略原因等价；平台内置摘要同时覆盖 code/args 白名单与中文/英文渲染。AskUser accepted answer 覆盖三档等价；CLIP 覆盖可信 classifier 与伪造形状降级。`ApiCall` 用例只验证其内部 HTTP 结果无法突破 `STATUS_ONLY`，不把它塑造成普通结果卡片。
3. **调用来源 contract 矩阵**：同一内置 Tool 直接调用与经 Skill 激活的投影完全相同；没有安全 projector 的 Skill 激活扩展 Tool 在 `SUMMARY` / `DETAIL` 下均降级为 `STATUS_ONLY`；有受控 projector 的扩展 Tool 覆盖三策略；不存在、非 Tool-kind、未绑定和未授权引用只产生安全失败。
4. **transport/history contract 矩阵**：用文件、搜索、命令、结构化业务、编排、交互、受限、CLIP 和 unknown 各一个代表结果验证 live/run-event history、SSE/WS 等价，Message 关联错误不猜测回退；CLIP history 使用真实 completion + Message fixture，禁止伪造持久化 result delta。
5. **frontend unit 矩阵**：覆盖三种黑盒呈现：`STATUS_ONLY` 无成功摘要/详情入口，`SUMMARY` 只显示当前界面语言的安全摘要，`DETAIL` 可展开安全详情；同时覆盖进行中、成功、失败、空结果和截断结果，且 adapter 不得从 raw Message 重建详情。失败在三种配置下都显示同一事实性原因，默认技术详情收起且不重复原因；覆盖内部 Event type、未知 descriptor、上游英文 summary 与敏感字段的 negative case。正常 status-only completion 必须与 content unavailable 区分，活跃 status-only 步骤仍显示活动态。
6. **e2e 风险旅程**：三种策略各选一个可视工具，另覆盖 Read/Skill 形状碰撞、AskUserQuestion、Skill 激活 Tool、live 刷新后 history 以及 local/immersive/collaborative 共享行为。
7. **capacity/e2e**：构造 500 个混合工具过程步骤和多轮会话，三种策略、内置/Skill 激活/扩展工具混排；记录打开、预览跳转、滚动条拖动、滚轮快速滚动、滚动条点击期间的网络请求，断言结果详情额外请求为 0、run history 并发不超过 4、自动目标不超过 16 且同 run 无重复请求。
8. **integration/architecture/review**：通过 app composition 证明同一冻结策略进入 local configured、trusted product 和 IR channel 注册；确认 `agent-contracts` 与 Gateway 均无 delta，frontend 未获得配置源或 raw Message，share/conversation 不泄露结果正文或 metadata，长期安全规则没有复制到工具专属组件。

### 本地人工验收夹具

`agent-web-mock-server` 增加单次请求控制 `capability-presentation`，只用于人工观察本 change 的黑盒呈现，不新增生产事件类型、配置字段或前端分支。输入 `[mock:capability-presentation delay=300 terminal-delay=3000] 验证工具结果展示策略` 后，同一 request 先依次产生五个具有既有事件形状的成功完成步骤：unknown/custom `STATUS_ONLY` 只含 Capability 身份和状态，前端不得为正常成功结果补写“暂无摘要”或提供空详情入口；`Read` 与 `Rag` 的 `SUMMARY` 分别使用与真实文件读取、检索 projector 同语义的安全摘要但没有详情；普通 `Bash DETAIL` 含安全摘要和未截断的有界 `safeResult`/详情文本；长输出 `Bash DETAIL` 单独携带截断后的白名单预览及截断标记。随后夹具再产生四个已经由可信后端投影的失败完成步骤，分别覆盖写入前未完整读取、平台不支持、完整 category 兜底和未知语义通用兜底，最后追加一个真实成功 `Read` 步骤，证明失败卡片不承诺恢复且后续实际动作作为新事实呈现。长详情夹具同时保留仅服务端可见的超过上限源数据与敏感哨兵，但发送给浏览器的既有 safe projection 不得包含敏感哨兵；失败夹具只携带已投影的 code、category 和语言中立摘要语义，不在 mock 中复制生产错误映射算法。

mock-server 必须把同一组安全事件保存在其既有 session event history 中，使 live 完成后刷新页面仍显示等价的三档结果；不得通过 conversation raw Capability Message 重建详情。默认 `contract-suite`、真实后端路径和其他 mock 控制保持不变。该夹具验证“浏览器如何消费已治理投影”，不声称在 mock-server 内再次实现或验证后端策略选择算法；后端策略正确性仍由配置、projector 和 transport contract tests 负责。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/ts-run-status-visibility/spec.md`：合并本 change 新增 Requirements 和 Function 元数据，成为 request terminal 与 Capability 步骤用户可见失败呈现的唯一 canonical spec。
- `openspec/specs/actionable-execution-failure/spec.md`：删除已原子迁移的 `使用者失败呈现包含阶段和固定修复指引`，保留安全分类和开发诊断原文隔离 Requirements。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：刷新输入、输出、处理过程、结果和容量指标。
- `openspec/designs/features/D2-请求运行时/D2.2-请求状态与处理/F-2.4-查看请求状态.md`：补充用户可依赖的安全详情与 live/history 等价保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/stream-projection.md`：补充 Capability Result 的 Message/Event/安全投影职责、平台安全上限和策略应用顺序。
- `openspec/designs/architecture/configuration-boundary.md`：补充启动期呈现策略的配置 owner、冻结和窄投影边界。
- `openspec/designs/architecture/conversation-process-history.md`：补充 conversation message 与 run-event process history 的职责分离、统一服务端投影与容量规则。
- `openspec/designs/architecture/conversation-ui-state.md`：把按错误类别推断重试建议的旧表刷新为事实性失败语义、默认收起的安全技术详情和明确交互来源。
- `openspec/designs/modules/agent-channel-web.md`：补充 conversation item 安全投影和 raw Message 禁止边界。
- `openspec/designs/modules/agent-web.md`：补充浏览器只消费服务端 projection 的职责。
- `openspec/designs/modules/agent-app.md`：补充配置校验与窄策略注入。
- `openspec/designs/modules/agent-common.md`：记录跨 core/runtime/channel 使用的持久化结果分类标量由 common vocabulary 单一 owning。
- `openspec/designs/adr/`：无；选择沿用既有 Message-first projection 决策，不新增独立架构原则。
- `openspec/designs/spec-to-design-map.md`：为 `ts-run-status-visibility` 增加上述长期设计和验证入口导航。

## 风险与取舍（Risks / Trade-offs）

- Capability 过程失败不再显示仅凭错误码推断的固定操作建议，信息量比旧卡片更克制；换取的是不误导用户。真正可执行的 Read、重试、AskUser、上传、授权或最终处置继续由各自的显式过程事实和交互 owner 呈现。
- 默认 `SUMMARY` 及内置精确覆盖会收窄部署未显式配置时的详情展示；这是最小必要披露的目标行为，通过配置样例和三策略黑盒测试降低集成误解风险。
- 普通 Agent Web 不再请求 conversation Capability Result 可能让 process detail 在 run-event history 尚未加载前短暂只显示生命周期摘要；复用现有 viewport/preload scheduler，并通过显式展开优先级和 history e2e 保证可恢复。
- exact `capabilityId` 规则简单且确定，但大量动态自定义工具需要逐项配置；首版以 256 条上限、`SUMMARY` default level 和 unknown `STATUS_ONLY` 安全上限控制复杂度，通配符/类别策略另行立项。
- history 读时投影会消耗 CPU，但避免重复持久化和 N+1；共享纯 projector、O(1) 策略查找及既有 page/message batch 边界控制成本。

## 迁移与回滚（Migration / Rollback）

该 change 没有数据迁移。部署时应用配置、后端 channel 与同版本 Agent Web artifact 必须一起发布；未提供该配置时使用内置 `SUMMARY` 默认和工具策略基线，集成方规则只按精确 `capabilityId` 覆盖基线同名项或添加扩展项，已配置 `HIDDEN` 必须在升级前改为 `STATUS_ONLY`。如果 run-event history 暂时不可用，前端必须安全降级为生命周期状态，不能回退请求或解析 raw `content`。

回滚触发条件是 conversation/history 兼容测试或安全回归失败。回滚代码与配置后，Message/Event/Gateway 数据仍保持原状；回滚验证必须确认旧版本能读取既有会话，同时不得把新版本已经清空的 Web response content 误认为持久化数据丢失。

## 待确认问题（Open Questions）

无。
