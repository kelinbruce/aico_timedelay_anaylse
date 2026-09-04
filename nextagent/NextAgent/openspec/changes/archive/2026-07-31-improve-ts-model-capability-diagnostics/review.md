## 审查结果

Change ID：`improve-ts-model-capability-diagnostics`

检查日期：2026-07-28

状态：PASS

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 处理结果 |
|---|---|---|---|---|---|
| F-01 | MEDIUM | 安全边界 | proposal / provider-error-safe-mapping | 初稿允许 model provider 使用 `rawExceptionData`，可能把 provider request/response、header 或 prompt 带入 operational log，超出现有受控 Tool execution exception 例外 | 已修正：model provider 只输出 writer-derived exception type、opaque fingerprint 和 NextAgent-owned frame；禁止 raw message/body/stack |
| F-02 | MEDIUM | 增量设计 | proposal / design | 初始方案可能形成第二套 raw diagnostic capture，与现有 `developer-hook-trace` 重复 | 已修正：现有 `developer-hook-trace` 是 raw model/Capability boundary 的唯一 artifact；本 change 只提升既有坐标 |
| F-03 | LOW | 可执行任务 | tasks 5.1 / 5.2 | 前端定向测试命令需要使用 `frontend/agent-web` 下的 `tests/` 路径 | 已修正为 `tests/failureDetails.test.ts`、`tests/processDetailsProjection.test.ts` 和 `tests/process-history-host-ownership.test.ts` |
| F-04 | HIGH | 失败 trace 边界 | proposal / design / developer-hook-trace-logging | 初稿把 raw model/Capability result 表述为失败路径普遍可用，但当前 model SafeError 和 Capability `FAILED/TIMED_OUT` 不触发 AFTER hook；直接补调 hook会改变既有 lifecycle 行为 | 已修正：只记录实际产生的 boundary；失败使用 BEFORE raw input、owner diagnostic 和 canonical safe failure关联，不补造 AFTER entry或不存在的 raw output |
| F-05 | HIGH | 可实施性 | provider-error-safe-mapping / model contract | 初稿要求每条 provider diagnostic 都携带完整 Agent/session/run/profile 坐标，但 `invocationScope` 和 `modelProfileId` 是可选字段 | 已修正：冻结 producer字段allowlist；run-bound scope 经校验后输出完整坐标，非 run-bound 调用省略缺失字段且不得推断或补位 |
| F-06 | MEDIUM | 重复日志 | design / runtime-logging / executor current code | 当前 `capability.invocation.error` 在 catch 分类前无条件输出，若只追加新事件会让 declared failure误报并使 unknown exception重复 | 已修正：规格明确删除旧 blanket warning，由 `capability.execution.exception_captured` 仅覆盖 unknown exception，并冻结 level和字段范围 |
| F-07 | MEDIUM | KISS / 可追踪性 | design / tasks / runtime-logging | `capability.output.invalid` 只出现在design/tasks，且不携带安全校验细节，相对既有 `tool.call.failed` 和 canonical failure无增量价值 | 已修正：删除该新增事件和独立task；output validation沿用 `CAPABILITY_OUTPUT_INVALID`、`tool.call.failed` 与 `CAPABILITY_COMPLETED`，继续禁止 rejected output |
| F-08 | HIGH | 正常执行诊断 | proposal / design / runtime-logging / tasks | change只冻结失败日志，未把已有request→routing→context→model→Capability/sandbox→terminal正常轨迹纳入目标与验收，无法保证两类人员在不启用hook trace时定位“成功但行为不符合预期” | 已修正：复用并冻结既有observation-derived目录，增加text-only、tool-only、多轮、fallback、并行Capability、空结果和sink failure黑盒验收，不新增第二套正常event |
| F-09 | HIGH | 多轮关联与重复事实 | structured projector / model current code | Model `stepId`被structured log排除且没有等价invocation坐标；direct `model.call.first_content`与observation-derived first-visible重复，多轮/fallback无法稳定配对 | 已修正：只在structured log内部提升安全`stepId`，started/first-visible/completed按run/step关联，并删除重复direct event |
| F-10 | MEDIUM | 安全形态 | model/capability normal path | 正常Model缺少message/tool/options安全形态；generic Capability成功缺少argument/result/generated-message/context-patch有效结构；仅记录各类数量或presence无法定位实际选择和下游效果 | 已修正：Model记录有界可信`disclosedCapabilityNames`和精确匹配后的`resolvedToolNames`；Capability记录schema匹配的argument/result字段名、typed generated-message kind和allowlisted context-patch字段；artifact边界只有高基数ID且无安全type，故完全省略 |
| F-11 | HIGH | 可实施路径 | `DiagnosticCandidate` / structured projector / runtime-logging | 当前candidate只支持标量且structured projector只投影LOW标量，spec要求的名称数组不能按“既有tool diagnostics”直接到达日志 | 已修正：冻结owner→timeline safe payload→可信有界`SAFE/LOW`内部array candidate→StructuredLogProjector固定六key allowlist的唯一路径；不增加public event、`ObservabilityObservationEvent`顶层字段或其它surface投影 |
| F-12 | HIGH | 容量 | runtime-logging / writer 16 KiB budget | 100项×256字符可让单列表超过25 KiB，多个列表会使整条日志被writer替换 | 已修正：Model每列表和Capability每列表均限制4096-byte JSON array；Capability两个schema列表合计限制8192 bytes；按顺序裁剪并保留truncated/status，增加接近16 KiB黑盒验收 |
| F-13 | MEDIUM | 诊断歧义 | capability normal path | 省略name列表同时可能表示空object、无schema properties、无schema匹配、全部被过滤或失败时没有typed result，仍无法定位原因 | 已修正：增加始终输出的`argumentProjectionStatus`/`resultProjectionStatus`；argument使用六个互斥状态，result额外允许`NOT_PRODUCED`，列表和marker只在PROJECTED/PARTIALLY_PROJECTED出现 |
| F-14 | MEDIUM | 业务定位 | capability normal path | 只有result字段名能说明结构，不能说明安全业务结果，例如链路状态或失败原因 | 已修正：复用现有Capability owner `metadata.toolDiagnostics`中的`toolResultStatus`与`reasonCode`低基数安全语义；generic链路禁止读取raw result推导 |
| F-15 | MEDIUM | 安全 | schema property name | 字符格式regex不能阻止`password`、`accessToken`等credential语义schema字段名作为数组值绕过普通key redaction | 已修正：名称按camel/snake/kebab分段并过滤credential完整segment；部分/全部过滤分别由PARTIALLY_PROJECTED/FILTERED表达 |
| F-16 | MEDIUM | Artifact诊断 | capability result contract | 当前只有高基数`ArtifactId`且没有安全type，报表/文件类Capability无法通过普通日志识别产物类型 | 已收敛范围：本change继续禁止artifact数量、presence和ref，并明确安全artifact type属于后续独立`agent-contracts` refinement，不在本change伪造信息 |
| F-17 | MEDIUM | 精确脱敏 | design / runtime-logging / writer current code | change只写“明确集合”和“安全标量allowlist”，未冻结字段表、value validator与canonical key；实现仍可能让`tokenLength`被`token`子串误伤或让approved字段以错误类型绕过 | 已修正：冻结writer-owned字段、approved字段+validator、credential segment、policy canonical full key集合和处理顺序；approved非法value直接省略，并增加`tokenLength`等相似字段对、caller marker和lookahead负例 |
| F-18 | HIGH | 日志落点 | proposal / design / runtime-logging / tasks | observation-derived、candidate和structured entry路径已定义，但未明确“生成投影”不等于“输出日志”，实现可能不把新增字段提交到runtime logger | 已修正：冻结timeline→observation→projector→composition-injected `RuntimeLogger`→physical destination唯一链路，并要求使用真实logger sink做黑盒断言 |

