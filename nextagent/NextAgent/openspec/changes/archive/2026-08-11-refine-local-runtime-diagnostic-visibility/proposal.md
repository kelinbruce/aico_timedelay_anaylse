## Why

Agent 开发者和运维人员当前无法仅凭本地 operational log 定位复杂请求中的真实失败原因。未知异常常被压缩为类型、分类和指纹，统一安全错误只说明请求安全失败；模型调用只保留计数和结束原因，Tool 日志又可能缺少执行步骤坐标。使用者能够确认“发生了失败”，却无法判断触发输入、原始异常、执行位置和相邻模型或 Tool 结果，导致日志无法承担本地问题定位职责。

本地 runtime diagnostic 与面向客户端或外部观测系统的安全投影具有不同信任边界。继续以同一内容裁剪策略处理两者，会牺牲本地诊断能力而没有增加外部输出面的安全收益。本次需要把两类边界明确分开，并以最少规则恢复本地日志的可行动信息。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 本地 operational log 能够按 request、run、step、模型调用和 Tool 调用连续还原一次复杂执行，并直接看到失败原因。
- 本地 runtime diagnostic 保留 Tool 原始输入与输出、仅包含去除全部 `SYSTEM` message 后 `messages` 的模型输入、规范化模型可见输出，以及未知执行异常的 message、stack 和 cause。
- 本地原始诊断只对 credential 和认证类 token 做窄匹配脱敏，路径、命令、业务内容和错误正文保持可诊断。
- Web API、stream、timeline、SafeError、observation-derived log、audit、metric 和 trace 继续只接收安全投影，runtime diagnostic 的原始内容不得扩散。
- 日志写入、净化或容量退化不改变请求、模型、Tool、terminal commit 或客户端结果。
- 默认 `info` operational log 保留业务 lifecycle、会影响执行的 Hook、失败和带 endpoint 的一次性 HTTP 结果，同时不被成功前置检查、纯观察成功 Hook、trace 投影确认或重复不可用状态淹没。
- 每个实际执行的 Model terminal summary 直接给出同一计时边界内的总时延、存在模型反馈时的首次反馈时延，以及 provider 已返回的规范化 usage，使单条终态日志足以判断调用成本与响应速度。

**非目标：**

- 不新增日志文件族、诊断证据存储、远端日志服务、全文索引或新的可配置诊断模式。
- 不把 operational log 提升为 canonical lifecycle truth、audit truth 或 durable replay source。
- 不记录 `SYSTEM` message、模型 reasoning、provider-native raw body、附件二进制内容或任何原始 credential/认证 token。
- 不在 `modelInput` 中记录 Tool descriptors、`modelId` 或其他模型调用选项；这些内容不属于本地模型输入正文。
- 不改变客户端安全错误、模型调用结果、Tool 执行结果、request lifecycle 或现有日志轮转与保留策略。
- 不修改 public Model result contract，不估算、补零或推导 provider 未返回的 usage，也不新增平行 Model timing event。
- 不删除 `request.*`、`model.invocation.*`、`capability.*`、Tool/Model payload、失败或降级事件，不新增采样率、慢请求阈值或日志配置项；成功的纯观察 Hook 与 trace 投影确认只调整到 `debug`。

## What Changes

- **BREAKING** 修改本地 runtime diagnostic 的内容安全边界：原始业务内容不再因为字段名属于 prompt、content、output、command、path、stack 或 message 而被统一省略；credential 和认证类 token 仍必须脱敏。
- 修改未知本地执行异常的可观察结果：所有由 runtime diagnostic error boundary 捕获的异常都输出可关联的原始 message、stack 和 cause，而不是只输出类型和指纹。
- 修改 Tool 调用诊断：原始输入、已有原始输出和可信 `stepId` 在 normal 与 debug 下均可见。
- 修改模型调用诊断：开始事件的 `modelInput` 只输出移除全部 `SYSTEM` message 后的 `messages`；完成事件输出规范化模型可见结果；失败事件输出已有部分结果和原始异常诊断；既有 `model.invocation.completed` / `model.invocation.failed` terminal summary 输出实际可得的 usage、总时延和条件性首次反馈时延。
- 明确本地 runtime diagnostic 与外部安全输出面的隔离：上述原始内容不得进入 observation-derived 或产品输出面。
- 修改默认 `info` 信噪比：Fastify 每个请求只落一条含 method 与规范化 route 的 final access record；成功 owner-scope check、成功纯观察 Hook 和 trace 投影确认下沉 `debug`；同一 Skill source 持续不可用期间只记录一次 warn；Tool local payload 和成功 terminal summary 不重复同义字段。

## Feature 影响（Features）

### 修改的 Feature

- `F-7.1 结构化日志`：本地 operational log 从安全轨迹骨架提升为可直接定位复杂模型、Tool 和执行异常的诊断面，同时保持 observation-derived surface 的安全语义。
- `F-6.6 脱敏`：统一脱敏的适用范围明确收敛到外部和 observation-derived 输出；本地 runtime diagnostic 改为只窄匹配清除 credential 与认证类 token。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-7.1 输出结构化日志` → `specs/runtime-logging/spec.md`
  - 功能边界：本地 runtime diagnostic 输出可关联的模型、Tool 和异常原始诊断；observation-derived log 继续输出安全轨迹事实。
  - 系统质量属性：安全、性能/容量、可靠性/恢复、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`runtime-logging` 是 canonical spec；本次同时触及 legacy `runtime-execution-exception-diagnostics` 中的本地执行异常和模型日志 Requirements，并将其目标行为原子收敛到 canonical spec。
- `FN-6.7 脱敏` → `specs/redaction-policy/spec.md`
  - 功能边界：外部和 observation-derived 输出继续 fail closed；本地 runtime diagnostic 由 `runtime-logging` 的窄凭据脱敏契约治理，不再沿用原始业务内容全面省略规则。
  - 系统质量属性：安全、可维护性、可测试性、审计/可追溯性。
  - 映射说明：`redaction-policy` 是 canonical spec；本次只修改其本地 runtime diagnostic 例外边界。

## 影响范围（Impact）

- 本地 operational log 将包含用户输入、历史消息、Tool 输入输出、命令、路径、模型可见输出和异常正文，运维侧需要继续按现有本地文件权限和保留周期管理该文件。
- 日志消费方可通过稳定 request/run/step/invocation 坐标关联模型、Tool 和异常事件；现有事件查询与 Workbench 读取会看到更多本地诊断字段。
- 公共 Web API、stream 和 `agent-contracts` 不变；不新增配置项。
- runtime logger writer、structured log/trace projector、Web 顶层错误处理、模型调用边界、Tool loop、session owner-scope check、local Skill discovery 及其单元、契约和架构测试受影响。
- 仓库 `AGENTS.md` 的日志技术约束需同步到目标策略，避免开发治理继续要求旧的全面内容省略。
- `add-ts-system-integration-validation-gate` 中 restricted diagnostic boundary 的旧 capability 引用需同步为 canonical `runtime-logging`；该 change 的验证行为不变。
