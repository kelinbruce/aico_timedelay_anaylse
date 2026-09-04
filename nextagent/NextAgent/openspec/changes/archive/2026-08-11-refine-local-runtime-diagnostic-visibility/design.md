## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-7.1 输出结构化日志` | 本地 operational log 直接保留可关联的 Tool、Model 和异常定位信息 | `runtime-logging`、`runtime-execution-exception-diagnostics` | `FN-7.1 输出结构化日志` |
| `FN-6.7 脱敏` | external/observation 保持强脱敏，本地 runtime special field 只窄脱敏 credential/token | `redaction-policy` | `FN-6.7 脱敏` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `runtime-execution-exception-diagnostics` / `本地 runtime 执行异常诊断保留受控详细信息` | `FN-7.1` / `runtime-logging` | 来源 `REMOVED` + 目标同名 `ADDED` | 范围扩展到 Model 和 Web handler，取消 prompt 脱敏与 96 字符 excerpt | `agent-common` exception serializer、`agent-log` writer | 来源 spec 最终无 Requirement，归档时退役并清理导航 |
| `runtime-execution-exception-diagnostics` / `本地执行异常诊断不得扩散到产品输出面` | `FN-7.1` / `runtime-logging` | 来源 `REMOVED` + 目标同名 `ADDED` | 隔离范围扩展到 Tool/Model special field；`redaction-policy` 只引用该边界 | `agent-log` surface gate | 同上 |
| `runtime-execution-exception-diagnostics` / `模型 loop 诊断只记录安全执行元数据` | `FN-7.1` / `runtime-logging` | 来源 `REMOVED` + 目标 `本地模型调用诊断记录可定位输入输出` `ADDED` | Safe metadata 仍由 observation-derived `model.invocation.*` 承载；旧 direct first-content 行为不恢复 | `agent-core` run-bound Model owner | 同上 |

`add-ts-runtime-operational-log-hardening` 是本 change 的有序前置，其 Fastify access pair 目标由本 change 收敛为只保留 final record；两者必须按此前置顺序归档，不形成并行目标态。`add-ts-system-integration-validation-gate` 仅引用旧 capability 名称，本 change 同步为 canonical `runtime-logging`，不改变其 restricted diagnostic 规则。

## `FN-7.1 输出结构化日志`

### 目标与规范依据

依据 proposal，本 Function 使本地 operational log 可以按执行坐标直接还原 Tool、Model 和异常根因，同时不改变 canonical runtime lifecycle、客户端结果或 observation-derived trajectory。

#### 本 Function 的目标 Requirements

canonical spec：`runtime-logging`

- `ADDED`：`本地 runtime 执行异常诊断保留受控详细信息`
- `ADDED`：`本地执行异常诊断不得扩散到产品输出面`
- `ADDED`：`本地模型调用诊断记录可定位输入输出`
- `MODIFIED`：`Runtime log helpers are safe, diagnostic, and non-fatal`
- `MODIFIED`：`正常执行使用单一可关联的安全日志目录`
- `MODIFIED`：`Runtime writer 使用精确字段分类和 typed marker`

### 当前实现

