## 背景与问题（Why）

NextAgent 当前同时服务框架二次开发人员和框架使用人员。现有安全边界能够阻止 prompt、模型输出、Capability payload、provider 原始响应和凭据进入 Web、stream、timeline、audit、metric、trace 与常规 observation，但诊断链路存在四个可验证缺口：

- `agent-model` 在 provider adapter 内把未知异常归一化为通用 `SafeError`，`agent-capability` 在 executor 内把未知执行异常转换为通用失败结果；执行根获得的通常已不是原始异常，已有 `rawExceptionData` 例外无法覆盖这些失败。
- `developer-hook-trace` 已能按显式 activation 捕获实际执行到的模型和 Capability raw boundary；成功结果存在对应 AFTER boundary，失败路径至少保留 BEFORE input boundary。它不拥有 provider/capability 内部异常，且常规日志无法给出这些失败的可关联根因。
- 框架使用人员主要看到粗粒度 code/category。认证失败、限流、模型不存在、请求非法、输入 schema 不合法、输出 schema 不合法和依赖不可用可能收敛为相同的通用提示，无法据此重试、修正输入或调整配置。
- observation-derived operational log 已输出 request、routing、context、model、Capability、sandbox 和 terminal 的正常轨迹，但当前没有冻结跨阶段事件目录、exact-one 规则和安全形态字段。Model `stepId` 被 structured projector排除，tool-only、多轮和 fallback无法稳定配对；Capability成功日志也没有统一表达 argument/result形态、artifact、generated message或context patch。

当前 operational writer 还使用宽泛字段名匹配阻止敏感内容。安全值只要字段名包含 `content`、`path`、`command` 等片段，也可能整体变成 `<redacted>`，使开发人员无法区分“值被策略删除”“值被截断”和“上游没有产生值”。继续放宽常规日志会扩大敏感数据留存面；继续只返回通用安全错误则无法满足电信网络任务的问题定位、恢复指导和客户集成要求，因此需要在不突破现有安全边界的前提下拆分开发诊断与使用者错误指导。

术语：

- **开发诊断原文（developer diagnostic raw data）**：只存在于显式启用的 `developer-hook-trace` artifact 或本地 runtime execution exception diagnostic 中、用于二次开发排障的模型/Capability boundary 值或原始异常。它不是常规 operational observation，不是业务事实，也不得进入客户可见 surface。
- **可行动失败（actionable failure）**：使用稳定 code、category、retryable、失败阶段和安全修复指引表达的失败结果；它不包含被拒绝的原值、prompt、模型输出、Capability payload、provider body、stack、路径或 credential。

规范上下文：

- 本 change 的 raw model/Capability input/output 唯一来源仍是显式 activation 的 `developer-hook-trace`，默认不启用。
- 本地 runtime execution exception diagnostic 只增加 model provider 和 Capability executor 的消费边界；不新增远程采集或客户可见 raw API。
- `SafeError` 继续是跨 model/capability/runtime/channel 的公开安全失败边界；本 change 不改变其 TypeScript shape。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 二次开发人员启用既有 `developer-hook-trace` 后，能够关联同一 run 中实际产生的 raw model request/result、raw Capability arguments/result，以及 provider/capability 内部失败的受控异常诊断；失败没有 AFTER boundary 时，必须仍能使用 BEFORE input boundary、owner diagnostic 和 canonical safe failure 完成关联。
- Model provider 在归一化前产生恰好一次安全异常证据；Capability owner 在现有受控 execution exception 例外内保留原始异常诊断；两者都继续向上层返回安全归一化结果。
- 框架使用人员能够从既有 Web process/failure surface 看到稳定失败类型、失败阶段、是否可重试和固定修复指引，不需要接触 raw 数据。
- 常规 operational log 按固定优先级使用精确字段名、canonical full key或明确结构路径分类；approved semantic字段冻结字段名、类型和值域，确保`tokenLength`、`contentLength`、`pathPolicyStatus`、`commandExitCode`等安全值不因子串误伤；credential、policy omission和容量截断使用可区分的稳定marker。
- 不启用 `developer-hook-trace` 时，二次开发人员仍能从 app composition 注入的 `RuntimeLogger` 实际输出中判断同一 run 的 request、routing、context、model、Capability、sandbox 和 terminal 路径，并通过可信 Capability/Tool name、schema匹配的参数/结果字段名及其投影状态、generated message kind、context patch字段和Capability owner提供的安全业务状态解释 tool-only、多轮、fallback、空结果和成功但未产生下游效果；该能力不承诺恢复语义原文。
- 所有新增诊断保持 bounded、non-throwing；run-bound 调用使用 owner/Agent/run 坐标关联，非 run-bound model 调用只使用实际可用的 request/step/provider 坐标。raw boundary与owner exception diagnostic通过负例证明不会进入 Web、SSE、WebSocket、timeline、SafeError、audit、metric、trace或`ObservabilityObservationEvent`；正常路径批准的安全名称/类型只允许经既有timeline→observation→structured-log路径进入本地operational log，不得被其它projector消费。