未发现未处理的 BLOCKER、HIGH、MEDIUM 或 LOW finding。

## 需群内确认

None。

本 change 明确不修改 `agent-contracts` 下的 type、DTO、enum、port、public export 或 runtime event schema。新增 SafeError code 仍使用既有 string code/category/retryable 边界，不新增 enum ownership 或公开 DTO shape；developer trace 顶层坐标来自现有 typed hook boundary，不修改 hook contract；正常日志 `stepId` 只属于 `agent-observability` internal structured entry。六个安全名称数组只扩展`agent-observability`内部candidate value与structured-log固定allowlist，不增加`ObservabilityObservationEvent`顶层字段。安全artifact type如进入后续change，必须作为独立contract refinement重新群内确认。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | `agent-model` 继续拥有 provider mapping，`agent-capability` 继续拥有 executor，`agent-log` 继续拥有 writer，`agent-web` 只做浏览器投影 |
| core contracts | PASS | 不修改 request lifecycle、canonical timeline、SafeError shape、model/capability invocation shape 或 owner/Agent scope |
| roadmap owner boundaries | PASS | `agent-observability` 为跨 surface policy 主 owner；各 package 只修改自身既有边界，未迁移主流程 owner |
| roadmap change rules | PASS | change 可独立交付，用户可见目标与系统可验证安全目标明确，非能力组占位 |
| current code | PASS | design 记录可选 model scope、旧 blanket capability warning、失败路径缺少 AFTER hook、正常observation目录、candidate标量限制、composition logger binding、writer 16 KiB预算、被过滤的step和重复first-content，并采用最小增量 |
| engineering principles | PASS | 复用现有 RuntimeLogger、observation-derived catalog、timeline safe payload、developer hook trace、SafeError、owner tool diagnostics和前端utility；未新增第二套bus/store/DTO/event目录 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| 触发机制 | PASS | 正常request/routing/context/model/Capability/sandbox/terminal边界、provider/capability failure、显式hook activation和Web failure projection均有明确触发 |
| 输入和前置条件 | PASS | 可选且需校验的 invocation scope、typed hook boundary、validated provider status/code 和既有 stream/history facts已定义 |
| 输出和副作用 | PASS | 正常entry必须写入composition注入的RuntimeLogger；runtime failure diagnostic、developer artifact、SafeError 与 Web presentation分离 |
| 核心决策逻辑 | PASS | 正常event目录、array投影路径、projection status优先级、item/byte预算、provider分类优先级、writer字段表/value validator/canonical key/处理顺序和frontend事件优先级均唯一 |
| 存量代码基线 | PASS | design 列出现有对象、调用链、测试和 gap |
| 增量实施路径 | PASS | 只扩展当前 owner boundary，不重建 logger、trace、error DTO 或 persistence |
| 唯一实施路径 | PASS | proposal、四个 specs、design 和 tasks 指向同一三-surface路径 |
| 状态或 artifact 契约 | PASS | developer trace 生命周期和消费者保持既有 caller-owned artifact语义 |
| flow 集成 | PASS | request→routing→context→model→Capability/sandbox→terminal正常轨迹及failure diagnostic、hook trace、Web projection上下游清晰 |
| 失败和降级 | PASS | logger/sink failure、array预算/过滤、unknown provider、non-Error、缺失 model scope、失败无 AFTER boundary、disabled trace和unknown frontend code均闭合 |
| 验收示例 | PASS | text-only、tool-only、多轮、fallback、并行、投影状态、byte边界、credential name过滤、安全业务状态、空结果、failure/degradation与security negative均覆盖 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | N/A | 目标不是 roadmap one-pager |
| 创建前覆盖检查 | PASS | 不修改核心 contract，不改变最小内核 owner，可与无关业务 change 并行 |
| 生成后一致性确认 | PASS | artifacts 术语、code、event、owner、非目标和tasks一致；strict validate通过 |
| release scope / not-planned / candidate | PASS | 未引入集中诊断服务、远程上传、Web下载或长期诊断store |
| 并行边界 | PASS | writer、provider、Capability、SDK trace和frontend文件边界明确；跨包集成在第6组收口 |
| 第一性原理/KISS/SOLID | PASS | 从两类客户的真实诊断闭环推导；复用既有边界，避免新增平行机制 |
| 基于存量代码的增量设计 | PASS | 每项delta都有当前代码对象和定向测试入口 |
| 唯一可实施路径 | PASS | 无互斥adapter、catalog、state model或owner方案 |