- `agent-log/src/operational-writer.ts` 已区分 `runtime_diagnostic` 与 `observation_derived`，但 special raw payload 只有 `toolInput`/`toolOutput`；`rawExceptionData` 依赖 producer 手工提交。
- `normalizeCaughtFailure` 只输出安全分类、type、fingerprint 和有限 frame。Web 顶层 handler 虽提交 `err`，operational log 仍没有 message、stack 和 cause。
- `agent-common.runtimeRawExceptionData` 当前对 `prompt` key 脱敏，并把长文本压缩为短 excerpt；部分 runtime owner 手工展开其结果。
- `agent-core` Tool loop 已输出 `tool.payload.captured`，writer 会保留 raw payload，但 reserved `stepId` 未对该 direct event 放行。
- `RunBoundModelInvocation` 同时持有可信 request、run/context、normalized final result，现已写入 direct runtime payload diagnostic；其 completed timeline payload 包含 normalized usage 但没有 timing，failed payload 没有 timing 或已有 final result usage。`model.invocation.completed` 的既有 projector 可从 started event 推导总 `durationMs`，但 `model.stream.first_visible_content` 在真实异步投影顺序中可能缺少 duration，因此单条 Model terminal summary 仍不能稳定给出 usage、总时延和首次反馈时延。
- Fastify native access 原始路径为每个请求写入 `incoming request` 与一个 final record；第一轮降噪只丢弃 incoming，导致 final record 不再包含 endpoint。成功 `session.owner-scope-check` 已下沉 `debug`，Local Skill source 连续失败已去重；真实日志仍显示 `trace.span.emitted`、成功 `OBSERVE_PARALLEL` Hook、Tool 双摘要和成功 terminal 同义字段占用默认 `info`。
- 既有 tests 已覆盖 Tool raw payload、observation 隔离、异常安全投影和 Model timeline payload，但没有覆盖去 SYSTEM Model input、visible output 与通用 caught exception 自动派生。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| Tool payload 可按 step 定位 | payload 已存在，producer 未提交 `stepId` 且 reserved-field 策略会移除非可信 step | direct Tool event 需提交并可信放行 `turn-${round + 1}` |
| Model input/output 可见且不含 SYSTEM/reasoning | Model owner 只产生 safe timeline metadata | 需在唯一 run-bound owner 增加 direct payload events |
| 任意本地 error boundary 保留根因 | writer 只安全归一化，raw data 靠少数 producer 手工提交 | writer 需统一从 caught value 派生 raw data |
| exception 仅窄脱敏 credential/token | common/writer 还会脱敏 prompt，且 token 子串匹配过宽 | 两层 sanitizer 需复用精确 credential 语义 |
| external surface 不接收 special field | Tool special field 已 gated，Model special field 尚不存在 | special field 集合和 negative tests 需扩展 |
| 默认 info 保留定位信号而不重复技术状态 | HTTP 每请求两条、成功 owner check 高频重复、Skill source 相同不可用状态重复 warn | 需在各既有 owner 上收敛为 final access、失败优先和状态变化日志 |
| 第一轮降噪后 final access 仍可定位 endpoint | 丢弃 incoming 后 final 只有 reqId/status/responseTime | app 需把可信 method/route 绑定到同一个 native request logger，使其随 final record 保留 |
| 默认 info 不记录可推导的成功确认 | trace projection、纯观察 Hook、Tool preview/summary 和成功 terminal 多字段表达重复事实 | 同语义按固定级别或字段白名单收敛 |
| Tool failure entry 丢失可信 step | Tool owner 已提交 `stepId`，writer 只对白名单中的 payload event 放行 reserved step | 同类 Tool failure event 必须统一进入 trusted direct step event 集合 |
| 常见 Model Tool 协议被提前截断 | special field 继承外层 entry 的 depth，arguments/result 在预算边界提前变成 marker | special field 容量深度必须从其根值独立计数 |
| Inline credential 脱敏破坏命令形状 | assignment matcher 把闭合引号或后续参数分隔符吞入 credential value | matcher 只替换 credential value 并保留语法分隔符 |
| Model terminal summary 不自包含 usage 与完整时延 | completed 可投影 usage/推导总时延，failed 不保留 final usage，首次反馈仅依赖独立 milestone 且实际日志可能缺值 | run-bound owner 需以同一 monotonic 起点形成 terminal timing，并经安全 observation 路径投影 |

### 修改方案

唯一实现路径如下：

