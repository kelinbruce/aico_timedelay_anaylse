## ADDED Requirements

### Requirement: Capability executor 在有损归一化前记录本地执行异常

当 Capability executor 捕获未知执行异常并将其转换为 `CAPABILITY_EXECUTION_FAILED` 时，executor MUST 在转换前以 `error` level 向本地 runtime diagnostic logger 输出恰好一个 `capability.execution.exception_captured`。producer MUST 只提交 `event`、`failureStage=CAPABILITY_EXECUTION`、可信 `agentId`、`agentVersion`、`sessionId`、`requestId`、`runId`、`stepId`、`toolCallId`、`capabilityId`、descriptor 的 `providerId`/`providerKind`、`safeErrorCode=CAPABILITY_EXECUTION_FAILED`、`safeErrorCategory=INTERNAL`、`retryable=false` 和统一 `rawExceptionData` 净化入口产生的字段；writer-owned timestamp、level、component 与净化投影不受该 producer allowlist 限制。

该 entry MUST NOT 携带 tenant/subject identity、Capability arguments/result、其它 descriptor metadata 或 caller 自行构造的 raw exception 字段。executor 当前 catch 入口的通用 `capability.invocation.error` MUST 被该 unknown-only event 替换，不得对同一 unknown exception同时输出两个 owner diagnostic。

输入 schema failure、输出 schema failure、已声明 `ToolFailedResultError`、`ToolTimedOutResultError`、`ToolDegradedResultError` 和普通 `SafeError` MUST 使用其安全分类，不得伪造成未知 execution exception。诊断写入失败 MUST NOT 改变 Capability result。

#### Scenario: 未知 Capability 异常在转换前被消费

- **WHEN** Capability implementation 抛出未知 Error
- **THEN** executor MUST 输出一个 `capability.execution.exception_captured`
- **AND** MUST 返回 `CAPABILITY_EXECUTION_FAILED`
- **AND** local runtime log MUST 能按 run、toolCall 和 capability 坐标关联诊断与失败结果

#### Scenario: 已声明 Tool failure 不重复记录未知异常

- **WHEN** Tool implementation 抛出携带安全 code/category 的已声明 Tool failure
- **THEN** executor MUST 保留该安全失败结果
- **AND** MUST NOT 输出 `capability.execution.exception_captured`
- **AND** MUST NOT 输出被替换的 `capability.invocation.error`

#### Scenario: Capability output validation 使用既有安全失败日志

- **WHEN** Capability 返回值未通过 output schema
- **THEN** executor MUST 返回 `CAPABILITY_OUTPUT_INVALID`
- **AND** outer tool loop MUST 继续通过既有 `tool.call.failed` 和 canonical `CAPABILITY_COMPLETED` 表达安全分类与关联坐标
- **AND** MUST NOT 新增 `capability.output.invalid` 或记录 rejected output value

#### Scenario: Logger 不可用时执行语义不变

- **WHEN** runtime diagnostic logger 不可用或写入失败
- **THEN** executor MUST 返回与 logger 可用时相同的 Capability result

### Requirement: 正常执行使用单一可关联的安全日志目录

不开启 `developer-hook-trace` 时，operational log MUST 继续通过现有 observation-derived路径表达正常执行，不得新增平行 direct event目录。每个投影完成的正常entry MUST 交给app composition注入的`RuntimeLogger`，由`agent-log`现有physical destination尝试写入；只产生timeline event、observation、diagnostic candidate或`StructuredLogEntry`而未调用`RuntimeLogger` MUST NOT 视为日志已输出。一个成功 run MUST 按实际执行边界以 `info` level向该`RuntimeLogger`输出 `request.accepted`、routing `policy.allowed`、`context.assembly.completed`、每次 `model.invocation.started`/`model.invocation.completed`、实际 Capability 的 `capability.started`/`capability.completed`、实际 sandbox调用的 `sandbox.execution.started`/`sandbox.execution.completed` 和最终 `request.completed`。只有产生首个可见内容的 Model invocation才输出至多一个 `model.stream.first_visible_content`；tool-only invocation不得伪造该事件。

