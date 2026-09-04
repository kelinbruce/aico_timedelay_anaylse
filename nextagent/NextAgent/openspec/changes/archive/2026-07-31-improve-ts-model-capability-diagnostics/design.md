## 当前实现基线（Current Baseline）

### 现有调用链与边界

- `agent-core` 通过稳定 `ModelInvocationService` 调用 `agent-model`。`OpenRouterModelInvocationService.complete()` 和 `stream()` 在 provider adapter 内捕获 SDK/transport/normalization failure，并把异常交给 `ModelErrorNormalizer` 或少量固定分支。
- `ModelErrorNormalizer` 只保留已有 error-like 对象的 code/category/retryable；其余异常统一映射为 `MODEL_INTERNAL_ERROR`。上层 `RunBoundModelInvocation` 只能把 SafeError code/category 写入 canonical `MODEL_INVOCATION_FAILED`。
- `agent-core` 通过 `CapabilityInvocationPort` 调用 `agent-capability`。`BuiltinToolsExecutor` 在执行前校验 input schema，在执行后校验 output schema；unknown exception 被 catch 后只记录 `errorName` 并返回 `CAPABILITY_EXECUTION_FAILED`。
- `agent-core/tool-loop` 对仍然抛出的 Tool invocation/result validation exception 使用 `runtimeRawExceptionLogFields`，并在 `diagnosticDetail=debug` 时把 bounded、credential-redacted `toolInput` 写入 runtime diagnostic。executor 已转换成普通 failure result 的异常不会进入这条 catch。
- `agent-runtime` 在 request execution termination boundary 对未知或 INTERNAL exception 记录 `request.execution.exception_captured`；它无法恢复 model/capability owner 已丢失的 provider/implementation error。
- `agent-log` 是 operational writer，统一执行字段净化、异常投影、16 KiB entry budget、destination buffer 和 sink lifecycle。普通字段使用 `FORBIDDEN_KEY` 子串正则；`toolInput` 与 `rawExceptionData` 使用专用净化分支。
- `agent-observability` 已把 canonical timeline 和 observed context/sandbox boundary 投影为同一 operational file 中的 observation-derived正常轨迹，包含 `request.accepted/completed`、`policy.allowed`、`context.assembly.completed`、`model.invocation.started/completed`、`model.stream.first_visible_content`、`capability.started/completed` 和 `sandbox.execution.started/completed`。
- `agent-plugin-sdk/developer-hook-trace` 已通过 `BEFORE_MODEL_INVOKE`、`AFTER_MODEL_RESULT`、`BEFORE_CAPABILITY_INVOKE`、`AFTER_CAPABILITY_RESULT` 等既有 lifecycle hook boundary 捕获 raw input/output。当前 model SafeError result 与 Capability `FAILED/TIMED_OUT` result 不触发对应 AFTER hook，因此失败路径只有 BEFORE raw input boundary；该 artifact 由 caller-owned sink 写入，默认不 activation，也不属于 operational writer。
- Web process/failure presentation 已从 stream/history 读取 safe code/category，并按有限 code map 显示本地化原因。未映射 code 退化为 category 或 generic 提示；当前没有统一失败阶段和固定修复动作映射。

### 当前验证

- `agent-model` provider tests 覆盖 complete/stream、timeout、abort、tool argument normalization 和 generic SafeError。
- `agent-capability` tool framework tests 覆盖 input/output schema failure、declared Tool failures、unknown exception 和 safe diagnostics。
- `agent-log` runtime logger tests 覆盖 credential/path redaction、`toolInput`、`rawExceptionData`、entry budget 和 non-throwing behavior。
- `agent-plugin-sdk` tests 覆盖六个 developer hook stage、raw boundary promotion、caller-owned file sink 和 packaged artifact。
- `agent-web` failure/process tests 覆盖 safe code/category 提取、错误码显示与 live/history projection。

### 已知 gap