1. `agent-core` 的 `RunBoundModelInvocation` 成为 Model local payload 唯一 producer。它在 timeline started 后写 `model.payload.input_captured`，在 normalized final result 返回后写 `model.payload.output_captured`，在抛出前写 `model.payload.failed`。三个 event 使用 run/context/request 中的可信 correlation；logger 失败由 non-throwing helper 吸收。
2. Model input producer 只复制 request 的 `messages` 并删除所有 role=`SYSTEM` 的 message；writer 对 `modelInput` 再执行仅允许 `messages` 的白名单。Model output producer只建立 final result allowlist，不复制 `reasoning`、provider body 或 delta。
3. `agent-log` 把五个 local special field 统一到同一个 bounded raw payload sanitizer；仅 `runtime_diagnostic` 顶层允许，`observation_derived` 固定输出 policy omission/省略。Local special string 使用 16 KiB、array 使用 100 项、entry 使用 1 MiB；generic/observation 的 1 KiB string、16 项 array 和 16 KiB entry 策略保持不变。Local 超限 string 保留前缀与 marker，防止复杂输入整条退化为 `entry_too_large`。
4. Writer 在完成普通字段净化后，若 local entry 含 caught `err`/`exception`，调用 `runtimeRawExceptionData` 并再次以 raw-exception sanitizer 校验，自动设置 `rawExceptionData`。现有 producer 手工字段仍可兼容读取，但迁移触达的 owner 删除重复展开。
5. `agent-common` exception serializer 与 writer raw sanitizer 使用相同精确 key 语义：password/secret/credential/authorization/cookie，整体 token，带认证前缀的 token，以及 api-key 组合；明确保留 ref/status/count/length/tokenization。Inline 扫描只处理 key、Bearer 和显式 credential assignment，不处理路径或普通正文。
6. Tool loop 从当前 round 提交与 Model invocation 一致的 `stepId=turn-${round + 1}`；Writer 的 trusted direct step event 集合加入 Tool/Model payload event，其它 caller 仍不能伪造 reserved `stepId`。`toolOutput` 复制 result 时排除 `generatedMessages` 正文，只增加 `generatedMessageCount` 和 `generatedMessageKinds`。不修改 `agent-contracts`、公开 Model result contract、日志目的地、轮转和配置。
7. Runtime owner 的 catch diagnostic 必须提交 caught `err`；本次补齐 pending-input timeout scan，使 writer 可以统一派生 `rawExceptionData`，同时保持既有 retry/backoff/recovery code。
8. 仓库 `AGENTS.md` 的日志约束同步引用同一目标边界：local runtime special fields 允许本规格定义的有界原始内容，external/observation surface 继续禁止；不得保留与 OpenSpec 相反的旧规则。
9. `agent-log` 继续接收 Fastify native logger；`agent-app` 的 metadata-only `onRequest` hook 从可信 `request.method` 与 `request.routeOptions.url` 扩展同一个 request logger binding，writer 在丢弃 `incoming request` 后把该安全 binding 合并到唯一 final `request completed` 或 `request errored`。不得保存 raw URL、query、header 或 body，也不增加 app-owned access event、并行 access logger 或第二个 access owner。
10. `agent-session` 在 owner scope 一致时使用既有 `debug` logger，在不一致时于抛出安全拒绝前写一条带稳定 reason code 的 warn；不改变 owner scope 判定和拒绝结果。
11. 每个 `LocalSkillDiscovery` 实例只在相同 source unavailable 状态首次出现时写 warn；一次成功 source read 重置该私有状态，使后续再次不可用可以重新写一次 warn。readiness evidence 每次仍照常更新，不参与日志去重。
12. `agent-observability` 对成功 `trace.span.emitted` 和 `SUCCESS + OBSERVE_PARALLEL` 的 `hook.completed` 使用 `debug`；trace 投影失败、Hook 失败/超时/取消以及 `SERIAL_IMPACT` Hook 保持既有级别。trace confirmation 不再输出恒定实现字段 `tracerConstructor`。
13. `agent-core` direct Tool diagnostic 只保留 canonical `toolInput`、一个 `toolSafeSummary` 和已有 `toolOutput`，不再重复输出 `toolInputPreview`；Hook input 仍可内部使用现有 safe preview，不改变 Hook contract。
14. structured log projector 对完整 terminal summary 省略 `summaryStatus=COMPLETE`，只在不完整时输出 `PARTIAL`；成功 `request.completed` 省略 `TERMINAL_COMPLETED`、`details.persistence` 和 `details.terminalStatus`，保留 status、duration、usage、toolCallCount 和全套关联坐标。失败与取消诊断不收窄。
15. `agent-log` 把 `tool.call.failed`、`tool.call.result_invalid` 和 `tool.loop.repeated_failure` 与既有 Tool payload event 作为同类 trusted direct step event；只放行 runtime owner 已提交的 `stepId`，不从业务 payload 反推坐标。
16. 五个 local special field 的递归深度从各自根值独立计数，外层日志 envelope 不消耗其 6 层预算；credential assignment 的 inline matcher 以引号和参数分隔符为 value 边界，保留原命令语法。generic/observation sanitizer 的深度和脱敏策略不变。
17. `RunBoundModelInvocation` 在 started timeline event 提交后，以 monotonic clock 建立本次实际 Model 执行的唯一 timing 起点；它包装既有 `onDelta`，首次收到非空 content、非空 reasoning 或 Tool call 时只记录一次 `firstContentLatencyMs`。若没有 delta feedback、但 normalized final result 首次包含上述 feedback，则以 final result 到达时刻记录首次反馈。completed、safe failure final 与 thrown failure 均从同一起点形成 `durationMs`，且 elapsed value 统一 round 为非负整数。
18. 既有 Model completed/failed safe timeline payload 承载 run-bound timing 和 final result 已提供的 usage；timeline safe schema、mapper、internal observation sanitizer 与 structured log projector 只增加一个安全顶层 `firstContentLatencyMs` 投影。`model.stream.first_visible_content` 保留为 trajectory milestone，direct `model.payload.output_captured` 不复制 timing。该路径不新增 event、配置、metric、trace 或 public contract，也不从相邻 event 估算缺失 usage。