request event MUST 使用可信 `agentId`、`agentVersion`、`sessionId`、`requestId` 和 `runId` 关联。Context和Model event MUST 额外把当前 observation 已提供的 `stepId` 提升为 structured log顶层字段；Model started、first-visible和completed MUST 共享同一 run/step。Capability started/completed MUST 共享既有 `capabilityInvocationId`。缺失可选值时 MUST 省略，不得从默认配置、相邻event或raw payload推断。

Model started MUST 输出 `modelProfileId`（存在时）、`providerKind`、`messageCountBucket`、`disclosedCapabilityNames`、`disclosedCapabilityNamesTruncated`、`timeoutMsBucket` 和 `maxOutputTokensBucket`；completed MUST 输出存在的 `modelProfileId`、`providerKind`、`finishReason`、usage、`resolvedToolNames`、`resolvedToolNamesTruncated` 和duration。`capability.started` MUST 保留 `capabilityId` 和 `capabilityInvocationId`；`capability.completed` 除现有 capability/status/duration字段外，MUST 输出 `argumentProjectionStatus` 和 `resultProjectionStatus`，并在存在可用信息时输出 `validatedArgumentNames`、`validatedResultFieldNames`、`generatedMessageKinds`、`contextPatchFields`、`toolResultStatus` 和 `reasonCode`。