- Model provider status/error code 的分类不完整，且 unknown exception 在 adapter 内归一化后不再有安全异常 fingerprint。
- Capability unknown exception 在 executor 内转换后，外层只得到通用 failure result；现有受控 execution exception diagnostic 没有命中。
- `BuiltinToolsExecutor` 当前在 catch 分类前无条件输出 `capability.invocation.error`，使 declared Tool failure、SafeError 与 unknown exception 都产生同形 warning。
- Developer trace entry 顶层只复制 `HookInput` 公共坐标；model `stepId`、Capability `toolCallId`/`capabilityInvocationId` 留在 boundary 内，跨 artifact 关联需要读取 raw boundary。
- Model invocation contract 允许 `invocationScope` 和 `modelProfileId` 缺失，非 run-bound 调用不能提供完整 Agent/session/run/profile 坐标。
- Model timeline 已携带 `stepId`、message/tool数量和安全 option summary，但 structured projector 排除 `stepId` 且 mapper没有投影安全输入形态；direct `model.call.first_content` 与 observation-derived `model.stream.first_visible_content` 语义重复，并且前者只在可见文本路径存在。
- Capability timeline 已携带 tool-call 坐标和 tool-specific diagnostics，但generic成功结果没有统一表达实际命中的schema参数名/结果字段名、generated-message kind和context-patch字段，无法解释“成功但没有下游效果”。当前result只提供高基数`ArtifactId`，该边界没有可安全投影的artifact type。
- `ObservabilityContext.diagnosticCandidates` 当前只接受标量，`StructuredLogProjector`也只投影LOW-cardinality标量；名称数组不能直接复用现有candidate shape。单靠100项、每项256字符限制也可能超过writer的16 KiB单entry预算。
- 普通 writer 字段名使用无边界子串匹配，安全标量可能被误判成敏感字段；通用 `<redacted>` 不能解释处理原因。
- Web failure map 不能稳定回答失败位于 model、Capability input/execution/output 还是 runtime，也不能稳定区分“建议重试”和“需要修配置/输入”。

## 目标设计（Proposed Design）

### 1. 单一责任与唯一实施路径

主要 owner 为 `agent-observability`，负责冻结三类 surface 的信息边界和关联规则：

1. `developer-hook-trace`：显式 activation 的 raw model/Capability boundary artifact。
2. `RuntimeLogger`：正常执行只使用既有 observation-derived catalog，并把每个投影完成的正常entry实际提交给app composition注入的`RuntimeLogger`；安全 failure diagnostic中Capability execution exception可使用既有 `rawExceptionData` 例外，model provider failure只能使用 writer-derived safe exception evidence。
3. Web/stream/history：只消费 canonical safe error/event facts并生成可行动失败呈现。

`agent-log` 继续拥有 writer 和 physical destinations；`agent-app` 继续从composition选择的logger provider取得observation `RuntimeLogger`并注入`StructuredLogProjector`，component diagnostic继续使用同一provider binding产生的component logger；`agent-model`、`agent-capability` 只在各自最终消费/转换异常的 catch 输出一次 component diagnostic；`agent-plugin-sdk` 只提升既有 boundary 坐标；`agent-web` 只做安全投影。不得新增 observability event、diagnostic bus、persistence store 或 public diagnostic port。

该路径保留现有 `ModelInvocationService`、`CapabilityInvocationPort`、SafeError、timeline、developer hook lifecycle 和 app logger binding，不修改 `agent-contracts`。正常名称列表仅扩展`agent-observability`内部`DiagnosticCandidate`的安全数组value和`StructuredLogEntry`投影，不增加`ObservabilityObservationEvent`顶层字段、event catalog或其它surface contract。

### 2. Model provider 分类与安全异常证据

`agent-model` 增加对 `agent-common` RuntimeLogger contract 的直接依赖，并创建 component-scoped logger。Provider adapter 在 complete/stream 的最终 catch 或 stream error part 消费点按下列顺序执行：

1. 先以当前 AbortSignal/timeout state 判断 canceled/timeout。
2. 再从 provider adapter 已验证的 HTTP status、provider-owned stable error code、SDK error kind 和 transport error kind选择 safe classification。
3. 对实际捕获的 unknown/Error-like failure 以 `error` level 调用 logger。字段固定为 `event=model.provider.failure_captured`、`failureStage=MODEL_PROVIDER`、`requestId`、`stepId`、`providerKind`、`safeErrorCode`、`safeErrorCategory`、`retryable` 与标准 `err`；`modelProfileId` 仅在请求提供时输出；`agentId`、`agentVersion`、`sessionId`、`runId` 仅在 `invocationScope` 存在且通过现有 precondition validation 时输出。
4. 返回 SafeError；不得把 caught error、message、body 或 stack挂到 SafeError。