私有 Model payload 映射如下；所有字段 required/optional 与来源 request/result 一致，保持 JSON encoding，进入 writer 后受既有深度、字段、数组、字符串和 entry budget 约束：

| special field | trusted source / owner | 包含 | 强制排除 |
|---|---|---|---|
| `modelInput` | `ModelInvocationRequest` / `RunBoundModelInvocation` | 非 SYSTEM `messages` | `invocationScope`、`modelId`、`tools`、temperature、maxOutputTokens、topP、thinking、timeoutMs、providerOptions、所有 SYSTEM message 及其他字段 |
| `modelOutput` | `ModelFinalResult` / `RunBoundModelInvocation` | content、toolCalls、finishReason、usage、safeError | reasoning、未知字段、provider raw body、stream delta |

失败路径不引入状态：input log 失败后仍调用 Model；output/failure log 失败后仍按原路径 emit terminal timeline event 和返回/抛出。相同 Model invocation 每类 direct event 最多一次，由现有 `RunBoundModelInvocation` 实例边界保证。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `本地执行异常诊断不得扩散到产品输出面` | surface gate、SYSTEM/reasoning allowlist、credential/token 窄脱敏 | special field 外部负向用例与 credential 泄漏用例 |
| 性能/容量 | `Runtime writer 使用精确字段分类和 typed marker` | local special 使用 16 KiB string、100 项 array、1 MiB entry 和 marker；默认 info 对 HTTP、成功 owner check、纯观察成功 Hook、trace confirmation、重复 source unavailable 和同义字段使用固定降噪规则；destination 仍受 4 MiB buffer 与既有轮转限制 | 真实复杂 Model input 可见，oversized payload 有界降级，单请求 access 只有一个带 endpoint 的 final record，主流程不变 |
| 可靠性/恢复 | `Runtime log helpers are safe, diagnostic, and non-fatal` | 所有 direct helper non-throwing | sink failure 不改变 Model/Tool/terminal 结果 |
| 审计/可追溯性 | `正常执行使用单一可关联的安全日志目录` | 保留可信 run/step/invocation 坐标 | 多轮 Model 与 Tool 关联闭合 |
| 可诊断性 | `正常执行使用单一可关联的安全日志目录` | Model run-bound owner 以同一 monotonic 起点形成 terminal usage、总时延和条件性首次反馈时延 | completed/safe failure/thrown failure 单条终态日志可判断实际可得成本与响应速度 |