`disclosedCapabilityNames` MUST 只来自本次Model request中由可信catalog/assembly生成且通过descriptor validation的Tool descriptor name；`resolvedToolNames` MUST 只来自Model返回tool call name与本次披露descriptor name精确匹配后的可信descriptor，不得直接记录未匹配的模型输出。可记录name MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`。两个列表 MUST 保留执行顺序、最多100项，且各自序列化为JSON array后的UTF-8长度不得超过4096 bytes；owner MUST 在追加下一项将超过item或byte预算时停止。两个列表分别使用字符串枚举 `disclosedCapabilityNamesTruncated=true|false`、`resolvedToolNamesTruncated=true|false`；因item、byte或安全name规则省略任一项时对应marker MUST 为 `true`。

上述name列表 MUST 由 `agent-core` 的 run-bound Model owner在同时持有可信request descriptor与normalized Model result时写入既有Model timeline safe payload；`timeline-safe-payload-schemas` MUST 验证name、item预算、byte预算和marker。

`validatedArgumentNames` 和 `validatedResultFieldNames` MUST 分别只包含实际arguments/result顶层字段与当前可信Capability descriptor的input/output schema `properties` 精确匹配后的字段名。字段名 MUST 匹配 `^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$`，并按camelCase、snake_case、kebab-case分为lowercase segment；任一segment命中 `password | secret | credential | authorization | cookie`、名称整体为`token`、`token`前一segment为`api | access | auth | refresh | bearer | id`，或相邻segment为 `api`、`key` 的名称 MUST 被排除。`tokenLength`、`tokenCount`、`tokenizer`等非credential语义名称 MUST NOT 因包含`token`字样被排除。未匹配schema、命中敏感segment或不满足格式规则的raw key以及所有字段值 MUST NOT 进入日志。

两个validated name列表 MUST 按实际object key顺序保留、各自最多100项、各自序列化JSON array后的UTF-8长度最多4096 bytes且合计最多8192 bytes；owner MUST 按argument列表后result列表的固定顺序应用合计预算。`PROJECTED`状态 MUST 输出对应列表和字符串marker `false`；`PARTIALLY_PROJECTED`状态 MUST 输出非空列表和字符串marker `true`；`FILTERED`及其它无列表状态由projection status表达原因并省略marker。

`argumentProjectionStatus` MUST 按如下唯一顺序计算：实际object没有顶层key为 `EMPTY`；schema没有object形态`properties`为 `SCHEMA_PROPERTIES_UNAVAILABLE`；实际存在key但没有schema精确匹配为 `NO_SCHEMA_MATCH`；存在匹配字段且全部输出为 `PROJECTED`；至少输出一项且因安全或容量规则省略其它匹配字段为 `PARTIALLY_PROJECTED`；存在匹配字段但全部被省略为 `FILTERED`。`resultProjectionStatus`在Capability未形成通过result boundary validation的typed structured result时 MUST 先返回 `NOT_PRODUCED`，否则应用相同顺序。状态 MUST 始终输出，不得仅靠name列表存在与否表达原因；非`PROJECTED`/`PARTIALLY_PROJECTED`状态 MUST 省略对应name列表和truncated marker。

`generatedMessageKinds` MUST 只使用typed result可确定的 `USER` 或 `USER_META`，其中 `meta === true` 映射为 `USER_META`，其余generated user message映射为 `USER`；列表按首次出现顺序去重，不得包含message content。`contextPatchFields` MUST 只包含typed context patch中实际存在的 `allowedTools | deniedTools | discoveredSkills | modelName | modelOptions`，按该固定顺序输出，不得包含字段值。没有generated message或context patch字段时 MUST 省略对应列表。

`toolResultStatus` 和 `reasonCode` MUST 只来自Capability owner在现有`metadata.toolDiagnostics`提交且通过固定key、1至128字符和`^[A-Za-z0-9_.+-]+$`低基数value规则验证的值；generic tool-loop、timeline mapper与projector MUST NOT读取structured result value推导业务状态。未提供或未通过验证时 MUST 省略。

六个批准的安全数组字段 `disclosedCapabilityNames`、`resolvedToolNames`、`validatedArgumentNames`、`validatedResultFieldNames`、`generatedMessageKinds` 和 `contextPatchFields` MUST 使用唯一内部投影路径：owner写入既有timeline safe payload，safe payload schema验证后，timeline mapper只把来自当前可信descriptor/schema或固定typed enum、且满足item/byte预算的数组建立为 `classification=SAFE`、`cardinality=LOW` 的内部array diagnostic candidate，`StructuredLogProjector`按固定key allowlist投影为structured log数组，并把包含关联坐标、event、status、duration及批准字段的完整entry交给composition绑定的`RuntimeLogger`。该内部candidate value扩展 MUST NOT 修改`agent-contracts`或`ObservabilityObservationEvent`顶层shape。Trace、metric、audit和其它projector MUST忽略所有array-valued candidate；mapper和projector MUST NOT读取raw Model/Capability payload重新解析数组，也不得把未匹配raw name标记为LOW cardinality。

当前artifact边界只提供高基数 `ArtifactId` 且没有可安全分类的artifact type，因此正常日志 MUST NOT 输出artifact ref、artifact数量或artifact presence，也不得为了日志读取artifact内容或修改public contract。安全artifact type属于后续独立contract refinement。

正常日志 MUST NOT 输出Capability argument key数、result顶层字段数、artifact数、generated message数或context patch presence。`messageCountBucket` MUST 只使用 `0 | 1 | 2-10 | 11-100 | 101+`；`timeoutMsBucket` MUST 只使用 `1-1000 | 1001-5000 | 5001-30000 | 30001-120000 | 120001+`；`maxOutputTokensBucket` MUST 只使用 `unspecified | 1-1024 | 1025-4096 | 4097-16384 | 16385+`。这些字段不得包含 message/ref列表、prompt、模型输出、Capability payload value、stdout/stderr、artifact/generated-message/context-patch内容或路径。

现有 direct `model.call.first_content` MUST 被删除；首个可见内容的 operational事实只能由 `model.stream.first_visible_content` 输出一次。日志投影失败 MUST NOT 改变 request、model、Capability、sandbox或terminal行为。

#### Scenario: Text-only正常请求形成闭合轨迹

- **WHEN**一个 run 完成 context assembly并由一次 Model text response正常结束
- **THEN**注入的`RuntimeLogger`实际接收到的entry MUST 包含同一 run的 request accepted/completed、context completed和Model started/completed
- **AND** Model三类事件存在时 MUST 使用相同 step
- **AND**首个可见内容 MUST 只由 `model.stream.first_visible_content` 表达一次

#### Scenario: 正常结构信息写入 RuntimeLogger

- **WHEN** Model披露并解析Tool且Capability成功产生schema匹配字段、generated message或context patch
- **THEN**composition注入的`RuntimeLogger` MUST 接收到包含对应批准名称、类型、投影状态及关联坐标的`model.invocation.*`和`capability.completed`完整entry
- **AND**只在timeline、observation、diagnostic candidate或projector返回值中可见这些字段 MUST NOT满足验收
- **AND**同一边界 MUST NOT再由owner package直接写入第二份正常日志

#### Scenario: Tool-only与多轮调用可区分

- **WHEN**首轮 Model只返回tool call，Capability成功后第二轮 Model返回可见文本
- **THEN**首轮和第二轮 Model MUST 使用不同step并分别形成started/completed配对
- **AND**首轮started MUST 输出实际披露的 `disclosedCapabilityNames`
- **AND**首轮completed MUST 输出精确匹配后的 `resolvedToolNames`
- **AND**首轮 MUST NOT 输出first-visible
- **AND**Capability started/completed MUST 使用同一capability invocation坐标
- **AND**第二轮 MAY输出恰好一个first-visible

#### Scenario: 未匹配或不安全Tool name不进入正常日志

- **WHEN** Model返回的tool name未精确匹配本次披露descriptor，或可信descriptor name不满足安全name规则
- **THEN** operational log MUST NOT复制该未匹配或不安全name
- **AND**对应name列表的truncated marker MUST 表达是否因安全规则省略可信descriptor name
- **AND**后续安全失败或恢复事件 MUST 继续按既有code和坐标表达结果

#### Scenario: Capability成功结果使用可信schema字段定位

- **WHEN** Capability arguments和成功result包含与当前可信descriptor schema `properties`精确匹配的字段，也包含未匹配raw key
- **THEN** `capability.completed` MUST 输出安全且有界的 `validatedArgumentNames` 和 `validatedResultFieldNames`，并按实际裁剪情况输出 `PROJECTED` 或 `PARTIALLY_PROJECTED`
- **AND** MUST NOT 输出字段值或未匹配raw key

#### Scenario: Capability结构无法投影时给出明确原因

- **WHEN** arguments/result分别出现空object、schema无`properties`、没有schema匹配、schema匹配字段全部被安全规则过滤，或Capability未形成通过result boundary validation的typed result
- **THEN** `capability.completed` MUST 分别输出 `EMPTY`、`SCHEMA_PROPERTIES_UNAVAILABLE`、`NO_SCHEMA_MATCH`、`FILTERED` 或仅用于result的`NOT_PRODUCED`
- **AND** MUST 省略对应name列表和truncated marker

#### Scenario: Capability名称预算不会替换整条日志

- **WHEN** schema匹配字段在item、单列表byte或合计byte预算任一维度超限
- **THEN** owner MUST 按固定顺序保留预算内完整name并输出 `PARTIALLY_PROJECTED` 与对应truncated marker
- **AND** structured log entry MUST 保留关联、status和duration，不得因名称数组超过writer entry budget而整条替换

#### Scenario: Credential语义字段名不进入名称数组

- **WHEN** schema匹配字段名按规范化segment命中credential语义词
- **THEN** operational log MUST NOT输出该字段名
- **AND**部分过滤 MUST 使用 `PARTIALLY_PROJECTED` 和truncated marker，全部过滤 MUST 使用 `FILTERED` 且省略空列表和marker

#### Scenario: Generated message和context patch输出安全类型信息

- **WHEN** Capability成功result包含普通generated user message、meta generated user message和typed context patch
- **THEN** `capability.completed` MUST 输出去重的 `generatedMessageKinds` 和固定allowlist内实际存在的 `contextPatchFields`
- **AND** MUST NOT 输出generated message content或context patch value

#### Scenario: Capability owner安全业务状态支持业务定位

- **WHEN** Capability owner在`metadata.toolDiagnostics`提供通过固定allowlist和低基数value校验的`toolResultStatus`或`reasonCode`
- **THEN** `capability.completed` MUST 输出这些安全业务状态
- **AND** generic日志链路 MUST NOT从structured result value推导或补造状态

#### Scenario: 没有有效结构信息时不输出无意义数量

- **WHEN** Capability成功返回空object且没有schema匹配字段、generated message或context patch，并可能仅包含artifact ref
- **THEN** `capability.completed` MUST 输出argument/result的明确投影状态，并省略没有内容的name/kind/patch列表
- **AND** MUST NOT 输出argument/result/artifact/generated-message数量、context patch presence或artifact ref

#### Scenario: Fallback与并行Capability保持唯一关联

- **WHEN**一个run发生Model fallback并执行多个并行Capability
- **THEN**每个实际Model invocation MUST按各自step形成started/terminal配对
- **AND**每个Capability MUST按各自capability invocation形成started/completed配对
- **AND**同一边界事实 MUST NOT 同时由direct和observation-derived事件重复输出

#### Scenario: 正常日志sink失败不改变执行

- **WHEN**任一正常observation-derived entry被logger拒绝或丢弃
- **THEN**request、Model、Capability、sandbox和terminal结果 MUST 与logger可用时相同

### Requirement: Runtime writer 使用精确字段分类和 typed marker

Runtime writer MUST 删除普通diagnostic字段的无边界敏感子串匹配，并按以下固定顺序分类：reserved/writer-owned → special `rawExceptionData` → special `toolInput` → approved semantic → credential → policy omitted → generic bounded value → entry budget。前一分支命中后 MUST NOT 落入后一分支；caller提交的marker MUST NOT被信任为writer净化结果。

Writer-owned字段 MUST 精确限定为 `timestamp | time | level | surface | component | serviceVersion | msg | message | operation | outcome | ownerScope | correlation | tenantId | subjectId | requestContextId | stepId | processState | safeSummary | fallbackReasonCode | err | exception | exceptionType | exceptionCode | exceptionFingerprint | exceptionFrames | exceptionCause | exceptionChainTruncated`。普通caller提交这些字段时writer MUST忽略其值；只有writer或对应可信projector可以设置最终entry中的该字段。

Approved semantic字段和validator MUST 精确限定为：

| 字段 | 合法value |
|---|---|
| `inputTokens`、`outputTokens`、`totalTokens`、`maxOutputTokens`、`tokenLength`、`contentLength` | 非负safe integer |
| `durationMs`、`firstContentLatencyMs`、`modelContentLatencyMs` | 非负finite number |
| `commandExitCode` | signed 32-bit integer |
| `pathPolicyStatus` | 匹配`^[A-Z][A-Z0-9_]{0,63}$`的schema-validated低基数token |
| `messageCountBucket`、`timeoutMsBucket`、`maxOutputTokensBucket` | 本spec前文冻结的对应enum |
| `argumentProjectionStatus`、`resultProjectionStatus` | 本spec前文冻结的对应enum |
| `toolResultStatus`、`reasonCode` | 本spec前文冻结的1至128字符低基数token |
| 六个安全名称/类型数组及其`*Truncated` marker | 本spec前文冻结的来源、item、byte、name和enum规则 |

字段名命中approved表但value未通过validator时writer MUST 省略该字段，MUST NOT回退credential、policy omitted或generic分支。通过validator的approved value MUST原样保留；因此`tokenLength`、`contentLength`、`pathPolicyStatus`、`commandExitCode`不得因字段名子串被擦除。

Credential key MUST 按camelCase、snake_case、kebab-case分为lowercase segment；任一segment命中 `password | passwords | secret | secrets | credential | credentials | authorization | authorizations | cookie | cookies`、名称整体为`token | tokens`、`token | tokens`前一segment为`api | access | auth | refresh | bearer | id`，或相邻segment为 `api` 与 `key | keys` 时，writer MUST把value替换为 `<redacted:credential>`。`tokenLength`、`tokenCount`、`tokenizer`等非credential语义字段 MUST NOT 因包含`token`字样被误伤；合法数值`tokenLength`、`inputTokens`继续由approved semantic保留，而`accessToken`、`accessTokens`、`refresh_token`和`apiKey`仍被净化。

Policy-omitted key MUST 先按camelCase、snake_case、kebab-case分段，再拼接为无分隔符lowercase canonical full key，并且只在精确命中以下集合时把value替换为 `<omitted:policy>`：

```text
prompt rawprompt systemprompt developerprompt thinking reasoning
messages messagecontent modeloutput rawmodeloutput content rawcontent delta streamdelta
toolargs toolarguments capabilityarguments toolresult capabilityresult structuredpayload result output
stdout stderr command environment stack filepath path
rawerror rawproviderbody providerbody providerheaders headers attachmentcontent
```

Policy分支 MUST只用于普通diagnostic，不得覆盖`rawExceptionData`和`toolInput`的现有专用净化规则。Writer MUST NOT使用`contains`、无边界regex或suffix/prefix猜测扩展credential或policy集合。

Generic string和message MUST在截断前扫描`sk-*`、Bearer credential、`password/api-key/token/secret/credential/authorization`赋值以及Windows/POSIX绝对路径；credential值 MUST替换为`<redacted:credential>`，路径 MUST替换为`<omitted:policy>`。Writer MUST读取目标上限外最多512 bytes完成扫描后再按UTF-8边界处理。因字符串容量上限截断时，整个value MUST替换为 `<truncated:N-bytes>`，其中 `N` 只允许 `1-1024`、`1025-4096`、`4097-16384`、`16385+`；同一value不得同时输出原字符串片段和marker。

普通value MUST继续限制为最多64字段、16数组项、6层和1024 UTF-8 bytes字符串；`rawExceptionData`字符串最多2048 UTF-8 bytes；单entry最多16 KiB，destination buffer最多4 MiB。`toolInput`与`rawExceptionData` MUST继续使用各自的专用净化规则。普通字段分类变化 MUST NOT允许raw prompt、thinking、模型输出、Capability result、stdout、stderr、provider body、credential、token、secret、authorization、stack或路径进入observation-derived log。

#### Scenario: 安全统计字段不因子串被擦除

- **WHEN** runtime diagnostic包含通过对应validator的`tokenLength`、`contentLength`、`pathPolicyStatus`和`commandExitCode`
- **THEN** writer MUST保留这些安全语义字段
- **AND** MUST NOT 仅因字段名包含受控子串而输出 redaction marker

#### Scenario: Approved semantic 类型非法时failed closed

- **WHEN** `tokenLength`或其它approved semantic字段的value未通过其固定validator
- **THEN** writer MUST省略该字段
- **AND** MUST NOT把value交给generic sanitizer或因字段名已批准而保留

#### Scenario: Credential 与 policy omission 可区分

- **WHEN**一个 runtime diagnostic 同时包含 credential 字段和当前 surface 禁止的 raw prompt 字段
- **THEN** credential value MUST 输出 `<redacted:credential>`
- **AND** raw prompt MUST 输出 `<omitted:policy>`
- **AND**两者 MUST NOT 使用无法区分原因的通用 `<redacted>`

#### Scenario: Exact full key 不误伤相似安全字段

- **WHEN**普通diagnostic同时包含`content`/`contentLength`、`path`/`pathPolicyStatus`和`command`/`commandExitCode`
- **THEN**writer MUST只把`content`、`path`、`command`替换为`<omitted:policy>`
- **AND**通过validator的三个安全语义字段 MUST原样保留

#### Scenario: Secret scanning 先于 UTF-8 截断

- **WHEN**credential或绝对路径跨越普通字符串目标上限但位于512-byte lookahead内
- **THEN**writer MUST在决定truncation marker前完成credential/path扫描
- **AND**最终entry MUST NOT包含credential、路径或无效UTF-8尾部

#### Scenario: Observation-derived log 仍保持强隔离

- **WHEN** observation candidate 携带 raw model output、Capability result、stack 或路径
- **THEN** writer MUST NOT 把这些值写入 observation-derived destination
- **AND** `diagnosticDetail=debug` MUST NOT 改变该结果