Provider diagnostic 不得包含 `modelName`、`baseUrl`、endpoint、credential reference 或 provider custom metadata。Writer 对标准 `err` 只产生 exception type、opaque fingerprint 和 NextAgent-owned frame。Model diagnostic 不调用 `runtimeRawExceptionLogFields`。这条不对称规则是有意设计：Capability execution exception 已由仓库治理允许记录 credential/prompt-redacted raw exception；provider error 可能内嵌 request、response、header 或 prompt，只保留安全异常证据。

Stream `error` part 与 outer catch 必须共享同一个 adapter-private helper，并通过 invocation-local boolean 保证一次 invocation 的同一 terminal failure至多输出一次 `model.provider.failure_captured`。正常 SafeError return 没有 caught error 时只返回分类，不伪造 diagnostic。

### 3. Capability executor 消费 unknown exception

`BuiltinToolsExecutor` 继续保留 input validation、execution、output validation 与 declared Tool result 的现有顺序。catch 的唯一变化是：

- 删除 catch 入口处无条件输出的 `capability.invocation.error`；`ToolDegradedResultError`、`ToolFailedResultError`、`ToolTimedOutResultError` 和 SafeError 先按现有分支生成结果，不输出 unknown exception event。
- 其余 error 在返回 `CAPABILITY_EXECUTION_FAILED` 前以 `error` level 输出 `capability.execution.exception_captured`。字段固定为 `event`、`failureStage=CAPABILITY_EXECUTION`、`agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`stepId`、`toolCallId`、`capabilityId`、`providerId`、`providerKind`、`safeErrorCode=CAPABILITY_EXECUTION_FAILED`、`safeErrorCategory=INTERNAL`、`retryable=false` 及 `runtimeRawExceptionLogFields(error)`；不输出 tenant/subject identity、Capability arguments/result 或 descriptor metadata。
- output schema invalid 是 executor 已知 validation outcome，只返回现有 `CAPABILITY_OUTPUT_INVALID`；外层 `tool.call.failed` 与 canonical `CAPABILITY_COMPLETED` 已提供安全 code/category 和关联坐标，本 change 不再增加内容为空且重复的 `capability.output.invalid`。

`agent-core/tool-loop` 继续记录 failure result、bounded tool input 和 canonical `CAPABILITY_COMPLETED`。它不再次打印 executor 已消费的 exception，也不接收 raw cause。

### 4. Developer trace 只提升既有 boundary 坐标

`DeveloperHookTraceLogEntry` 不新增来源于其他 contract 的字段。既有 hook stage 与触发时机保持不变：BEFORE boundary 记录实际送入 owner 的 raw input；只有当前主流程已经产生 AFTER boundary 时才记录 raw result。Model SafeError、Capability `FAILED/TIMED_OUT` 或 thrown exception 没有 AFTER boundary时，不补造 hook entry，也不为执行 developer trace 而调用额外 lifecycle hook。

Formatter 从当前 stage 的现有 typed boundary 提升以下可选坐标到 entry 顶层：

| Stage | 提升字段 |
|---|---|
| `BEFORE_MODEL_INVOKE` / `AFTER_MODEL_RESULT` | `stepId`、`modelProfileId` |
| `BEFORE_CAPABILITY_INVOKE` | `toolCallId`、`capabilityId` |
| `AFTER_CAPABILITY_RESULT` | `capabilityInvocationId`、`capabilityId` |

Formatter 只读取当前 boundary；不跨 entry 建索引，不从 raw value 推断。raw boundary 与提升字段仍由 caller-owned developer trace sink写入，不经过 operational writer。生成的单文件 plugin artifact 与 SDK formatter 必须保持同形同策。

失败关联遵循固定规则：model failure 使用 `BEFORE_MODEL_INVOKE` 的 run/step 坐标关联 `model.provider.failure_captured` 与 canonical SafeError；Capability failure 使用 `BEFORE_CAPABILITY_INVOKE` 的 run/toolCall/capability 坐标关联 `capability.execution.exception_captured` 或安全 failure result。未形成可返回 result 的异常本身没有 raw output；output schema invalid 的 rejected value不得为了排障复制到 operational log、timeline 或 SafeError。

### 5. 正常执行轨迹与安全形态

正常执行只使用以下既有 observation-derived event；成功事件统一使用 `info` level。除条件事件外，每个实际边界按相同 run/step/tool-call 至多输出一次：

| 阶段 | Event | 触发与精确语义 |
|---|---|---|
| request | `request.accepted` | run 成功受理后恰好一次 |
| routing | `policy.allowed` | 每个实际 routing/constraint/fallback policy decision一次，保留 `policyDomain`、outcome 与 safe reason |
| context | `context.assembly.completed` | 每次成功 assembly一次，保留 `stepId`、duration、budget decision/reason和安全计数 |
| model | `model.invocation.started` | 每次 provider invocation开始一次 |
| model | `model.stream.first_visible_content` | 只有出现首个可见内容时至多一次；tool-only invocation不得伪造 |
| model | `model.invocation.completed` | 每次成功 invocation恰好一次，并与 started共享 run/step |
| capability | `capability.started` / `capability.completed` | 每次实际 invocation各一次，并共享 capability invocation/tool-call坐标 |
| sandbox | `sandbox.execution.started` / `sandbox.execution.completed` | 只有 Capability实际进入sandbox boundary时各一次 |
| terminal | `request.completed` | completed run terminal commit后恰好一次 |

唯一输出链路固定为 `timeline safe payload → observation mapper → StructuredLogProjector → app composition注入的 RuntimeLogger → agent-log physical destination`。Timeline、observation、diagnostic candidate和`StructuredLogEntry`都只是内部承载或投影结果，不是本需求的日志完成条件；只有`RuntimeLogger`收到并尝试写入完整entry，才视为该正常日志已输出。不得只产生observation/candidate/`StructuredLogEntry`而跳过`RuntimeLogger`，也不得由owner package绕过该链路直接写第二份同语义正常日志。

`StructuredLogEntry` 在 `agent-observability` 内增加可选顶层 `stepId`，只从当前 observation 的安全 diagnostic candidate提升；`stepId` 不再进入 generic `details`，也不从相邻 event 推断。Model started、first-visible、completed必须通过 `agentId/sessionId/requestId/runId/stepId` 配对；Capability通过既有 `capabilityInvocationId` 配对。该内部 structured log字段不修改 `agent-contracts`、timeline event type或Web DTO。

Model正常日志字段固定为：

- started：`modelProfileId?`、`providerKind`、`messageCountBucket`、`disclosedCapabilityNames`、`disclosedCapabilityNamesTruncated`、`timeoutMsBucket`、`maxOutputTokensBucket`。
- first-visible：`stepId` 与 `durationMs`，不得包含content。
- completed：`modelProfileId?`、`providerKind`、`finishReason?`、usage、`resolvedToolNames`、`resolvedToolNamesTruncated`、`durationMs`。

`disclosedCapabilityNames` 只能来自本次 Model request中由可信catalog/assembly生成并通过descriptor validation的Tool descriptor name，按实际披露顺序保留，最多100项。`resolvedToolNames` 只能对 Model tool call name与本次已披露descriptor name做精确匹配后，从匹配到的可信descriptor回填，按tool call顺序保留，最多100项；不得直接复制模型生成的未匹配tool name。可记录name还必须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`；不匹配的name被省略。对应 `*Truncated` 字符串枚举为 `true|false`，只要因100项上限或安全name规则省略任一项即为 `true`。