## `FN-6.7 脱敏`

### 目标与规范依据

依据 proposal，本 Function 不再用 external 安全投影规则裁剪 local runtime diagnostic；它仍保证 credential/token 不进入日志，并保证 raw local content 不越过产品和统一观测边界。

#### 本 Function 的目标 Requirements

canonical spec：`redaction-policy`

- `MODIFIED`：`Redaction is enforced by the shared observation boundary`

### 当前实现

- Observation 在 `ObservabilityProjectorHost` 共享边界统一净化，generic writer 还会省略 prompt/content/output/command/path/stack 等分类。
- Tool raw payload 已作为 local-only special case 使用较窄 credential key 规则，但 exception 使用包含 `prompt` 和任意 token 子串的平行规则。
- `diagnosticDetail` 不会放宽 observation surface；该不变量已有 contract/architecture tests。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| local special field 使用统一窄脱敏 | Tool 与 exception 规则不同，Model 尚无 special field | 需合并精确 credential/token 判定和 raw sanitizer |
| external 强隔离保持不变 | 现有 Tool gate 已满足 | 扩展 special field 集合后需证明 observation 仍 fail closed |

### 修改方案

`agent-log` 继续作为 structured logging、redaction 与 physical destination owner。实现只扩展现有 surface-first 分类：先判定 local special field，再执行精确 credential/token sanitizer；非 local surface 不进入该分支。Observation host、SafeError mapper、Web response、timeline schema、audit/metric/trace projector 均不修改，也不新增配置。