## 需求和设计清晰度

Requirements 已区分二次开发人员“不启用hook trace时由RuntimeLogger实际输出的安全正常轨迹”“实际存在的raw boundary + owner failure diagnostic”与框架使用人员的安全指导；design 明确正常event目录、run/step/tool-call关联、timeline→observation→projector→RuntimeLogger唯一输出链路、安全数组投影、item/UTF-8预算、projection status、credential name过滤、Capability owner低基数业务状态、artifact延期边界、writer-owned/approved/credential/policy/generic精确脱敏表与顺序、model provider与Capability exception diagnostic的不对称安全策略、旧日志替换规则和失败boundary限制；tasks遵循测试先行并为每个行为给出可重复命令。Spec-to-task可追踪性完整，没有只在tasks中出现的产品行为。

## 已运行校验

- `openspec status --change improve-ts-model-capability-diagnostics`：4/4 artifacts complete。
- `openspec validate improve-ts-model-capability-diagnostics --strict`：通过。
- `openspec validate --all --strict`：259 passed，0 failed。
- 禁止来源措辞与 `agent-contracts` 变更扫描：未发现阻塞项。
- 当前代码冲突复核：已覆盖可选 model invocation scope、Capability catch blanket warning，以及 model/Capability失败不触发 AFTER hook。
- 正常轨迹代码复核：已覆盖existing observation-derived catalog、Model safe timeline payload、`DiagnosticCandidate`标量限制、structured projector LOW标量过滤、writer 16 KiB预算、first-content重复和Capability owner safe tool diagnostics。

## 建议下一步

进入实施前，先执行 tasks 1.1、1.2、2.1、3.1、4.1、5.1、6.1 和 7.1 的失败复现；不得先修改生产代码。