每个Model name列表序列化为JSON array后的UTF-8长度还不得超过4096 bytes；owner按原顺序逐项追加，下一项会超过item或byte预算时停止并把对应`*Truncated`置为`true`。唯一写入路径是 `agent-core/RunBoundModelInvocation` 在同时持有可信request descriptor与normalized result时计算上述name列表，并加入既有Model timeline safe payload；`timeline-safe-payload-schemas`验证数组、marker和预算。

`capability.started` 保留已有 `capabilityId` 与 `capabilityInvocationId`。`capability.completed` 在已有 `capabilityId`、`capabilityInvocationId`、status和duration外，只在存在有效信息时增加：

- `validatedArgumentNames`：实际arguments key与可信input schema `properties`精确匹配后的schema property name。
- `validatedResultFieldNames`：实际result顶层key与可信output schema `properties`精确匹配后的schema property name。
- `argumentProjectionStatus`固定为`EMPTY | SCHEMA_PROPERTIES_UNAVAILABLE | NO_SCHEMA_MATCH | PROJECTED | PARTIALLY_PROJECTED | FILTERED`；`resultProjectionStatus`额外允许`NOT_PRODUCED`，解释失败边界未形成validated typed result以及列表为空或被裁剪的原因。
- `generatedMessageKinds`：只使用typed contract生成 `USER` 或 `USER_META`；`meta === true`映射为`USER_META`，其余generated user message映射为`USER`，去重并保持首次出现顺序。
- `contextPatchFields`：只允许 `allowedTools | deniedTools | discoveredSkills | modelName | modelOptions`，按该固定顺序输出patch实际存在字段。
- `toolResultStatus` / `reasonCode`：只复用Capability owner在现有`metadata.toolDiagnostics`提供、通过固定key与低基数value校验的安全业务语义；generic日志层不得从structured result value推导。

