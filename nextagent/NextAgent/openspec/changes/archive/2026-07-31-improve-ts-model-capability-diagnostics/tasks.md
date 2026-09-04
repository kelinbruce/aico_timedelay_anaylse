## 1. Model provider 可行动分类与安全失败诊断

- [x] 1.1 `agent-model` provider tests：新增认证、模型不存在、限流、请求非法、context limit、网络失败、response invalid、unknown error、cancel 和 timeout 的分类测试，并验证 free-text message 不能改变分类；变更前测试必须按缺失目标行为失败
  来源：行为：`Model 和 Capability 失败具有稳定可行动分类`；Scenario `Provider 认证失败给出配置指导所需分类`、`Provider 限流保留可重试语义`、`未识别 code 安全降级`；`Provider and model failures map into standard safe error semantics`
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts`；实施前新增断言必须失败，且失败点分别指向缺失的 code/category/retryable 或错误的 free-text 分类

- [x] 1.2 `agent-model` provider failure diagnostics tests：新增 complete、stream error part、outer stream catch、普通 SafeError return、logger failure和无 invocation scope/profile 测试，验证每个 caught terminal failure 恰好一个安全 diagnostic、字段/level 精确、无异常时不伪造、缺失可选坐标不补造且 sink failure 不改变结果；变更前测试必须失败
  来源：行为：`Provider 异常在安全归一化前形成安全本地诊断`；Scenario `Provider 异常先诊断后归一化`、`正常安全失败结果不伪造异常`、`诊断 sink 失败不改变模型结果`、`非 run-bound model invocation 不伪造执行坐标`
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts packages/agent-log/tests/runtime-logger.test.ts`；实施前新增断言必须因缺失 `model.provider.failure_captured` 失败