**非目标：**

- 不在默认配置中启用 `developer-hook-trace`，不自动收集 raw prompt、模型输出、thinking、Capability input/output。
- 不提供浏览器下载、远程上传、集中检索或长期持久化 developer trace 的新 API。
- 不把 raw provider body、raw model output、raw Capability result 或 stack 加入常规 structured observation、SafeError、timeline 或客户可见响应。
- 除本change明确允许的有界可信Capability/Tool name、schema匹配的argument/result字段名及投影状态、generated-message kind、context-patch字段名和Capability owner提供的低基数安全业务状态外，不为正常路径日志记录 message/ref列表、模型生成但未解析的tool name、tool arguments/result value、stdout/stderr、artifact ref或内容、generated message内容、context patch value或模型可见文本。
- 当前Capability result只有高基数`ArtifactId`且没有安全artifact type；本change不记录artifact数量、presence或ref，也不修改`agent-contracts`补充artifact类型。artifact业务类型诊断必须由后续独立contract refinement定义。
- 不为取得失败 raw result 改变 lifecycle hook stage、在失败路径补造不存在的 AFTER boundary，或让 observe-only developer trace 改变 model/Capability 失败语义；未形成可返回 result 的 thrown failure 本身不存在可记录的 raw output。
- 不修改 `ModelInvocationRequest`、`ModelFinalResult`、`CapabilityInvocationRequest`、`CapabilityInvocationResult`、`SafeError` 或 `RunTimelineEvent` 的 `agent-contracts` shape。
- 不改变 request lifecycle、fallback policy、Capability routing、retry policy、terminal commit、Agent Scope 或 Owner Scope。
- 不建立第二套 developer trace、通用 diagnostic event bus、通用 error registry 或独立诊断持久化 store。

## 变更范围（What Changes）