result boundary未形成通过validation的typed structured result时，`resultProjectionStatus`先选择`NOT_PRODUCED`；其余投影状态按`EMPTY`（实际object无顶层key）→`SCHEMA_PROPERTIES_UNAVAILABLE`（schema没有object形态`properties`）→`NO_SCHEMA_MATCH`（存在实际key但没有schema精确匹配）→投影结果的固定顺序选择。存在匹配字段且全部安全输出为`PROJECTED`；至少输出一项但因安全或容量规则省略其它匹配项为`PARTIALLY_PROJECTED`；存在匹配字段但全部被省略为`FILTERED`。状态字段总是输出，因此不得再用列表省略表达多种原因。

`validatedArgumentNames` 与 `validatedResultFieldNames` 最多100项、按实际对象key顺序保留，每个列表序列化为JSON array后的UTF-8长度最多4096 bytes，两个列表合计最多8192 bytes。`PROJECTED`输出非空列表和字符串marker`false`；`PARTIALLY_PROJECTED`输出非空列表和字符串marker`true`；`FILTERED`及其它无列表状态省略marker。schema property name须匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`，并按camelCase、snake_case、kebab-case分为lowercase segment；任一segment命中`password | secret | credential | authorization | cookie`、名称整体为`token`、`token`前一segment为`api | access | auth | refresh | bearer | id`，或相邻segment为`api`、`key`的名称被排除。`tokenLength`、`tokenCount`、`tokenizer`等非credential语义名称不得因包含`token`字样被误伤。未匹配schema、命中敏感segment或不满足格式规则的raw key不得记录。

这些字段由 `agent-core/tool-loop` 在同时持有trusted descriptor schema、typed arguments与typed result的边界计算，并写入既有timeline safe payload；不得塞入当前只接受标量的`toolDiagnostics`数组。`timeline-safe-payload-schemas`验证名称数组、状态、marker和预算；timeline mapper只将来自当前可信descriptor/schema或固定typed enum的六个批准数组建立为`classification=SAFE`、`cardinality=LOW`的内部array candidate，`StructuredLogProjector`只对这六个固定list key投影，并把完整entry交给composition绑定的`RuntimeLogger`。Trace、metric、audit和其它projector MUST忽略所有array-valued candidate；mapper与projector均不得读取raw payload重新猜测或把未匹配raw name标记为LOW cardinality。

没有generated message kind或context patch field时省略对应列表；不得以argument/result/artifact/generated-message数量或context patch presence替代有效信息。artifact ref同样不输出：当前边界只有高基数`ArtifactId`而没有安全type，纯数量无定位价值，ref又不允许进入普通日志。安全artifact type属于独立`agent-contracts` refinement，本change明确延期。

Model `messageCountBucket` 固定为 `0 | 1 | 2-10 | 11-100 | 101+`；`timeoutMsBucket` 固定为 `1-1000 | 1001-5000 | 5001-30000 | 30001-120000 | 120001+`；`maxOutputTokensBucket` 固定为 `unspecified | 1-1024 | 1025-4096 | 4097-16384 | 16385+`。除上述由可信descriptor/schema/typed contract确认的名称列表、投影状态和owner安全业务状态外，不记录message/ref列表、未匹配arguments/result字段名或任何值原文。

现有 direct `model.call.first_content` 被删除，首内容时延只由 `model.stream.first_visible_content` 表达，避免同一事实重复进入 operational file。text-only、tool-only、多轮 Model→Capability→Model、fallback、并行 Capability和成功空结果均使用同一目录，不新增分支事件。

### 6. 精确字段分类与 typed marker

`agent-log` 删除普通字段的无边界 `FORBIDDEN_KEY`。处理顺序固定为：

```text
reserved/writer-owned
→ special rawExceptionData
→ special toolInput
→ approved semantic
→ credential
→ policy omitted
→ generic bounded value
→ entry budget
```

前一分支命中后不得落入后一分支。Caller不得提交marker冒充writer净化结果。

Writer-owned字段精确冻结为`timestamp | time | level | surface | component | serviceVersion | msg | message | operation | outcome | ownerScope | correlation | tenantId | subjectId | requestContextId | stepId | processState | safeSummary | fallbackReasonCode | err | exception | exceptionType | exceptionCode | exceptionFingerprint | exceptionFrames | exceptionCause | exceptionChainTruncated`。普通caller提交这些字段时忽略其值；只有writer或对应可信projector可在最终entry设置。

Approved semantic字段使用字段名加value validator的固定表：

| 字段 | 合法value |
|---|---|
| `inputTokens`、`outputTokens`、`totalTokens`、`maxOutputTokens`、`tokenLength`、`contentLength` | 非负safe integer |
| `durationMs`、`firstContentLatencyMs`、`modelContentLatencyMs` | 非负finite number |
| `commandExitCode` | signed 32-bit integer |
| `pathPolicyStatus` | 匹配`^[A-Z][A-Z0-9_]{0,63}$`的schema-validated低基数token |
| `messageCountBucket`、`timeoutMsBucket`、`maxOutputTokensBucket` | 第5节冻结的对应enum |
| `argumentProjectionStatus`、`resultProjectionStatus` | 第5节冻结的对应enum |
| `toolResultStatus`、`reasonCode` | 第5节冻结的1至128字符低基数token |
| 六个安全名称/类型数组及其`*Truncated` marker | 第5节冻结的来源、item、byte、name和enum规则 |

字段名命中approved表但value未通过validator时直接省略，禁止回退credential、policy或generic分支；因此`tokenLength=1280`保留，`tokenLength="Bearer ..."`不会因字段名获批而保留。

Credential key先把camelCase、snake_case、kebab-case分成lowercase segment。任一segment命中`password | passwords | secret | secrets | credential | credentials | authorization | authorizations | cookie | cookies`、名称整体为`token | tokens`、`token | tokens`前一segment为`api | access | auth | refresh | bearer | id`，或相邻segment为`api`与`key | keys`时，value统一替换为`<redacted:credential>`。`tokenLength`、`tokenCount`、`tokenizer`等非credential语义字段不得因包含`token`字样被误伤；通过数值校验的`tokenLength`、`inputTokens`继续由approved semantic保留，而`accessToken`、`accessTokens`、`refresh_token`和`apiKey`仍被净化。

Policy key使用canonical full key精确匹配：先按camelCase、snake_case、kebab-case分段，再拼接为无分隔符lowercase key。集合冻结为：

```text
prompt rawprompt systemprompt developerprompt thinking reasoning
messages messagecontent modeloutput rawmodeloutput content rawcontent delta streamdelta
toolargs toolarguments capabilityarguments toolresult capabilityresult structuredpayload result output
stdout stderr command environment stack filepath path
rawerror rawproviderbody providerbody providerheaders headers attachmentcontent
```

命中后value统一替换为`<omitted:policy>`。该规则只用于普通diagnostic分支，不覆盖`rawExceptionData`和`toolInput`的现有专用策略。精确full-key匹配保证`contentLength`、`pathPolicyStatus`、`commandExitCode`不分别因`content`、`path`、`command`子串被省略。

Generic string和message在截断前扫描`sk-*`、Bearer credential、`password/api-key/token/secret/credential/authorization`赋值、Windows/POSIX绝对路径；credential替换为`<redacted:credential>`，路径替换为`<omitted:policy>`。Writer先读取至目标上限外512 bytes完成扫描，再按UTF-8边界截断；发生截断时整个value替换为`<truncated:N-bytes>`，其中`N`只使用`1-1024 | 1025-4096 | 4097-16384 | 16385+`，不得同时保留原字符串片段。普通值继续使用64字段、16数组项、6层、1024-byte字符串限制；`rawExceptionData`字符串使用2048-byte限制；entry级16 KiB与destination 4 MiB保持现状。

### 7. 可行动失败前端投影

前端在已有 `failureDetails` 工具中建立唯一 code-owned mapping：

```text
safe code/category + event type
  -> failure stage
  -> retry guidance
  -> localized remediation key