- [x] 1.3 `agent-model` provider adapter：实现基于 validated status/stable provider code/transport kind 与 cancellation state 的唯一有序 classifier，complete 和 stream 复用同一映射；完成后所有目标 SafeError 分类稳定且不解析 provider free-text
  来源：行为：`Model 和 Capability 失败具有稳定可行动分类`；design `2. Model provider 分类与安全异常证据`
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts`；1.1 的全部分类、优先级和 free-text 负例通过

- [x] 1.4 `agent-model` RuntimeLogger 接入：在捕获并消费 provider terminal failure 的 owner boundary以 `error` level 输出一次 `model.provider.failure_captured`，只传 spec allowlist 中的标准 `err` 与当前可用安全关联字段，不传 `rawExceptionData`，缺失 scope/profile 时省略对应字段；完成后 diagnostic failure 不影响返回结果
  来源：行为：`Provider 异常在安全归一化前形成安全本地诊断`；design `2. Model provider 分类与安全异常证据`
  验证：`npm test -- packages/agent-model/tests/openrouter-provider.test.ts packages/agent-log/tests/runtime-logger.test.ts && npm run lint:architecture`；1.2 场景通过，manifest 声明 `agent-common` 直接依赖，architecture gate 无非法依赖

## 2. Capability executor 失败分类与异常消费

- [x] 2.1 `agent-capability` characterization/failure tests：新增 input invalid、output invalid、declared degraded/failed/timed-out、SafeError 和 unknown Error 分支断言，验证只有 unknown Error 产生一次字段/level 精确的 execution exception、旧 `capability.invocation.error` 不再输出、output invalid 只沿用 outer安全失败事实且 logger failure 不改变 result；变更前新增 unknown diagnostic 断言必须失败，既有分支必须继续通过
  来源：行为：`Model 和 Capability 失败具有稳定可行动分类`；Scenario `Capability 输出不符合 schema`、`未识别 code 安全降级`；`Capability executor 在有损归一化前记录本地执行异常`；Scenario `未知 Capability 异常在转换前被消费`、`已声明 Tool failure 不重复记录未知异常`、`Capability output validation 使用既有安全失败日志`、`Logger 不可用时执行语义不变`
  验证：`npm test -- packages/agent-capability/tests/tool-framework.test.ts`；实施前既有 characterization 通过，新增 unknown diagnostic 断言失败

- [x] 2.2 `BuiltinToolsExecutor`：删除 catch 入口无条件的 `capability.invocation.error`，按现有 catch 顺序保留 declared Tool/SafeError 结果，仅对 unknown exception以 `error` level输出一次字段 allowlist 固定的 `capability.execution.exception_captured` 后返回 `CAPABILITY_EXECUTION_FAILED`；完成后 outer tool loop只记录安全 failure result，不接收或重复打印同一原始异常
  来源：行为：`Capability executor 在有损归一化前记录本地执行异常`；design `3. Capability executor 消费 unknown exception`
  验证：`npm test -- packages/agent-capability/tests/tool-framework.test.ts tests/agent-kernel/capability-governance.test.ts tests/agent-kernel/logging.test.ts`；unknown、declared、logger failure 和 exact-one 断言全部通过

## 3. Runtime writer 精确分类

- [x] 3.1 `agent-log` redaction tests：逐项覆盖writer-owned字段防伪、approved semantic字段合法/非法类型、`tokenLength`/`contentLength`/`pathPolicyStatus`/`commandExitCode`安全保留、credential camel/snake/kebab segment、policy canonical full key精确集合、相似安全字段对、caller伪造marker、512-byte lookahead与UTF-8 truncation bucket，以及`toolInput`、`rawExceptionData`和observation-derived debug负例；变更前精确分类与typed marker断言必须失败
  来源：行为：`Runtime writer 使用精确字段分类和 typed marker`；Scenario `安全统计字段不因子串被擦除`、`Approved semantic 类型非法时failed closed`、`Credential 与 policy omission 可区分`、`Exact full key 不误伤相似安全字段`、`Secret scanning 先于 UTF-8 截断`、`Observation-derived log 仍保持强隔离`
  验证：`npm test -- packages/agent-log/tests/runtime-logger.test.ts`；实施前新增字段表、validator、顺序、marker断言失败，既有secret leakage断言继续通过

- [x] 3.2 `agent-log` ordinary field sanitizer：删除无边界`FORBIDDEN_KEY`，按spec冻结的writer-owned字段表、special branch、approved字段+validator表、credential segment、policy canonical full key集合和generic bounded value固定顺序实现；approved value非法时直接省略，caller marker不可信；完成后`tokenLength`等安全值保留且禁止原文仍被隔离
  来源：行为：`Runtime writer 使用精确字段分类和 typed marker`；design `6. 精确字段分类与 typed marker`
  验证：`npm test -- packages/agent-log/tests/runtime-logger.test.ts`；3.1 的字段表、value validator、顺序、canonical exact-key、误伤负例和特殊分支全部通过

- [x] 3.3 `agent-log` typed marker/truncation：只由writer生成`<redacted:credential>`、`<omitted:policy>`和固定byte-bucket `<truncated:N-bytes>`，generic string/message先读取最多512-byte lookahead完成credential/path扫描，再以整个value marker表达截断；完成后同一值不同时输出原文片段和marker
  来源：行为：`Runtime writer 使用精确字段分类和 typed marker`；Scenario `Credential 与 policy omission 可区分`；design `6. 精确字段分类与 typed marker`
  验证：`npm test -- packages/agent-log/tests/runtime-logger.test.ts`；credential、policy omission、lookahead、UTF-8边界、四个truncation bucket、caller marker、entry-too-large和canary negative断言通过

## 4. Developer trace 关联坐标

- [x] 4.1 `agent-plugin-sdk` trace tests：覆盖四个实际产生的 model/Capability hook stage 顶层坐标提升、可选坐标省略、SDK formatter 与生成 plugin artifact 同形，并在 agent-core characterization 中断言 model SafeError及Capability `FAILED/TIMED_OUT` 不补造 AFTER entry；变更前新增坐标断言必须失败
  来源：行为：`Developer hook trace 使用既有执行坐标关联内部失败诊断`；Scenario `Model raw boundary 与 provider failure 可关联`、`Capability raw boundary 与执行失败可关联`、`可选坐标缺失时不伪造`、`Model 失败没有 AFTER boundary`、`Capability 失败没有 AFTER boundary`
  验证：`npm test -- packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`；实施前新增顶层字段断言失败

- [x] 4.2 `developer-hook-trace` formatter 与 artifact generator：只从当前 typed boundary 提升 step/model profile/toolCall/capability invocation 坐标，保持 raw boundary、既有 stage/触发时机、observe-only、caller-owned sink 和默认不 activation；不得为失败补造 AFTER entry
  来源：行为：`Developer hook trace 使用既有执行坐标关联内部失败诊断`；design `4. Developer trace 只提升既有 boundary 坐标`
  验证：`npm test -- packages/agent-plugin-sdk/tests/plugin-sdk.test.ts`；SDK plugin 与生成 artifact 对四个 stage 产生同形坐标，缺失字段不被伪造

## 5. 正常执行日志目录与安全形态

- [x] 5.1 正常轨迹 characterization tests：为app composition注入可捕获entry的真实`RuntimeLogger` test sink，覆盖text-only、tool-only、多轮Model→Capability→Model、fallback、并行Capability、schema匹配字段、generated-message/context-patch安全类型、无有效结构信息和sandbox路径；直接断言logger收到既有event目录、run/step/capability invocation关联、条件事件和exact-one，并增加“mapper/`toStructuredLogEntry`结果正确但projector未调用logger”必须失败的负例；变更前测试必须因缺失顶层step、有效结构字段、RuntimeLogger写入或重复first-content失败
  来源：行为：`正常执行使用单一可关联的安全日志目录`；Scenario `Text-only正常请求形成闭合轨迹`、`正常结构信息写入 RuntimeLogger`、`Tool-only与多轮调用可区分`、`Capability成功结果使用可信schema字段定位`、`Capability结构无法投影时给出明确原因`、`Generated message和context patch输出安全类型信息`、`没有有效结构信息时不输出无意义数量`、`Fallback与并行Capability保持唯一关联`
  验证：`npm test -- packages/agent-app/tests/runtime-trajectory-observability.test.ts packages/agent-app/tests/logging-composition.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/structured-log-projector.test.ts`；logger sink中的目录、字段、顺序、条件事件和无重复断言全部通过，单独的mapper/projector返回值不得替代RuntimeLogger断言

- [x] 5.2 Model正常轨迹生产：由`agent-core/RunBoundModelInvocation`在既有safe timeline payload中写入通过安全name规则、100项和4096-byte JSON array预算的`disclosedCapabilityNames`，并仅对Model tool call与本次披露descriptor精确匹配后回填`resolvedToolNames`及truncated marker；`timeline-safe-payload-schemas`验证name、item/byte预算和marker；继续写入message/timeout/output-token bucket并删除direct `model.call.first_content`；不得修改`agent-contracts`、记录未匹配模型tool name或复制其它message/tool列表
  来源：行为：`正常执行使用单一可关联的安全日志目录`；Scenario `Tool-only与多轮调用可区分`、`未匹配或不安全Tool name不进入正常日志`；design `5. 正常执行轨迹与安全形态`
  验证：`npm test -- packages/agent-core/tests/agent-routing-core-observability.test.ts packages/agent-core/tests/timeline-safe-payload-schemas.test.ts`；披露Capability name、已解析Tool name、未匹配name不泄漏、100项/4096-byte边界与truncated marker通过

- [x] 5.3 安全数组内部投影与RuntimeLogger接线：扩展`agent-observability`内部`DiagnosticCandidate`接受bounded string array，timeline mapper只为六个固定key从已验证safe payload建立`SAFE/LOW` array candidate，`StructuredLogProjector`只投影该固定allowlist并提升`stepId`，app composition把完整entry提交给既有`RuntimeLogger`；trace/metric/audit及其它projector忽略所有array-valued candidate，不增加`ObservabilityObservationEvent`顶层字段或event目录，不允许owner package直接补写同语义日志
  来源：行为：`正常执行使用单一可关联的安全日志目录`；design `5. 正常执行轨迹与安全形态`
  验证：`npm test -- packages/agent-app/tests/logging-composition.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts packages/agent-observability/tests/structured-log-projector.test.ts packages/agent-observability/tests/trace-projector.test.ts packages/agent-observability/tests/audit-projector.test.ts`；六个数组经唯一链路进入RuntimeLogger，非法key/value/预算failed-closed且其它surface零投影

- [x] 5.4 Capability结构摘要生产：由`agent-core/tool-loop`在同时持有可信descriptor schema、typed arguments与typed result的现有边界生成schema精确匹配的`validatedArgumentNames`/`validatedResultFieldNames`、唯一`argumentProjectionStatus`/`resultProjectionStatus`、typed `generatedMessageKinds`和allowlisted `contextPatchFields`；按100项、单列表4096 bytes、两列表合计8192 bytes和credential segment规则过滤，并写入既有timeline safe payload；不得读取artifact、输出数量/presence或让mapper读取raw arguments/result推断
  来源：行为：`正常执行使用单一可关联的安全日志目录`；design `5. 正常执行轨迹与安全形态`
  验证：`npm test -- packages/agent-core/tests/agent-routing-core-observability.test.ts packages/agent-app/tests/runtime-trajectory-observability.test.ts`；argument六种projection status、result额外`NOT_PRODUCED`、schema匹配/未匹配key、credential segment、item/单列表/合计byte边界、`USER`/`USER_META`、context patch allowlist、并行坐标和raw value canary零泄漏通过

- [x] 5.5 Capability安全业务状态：复用现有`metadata.toolDiagnostics`固定key过滤，只允许Capability owner提供通过低基数value校验的`toolResultStatus`与`reasonCode`进入`capability.completed`；generic tool-loop、mapper和projector不得从structured result value推导或补造
  来源：行为：`正常执行使用单一可关联的安全日志目录`；Scenario `Capability owner安全业务状态支持业务定位`；design `5. 正常执行轨迹与安全形态`
  验证：`npm test -- packages/agent-core/tests/agent-routing-core-observability.test.ts packages/agent-observability/tests/timeline-observation-mapper.test.ts`；owner提供值可见，未知key、高基数/不安全value及raw result同值canary不可见

- [x] 5.6 正常日志non-throwing、容量与安全负例：让structured projector/logger分别throw、drop和拒绝entry，验证所有正常业务结果不变；构造100项内但超过byte预算、单项超长及总entry接近16 KiB边界，并在message、Capability arguments/result、artifact、generated message、context patch、stdout/stderr放置canary
  来源：行为：`正常执行使用单一可关联的安全日志目录`；Scenario `正常日志sink失败不改变执行`
  验证：`npm test -- packages/agent-app/tests/runtime-trajectory-observability.test.ts packages/agent-log/tests/runtime-logger.test.ts tests/agent-kernel/logging.test.ts`；关联/status/duration entry不因名称预算被整条替换，执行语义不变且operational log中所有raw canary为零

## 6. 框架使用人员可行动失败呈现

- [x] 6.1 `agent-web` failure presentation tests：新增全部 model/capability code 到阶段、重试指导和 remediation key 的映射，覆盖 unknown code、事件优先级、live/history 与三宿主复用；变更前新增断言必须失败
  来源：行为：`使用者失败呈现包含阶段和固定修复指引`；Scenario `框架使用人员看到可行动的模型认证失败`、`Capability 输入非法指导修改输入`、`未识别 code 安全降级`
  验证：`cd frontend/agent-web && npm test -- tests/failureDetails.test.ts tests/processDetailsProjection.test.ts tests/process-history-host-ownership.test.ts`；实施前新增阶段/remediation 断言失败

- [x] 6.2 `agent-web` shared failure utility 与本地化资源：实现唯一 code/category/event mapping并供 local、immersive、collaborative workspace复用；完成后 unknown code 保留错误码且 process panel 不崩溃
  来源：行为：`使用者失败呈现包含阶段和固定修复指引`；design `7. 可行动失败前端投影`
  验证：`cd frontend/agent-web && npm test -- tests/failureDetails.test.ts tests/processDetailsProjection.test.ts tests/process-history-host-ownership.test.ts && npm run build`；全部映射、unknown fallback、多宿主所有权和 TypeScript build 通过

## 7. 跨 surface 安全与关联验收

- [x] 7.1 同一 run 诊断关联 integration test：启用 developer trace，分别触发 model provider failure 和 Capability unknown exception，验证 BEFORE raw boundary、runtime diagnostic、canonical safe failure 与 Web projection 通过既有可信坐标关联且失败 diagnostic exact-one；另以成功调用验证 AFTER raw result 保持既有行为，并断言失败路径不补造 AFTER entry；变更前测试必须因缺失关联字段/owner diagnostic 失败
  来源：行为：`Developer hook trace 使用既有执行坐标关联内部失败诊断`、`客户可见失败不暴露开发诊断原文`；design `1. 单一责任与唯一实施路径`
  验证：`npm test -- packages/agent-app/tests/runtime-trajectory-observability.test.ts tests/agent-kernel/logging.test.ts`；关联坐标、exact-one 和业务结果不变断言通过

- [x] 7.2 跨 surface canary negative test：把不同 canary 放入 prompt、model output、Capability input/output、provider error、credential、path 和 stack，实际触发 Web/SSE/history/timeline/audit/metric/trace/log 投影，断言只有批准的 developer trace或Capability execution exception diagnostic含对应允许值
  来源：行为：`客户可见失败不暴露开发诊断原文`；Scenario `开发诊断已启用但客户 surface 保持安全`；design `质量属性设计（Quality Attributes）`
  验证：`npm test -- tests/agent-kernel/logging.test.ts packages/agent-log/tests/runtime-logger.test.ts packages/agent-observability/tests/routing-evidence-redaction.test.ts packages/agent-app/tests/otel-observability-adapter.test.ts`；所有禁止 surface canary 断言为零泄漏

- [x] 7.3 Architecture negative tests：禁止新增 `agent-contracts` 字段、`ObservabilityObservationEvent`顶层字段、第二套 raw trace、第二套正常event目录、diagnostic store、raw observation candidate、array-valued candidate被非structured-log projector消费或业务 package concrete logger依赖，并断言 `agent-model` 只依赖 `agent-common` RuntimeLogger contract
  来源：design `1. 单一责任与唯一实施路径`、`验证策略（Verification Strategy）`
  验证：`npm run lint:architecture`；实际非法 fixture/import/field pattern 被 gate 拒绝，产品代码依赖图通过

- [x] 7.4 完成定向和全量验证并执行 `$nextagent-code-review`：记录每条命令实际结果，P0/P1 清零后才允许勾选 change tasks
  来源：design `验证策略（Verification Strategy）`；proposal `目标与非目标（Goals / Non-Goals）`
  验证：`openspec validate improve-ts-model-capability-diagnostics --strict && npm run build && npm test && npm run test:contract && npm run lint:architecture && cd frontend/agent-web && npm run build && npm test -- --minWorkers=1 --maxWorkers=1`；全部退出码为 0。后端 build通过，常规测试117个文件/1110个用例通过（另有既有skip），contract 39个文件/331个用例通过，architecture 40个文件/242个用例通过且依赖检查无违规；前端build与三宿主`build:vite:modes`通过，串行全量137个文件/1607个用例通过；release配置下`tests/agent-kernel/logging.test.ts` 11个用例通过。OpenSpec authoring门禁`$nextagent-skill-review`结论为 PASS；push前`$nextagent-code-review`结论为 PASS WITH FOLLOW-UP且P0/P1为0，follow-up仅为既有`chat-page.route-state.test.tsx`在默认并发全量运行中的时序波动，该文件独立运行99/99通过且串行全量通过，不属于本change实现回归。

## 归档前更新基线检查（非实施任务）

实现和验证完成后，归档流程按照 proposal 的“归档前更新基线”归并长期事实，并检查 `actionable-execution-failure`、`provider-error-safe-mapping`、`runtime-logging` 与 `developer-hook-trace-logging` 没有重复定义同一 SafeError、raw boundary、writer policy、owner 或关联语义。