窄匹配规则由一个私有 helper 拥有，Tool/Model/exception sanitizer 复用；inline credential 扫描复用同一组正则。Generic observation sanitizer 继续保留原有 policy omission 与路径移除，因此 local 放宽不会改变 external 输出。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Redaction is enforced by the shared observation boundary` | surface-first 分支与精确 credential matcher | credential 必须清除，业务 token 统计不得误伤，raw field 不得越界 |
| 可维护性 | 无新增黑盒质量目标 | 删除 Tool/exception 平行敏感 key 规则，复用一个 matcher | 同形字段同策的表驱动测试 |

## 跨 Function 协作与端到端流程

`FN-7.1` 的 runtime owner 只负责提交可信 raw payload/caught error 与 correlation；`FN-6.7` 所在的 `agent-log` writer 依据 surface 决定 local special policy 或 external policy。Writer 产出的同一 physical operational file 可同时包含安全 trajectory entry 和 local diagnostic entry，但二者字段策略不可互换。完整流程以两个 Function 各自的“修改方案”为唯一局部设计来源。

## 跨 Function 质量属性设计

| 质量属性 | 影响 Functions 与规范依据 | 共享或端到端机制 | 端到端验证 |
|---|---|---|---|
| 安全 | `FN-7.1` / `本地执行异常诊断不得扩散到产品输出面`；`FN-6.7` / `Redaction is enforced by the shared observation boundary` | producer 不向 public contract 写 raw field，writer 以 surface fail closed | composition/contract test 同时断言 local 可见与 external 不可见 |
| 审计/可追溯性 | `FN-7.1` / `正常执行使用单一可关联的安全日志目录` | trusted correlation 从 runtime owner 传到 local writer | 复杂 Model→Tool→failure 日志序列按 run/step/invocation 关联 |

## 验证策略（Verification Strategy）

- Unit tests 验证 narrow credential matcher、`modelInput` 仅保留非 SYSTEM `messages`、Model output allowlist、exception cause/stack 保留、容量 marker 和 logger non-throwing。
- Contract/integration tests 从 composition 注入的 `RuntimeLogger` 观察 Tool/Model/exception entries，断言可信 correlation 与原始定位内容，而不绑定私有 helper 形状。
- Negative tests 将相同 special field 注入 observation-derived surface，断言 Web/stream/timeline/SafeError/audit/metric/trace/observation 均不可见；另用真实 credential/token 与 `credentialRef`/token count 对照验证不泄漏且不误伤。
- Characterization test 复现 Web handler 未知异常，断言客户端错误保持安全且 operational log 存在 message/stack/cause。
- Access/session/Skill discovery tests 断言默认 info 每请求只有带 method/route 的 final access、成功 owner check 只在 debug、拒绝仍有 warn、持续 source unavailable 只写一次且 readiness evidence 不变。
- Structured/trace/Tool tests 断言纯观察成功 Hook 与 trace confirmation 只在 debug、failure/impact Hook 不降级、Tool local entry 只有一个 safe summary、完整 terminal 不重复成功字段而 partial summary 仍显式标记。
- Model run-bound、timeline schema、mapper、redaction 和 composition tests 覆盖 delta-first、final-only、empty feedback、completed、safe failure final、throw-before-result 与 usage 缺失；断言 terminal timing 同源、首次反馈不晚于总时延、非法 observation timing failed closed，且 direct payload 不复制 timing。
- Architecture tests 继续证明 public contracts、projector 与 browser ownership 未增加 local raw field 依赖。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/runtime-logging/spec.md`：合并目标 Requirements。
- `openspec/specs/redaction-policy/spec.md`：刷新 local runtime exception 边界。
- `openspec/specs/runtime-execution-exception-diagnostics/spec.md`：三项 Requirement 迁移后退役。
- `openspec/designs/functions/D7-可观测与审计/D7.1-日志与审计/FN-7.1-输出结构化日志.md`：刷新处理过程、结果、规格和主规格导航。
- `openspec/designs/functions/D6-安全与治理/D6.3-交互与信息安全/FN-6.7-脱敏.md`：刷新边界与规格摘要。
- `openspec/designs/features/**/F-7.1-结构化日志.md`、`openspec/designs/features/**/F-6.6-脱敏.md`：刷新使用者可依赖的本地诊断/外部安全边界。
- `openspec/overview.md`：补充 local diagnostic 与 external observation 的系统不变量。
- `openspec/designs/architecture/observability.md`、`observability-boundaries.md`：刷新 surface 分层、调用和安全边界。
- `openspec/designs/modules/agent-log.md`、`agent-core.md`、`agent-observability.md`：刷新 owner、输入输出和验证入口。
- `openspec/designs/adr/*`：无；未新增需要独立保留的技术选型。
- `openspec/designs/spec-to-design-map.md`：移除 legacy spec 导航并更新 canonical runtime logging 映射。

## 风险与取舍（Risks / Trade-offs）

- 本地 operational log 会包含电信业务输入输出，文件读取权限与保留周期变得更重要；缓解方式是保持现有本地受限目录、固定轮转和不向远端/产品 surface 投影。
- 固定 entry budget 可能裁剪极大 payload；本 change 选择明确 marker 而非新增 blob store，避免把日志系统扩展为证据存储。仍无法定位的超大内容应由后续独立 change 评估容量，而非静默绕过限制。
- Model input 在 provider 最终变换前记录 normalized framework request，不承诺复刻 provider-native body；这是避免记录 provider credential/header 和保持 provider 隔离的明确取舍。

## 待确认问题（Open Questions）

无。