```

retry guidance 是显示决策，不新增 transport 字段：timeout、rate limited、network/unavailable 类 code 显示建议重试；authentication、not-found model、input/output validation 和 internal failure 显示不可直接重试及对应修复动作。若同一 turn 有多个 failure event，继续沿用 `REQUEST_FAILED` → `CAPABILITY_COMPLETED/CAPABILITY_RESULT_DELTA` → `DEGRADATION_NOTICE` 的既有优先级；在同一优先级内选择最后一个事件。

local、immersive、collaborative host 继续复用同一 `agent-web` chat workspace 和 presentation utility，不在宿主入口建立独立映射。UI 只显示已有 request/run/tool-call 坐标中当前产品已经展示的部分；本 change 不新增公开 diagnostic id。

### 8. 失败与降级路径

- Logger 缺失、throw、serialization failure、buffer overload：不得改变 model/capability result；现有 writer degradation/overload evidence继续生效。
- Provider failure 无稳定 status/code：安全归类为 `MODEL_INTERNAL_ERROR`，只保留 writer-derived safe exception evidence。
- Model invocation 没有 `invocationScope` 或 `modelProfileId`：仍输出 request/step/provider/safe classification 和安全异常证据，省略不可用可选坐标；不得回退到默认 Agent、全局 profile 或生成占位值。
- Capability implementation 抛 non-Error value：现有 raw exception sanitizer生成 bounded value；客户 surface仍只看到 `CAPABILITY_EXECUTION_FAILED`。
- Developer trace 未 activation、sink失败或失败路径没有 AFTER boundary：不产生对应 raw artifact，请求行为保持不变；BEFORE boundary、operational diagnostic 与 canonical safe failure仍按实际可用坐标关联。
- 正常 observation projection缺少可选 profile/usage/finish reason：省略该字段，但仍以 run/step或capability invocation坐标形成闭合started/terminal轨迹；不得用默认值冒充实际结果。
- 正常名称数组超过item、单列表或合计UTF-8预算：owner按固定顺序保留完整预算内项并设置truncated/projection status；关联坐标、status和duration仍输出，不得把超限raw name交给writer后再整条替换。
- Capability失败边界没有形成validated typed result：输出`resultProjectionStatus=NOT_PRODUCED`，不得读取rejected/raw result补造字段名。
- Frontend code未映射：显示 `UNKNOWN`、稳定错误码和 generic remediation，不影响 turn/process panel渲染。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | raw model/Capability boundary 只保留在显式 developer trace；model provider diagnostic 不记录 raw error；Capability raw exception沿用既有 credential/prompt redaction；客户 surface只消费 SafeError/canonical event | canary leakage、字段分类负例、跨 surface contract tests |
| 性能/容量 | 每个 terminal failure至多增加一个 bounded log entry；正常路径不新增event数量；Model name列表各≤4096 bytes，Capability schema name列表各≤4096 bytes且合计≤8192 bytes，固定kind/patch列表天然有界；删除重复first-content direct log并沿用16 KiB entry与4 MiB destination buffer | item/UTF-8/list/entry budget、event exact-one、duplicate failure、overload tests |
| 可靠性/恢复 | 全部诊断调用 non-throwing；不改变 fallback、retry、cancellation、terminal commit或replay | logger failure、stream error、cancel/timeout characterization |
| 可维护性 | provider mapping、Capability classification、normal trajectory mapper、writer policy和frontend mapping各有单一 owner helper；不新增 DTO/event/store | architecture dependency与single-mapping检查 |
| 可测试性 | status/code mapping、projection status、正常event catalog/bucket、精确event字段、array allowlist、marker、关联坐标和UI提示均由确定输入产生 | unit、contract、integration、frontend tests |
| 审计/可追溯性 | 通过现有 agent/session/request/run/step/tool-call 坐标关联；developer trace不是audit truth，operational log不是durable replay | correlation integration与audit exclusion tests |

## 验证策略（Verification Strategy）

- Unit：验证 provider 分类优先级、Capability catch 分支、projection status优先级、名称过滤与item/byte预算、array candidate固定allowlist、正常轨迹bucket/字段提升、writer exact-key/marker/budget、developer trace坐标提升和frontend mapping。
- Characterization：固定当前 text-only、tool-only、多轮、并行Capability、fallback、complete/stream、declared Tool failure、logger non-throwing、cancel/timeout和terminal结果，证明新增诊断不改变业务行为。
- Contract：验证 SafeError shape不变、code/category/retryable满足 specs、developer trace与runtime diagnostic使用同一可信坐标。
- Integration：同一 run 的正常路径断言 request→routing→context→model→Capability/sandbox→model→terminal目录、run/step/tool-call关联和exact-one；失败路径产生 developer BEFORE raw boundary、owner diagnostic、canonical safe failure与Web projection并断言可关联且不重复。
- E2E：三个浏览器宿主对同一安全事件显示相同阶段、重试指导和修复指引。
- Architecture：禁止新增 `agent-contracts` 字段、`ObservabilityObservationEvent`顶层字段、第二套 raw trace、observability event catalog或diagnostic store；禁止raw field进入timeline/Web/audit/metric/trace，并禁止array-valued candidate被structured-log以外projector消费。
- Negative security：在 prompt、model output、Capability input/output、provider error、credential、path、stack放置不同 canary，逐 surface断言只有批准的 developer trace或Capability execution exception diagnostic可见对应数据。

## 风险与取舍（Risks / Trade-offs）

- Provider SDK 可能缺少稳定 status/code，部分失败仍会归为 `MODEL_INTERNAL_ERROR`。通过 safe exception fingerprint和run/step关联提升定位能力，不解析 free-text message以换取稳定安全边界。
- Developer trace包含高敏感 raw boundary，显式 activation仍可能被误用。保持默认关闭、caller-owned sink和不进入operational maintenance；本 change不增加更方便但风险更高的Web下载入口。
- Typed marker改变现有日志文本，依赖通用 `<redacted>` 的外部解析器需要调整。Marker只属于diagnostic text，不改变canonical event或SafeError；验证同时保留稳定event/code字段。
- 正常轨迹新增Model安全bucket及可信名称/类型字段，并删除重复 `model.call.first_content`；依赖该direct event的本地解析器需要切换到 `model.stream.first_visible_content`，后者已是既有稳定observation-derived event，且保留首内容时延。
- 名称数组只允许来自当前可信descriptor/schema或固定typed enum，并通过固定六key、credential segment过滤、4096/8192-byte预算保持bounded low-cardinality；它们仍会增加单entry体积并披露schema结构，因此其它surface全部拒绝array投影。
- 当前没有安全artifact type，报表/文件类Capability的普通日志仍不能说明产物类型。记录数量、presence或ID不能解决定位问题，因此保持省略；后续若需要必须独立细化`agent-contracts`。
- Frontend重试指导来自稳定code mapping而非新增transport retryable字段，避免核心契约变更；代价是新增code必须同步更新前端map，unknown fallback保证安全兼容。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-7.1-输出结构化日志` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/actionable-execution-failure/spec.md`、`openspec/specs/developer-hook-trace-logging/spec.md`、`openspec/specs/provider-error-safe-mapping/spec.md`、`openspec/specs/runtime-logging/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