- 修改 model provider safe mapping：对 provider 认证、限流、模型不存在、请求非法、超时、网络不可用、stream/response schema 非法和未知内部异常给出互斥的稳定安全 code/category/retryable；在 safe mapping 前输出一次只含稳定状态、异常类型/fingerprint 和当前可用可信关联坐标的安全本地 diagnostic，不记录 raw provider error，不伪造可选 invocation scope。
- 修改 Capability executor 失败处理：输入 schema、输出 schema、依赖不可用、已声明 Tool failure/timeout 和未知执行异常保持可区分；用仅针对 unknown exception 的 `capability.execution.exception_captured` 替换现有 catch 入口无条件输出的 `capability.invocation.error`，并在转换成安全 `CapabilityInvocationResult` 前输出一次受控本地 execution exception diagnostic。
- 修改 runtime logging redaction：普通字段继续禁止敏感原文，但按冻结的writer-owned字段、special branch、approved semantic字段表、credential segment和policy-omitted canonical key表依次分类，不使用无边界子串判定；approved字段类型非法时省略且不得回退generic分支；用typed marker区分credential redaction、policy omission和truncation。`toolInput`、`rawExceptionData`与developer trace各自保持现有专用净化边界。
- 补实现有 observation-derived 正常执行目录：不新增平行事件，使用已有 request/routing/context/model/Capability/sandbox/terminal 事件；提升 `stepId` 关联 Model 多轮，记录可信披露Capability name、已解析Tool name、schema/typed-contract确认的Capability结构名称及投影状态，并复用现有`toolResultStatus`/`reasonCode`安全业务语义；所有名称列表受item与UTF-8聚合预算约束，只由structured-log projector消费，投影后的完整entry必须交给app composition注入的`RuntimeLogger`写入现有runtime log destination；以已有 `model.stream.first_visible_content` 取代重复的 direct `model.call.first_content`。
- 修改 `developer-hook-trace` 关联行为：现有六个 hook stage、触发时机和 raw boundary 字段保持不变；启用后的 entry 必须提升当前 boundary 已提供的 run、hook invocation、tool call 或 capability invocation 坐标。失败路径未产生 AFTER boundary 时，不补造 raw result entry，使用 BEFORE boundary 与 owner diagnostic 关联。
- 修改 Web failure presentation：基于现有 safe code/category 和 timeline 坐标投影失败阶段、retryable 与固定修复指引；未知 code 继续安全降级，不展示 raw detail。
- 增加跨 surface 安全与一致性验证，证明 raw 数据只存在于批准的本地诊断面，使用者提示与 operational trajectory 能通过既有可信坐标关联。

## Capability 影响（Capabilities）

### 新增 Capability

- `actionable-execution-failure`：使用既有安全错误与可信执行坐标，为框架使用人员提供稳定失败阶段、重试性和固定修复指引。

### 修改的 Capability

- `provider-error-safe-mapping`：细化 provider/model 失败的安全分类，并在归一化前保留本地受控异常诊断。
- `runtime-logging`：扩展 model/capability execution exception 诊断边界，冻结正常执行日志目录与安全形态，并收紧精确字段脱敏语义。
- `developer-hook-trace-logging`：冻结 raw boundary trace 与失败诊断之间的关联坐标，不新增第二套捕获机制。

## 影响范围（Impact）

- 代码：`agent-model` provider adapter/error normalizer、`agent-capability` executor、`agent-log` operational writer、`agent-plugin-sdk` developer hook trace formatter、`agent-core`/`agent-observability` 的正常/失败关联字段投影，以及 `frontend/agent-web` process/failure presentation。
- 配置：沿用现有 plugin activation 与 `observability.logging` 配置，不新增默认启用项。
- API：Web/stream 继续使用既有事件与安全字段；不新增 endpoint，不暴露 developer trace。
- 测试：增加 model/capability characterization、正常执行事件目录与多轮关联、runtime log redaction negative、developer trace correlation、stream leakage、前端三宿主一致性和端到端失败指导验证。
- 运维：本地 developer trace 与 operational log 仍是两个不同 artifact；现有文件轮转和 retention 不接管 caller-owned developer trace。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/provider-error-safe-mapping/spec.md`：归并安全失败分类和归一化前本地诊断要求。
- `openspec/specs/runtime-logging/spec.md`：归并 model/capability execution exception、正常执行日志目录与 typed redaction marker 要求。
- `openspec/specs/developer-hook-trace-logging/spec.md`：归并关联坐标要求。
- `openspec/specs/actionable-execution-failure/spec.md`：新增可行动失败呈现要求。
- `openspec/overview.md`：补充二次开发人员与框架使用人员的双层诊断目标。
- `openspec/designs/architecture/observability-boundaries.md`：更新 developer trace、runtime diagnostic 与客户可见安全失败的边界。
- `openspec/designs/modules/agent-model.md`：更新 provider 失败分类和原始异常消费边界。
- `openspec/designs/modules/agent-capability.md`：更新 executor 失败分类和原始异常消费边界。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：按需增加执行失败诊断与指导导航，不重复行为契约。
- `openspec/designs/spec-to-design-map.md`：增加四个受影响 capability 到设计与验证入口的导航。

长期基线更新由归档流程执行，不是实施阶段默认任务。
