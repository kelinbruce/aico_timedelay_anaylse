## 背景和现状（Context）

执行失败目前仅有安全摘要，排障无法关联异常链、sandbox 路径、模型首段内容延迟和本轮工具可用性。现有代码已经通过本地 `RuntimeLogger` 输出，并在配置时追加 `runtime.log`，但 stable OpenSpec 将所有 raw exception、stack 和路径视为统一 observation 禁止字段，形成 implementation-vs-spec gap。

本 change 的确认前提是：执行异常数据可用于本地排障，sandbox 路径不是宿主真实路径；但 credential、token 和 prompt 仍必须受保护。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 定义唯一的本地 execution diagnostic 例外，使 Tool/terminal 执行异常可经 `RuntimeLogger` 输出，且写入配置的 `runtime.log`。
- 保留现有客户端安全错误和统一 observability redaction 边界。
- 提供模型首段内容延迟、可用工具数量/名称和零 tool call 轮次诊断。

**非目标：**
- 不改变 Web、SSE、WebSocket、timeline、SafeError、audit、metric、trace 或 `ObservabilityObservationEvent`。
- 不新增 logging mode、第二套 projector、配置开关或产品 API。
- 不记录 prompt、工具参数、模型内容、credential 或 token。

## 设计决策（Decisions）

### D1：采用本地 runtime diagnostic 例外，而非放开统一 observation redaction

`runtimeRawExceptionData(...)` 是 `agent-common` 的唯一异常序列化入口；`agent-core` Tool loop 和 `agent-runtime` terminal submit 只附加其结果到已有 `RuntimeLogger` 事件。`agent-log` 只对该受控字段执行保留路径和 URL 的二次防御性脱敏，并追加至配置的 operational runtime log 文件；不构造 `ObservabilityObservationEvent`，也不被 projector 消费。

放弃“扩展 debug mode”方案：它会改变统一 structured log 的安全语义，并可能扩散到 audit、metric 和 trace。放弃“每个执行 owner 自行序列化”方案：会形成平行字段规则。

### D2：异常字段规则固定且无配置开关

serializer 保留 name、message、stack、cause 和 JSON 异常字段；命名凭据字段、`prompt` 和文本中凭据形态脱敏。长/带空白文本最多保留 96 字符 excerpt。sandbox 路径和 URL 保留。循环引用以固定标识终止。

### D3：模型 loop 诊断只使用安全元数据

`DefaultAgent` 在每次模型调用的首段非空 content 记录 `model.call.first_content`，利用 logger `time` 作为到达时刻并记录 `firstContentLatencyMs`。模型请求诊断共享 `toolCount` 和 descriptor `toolNames`；返回零 tool call 时记录 `tool.loop.no_tool_calls`。所有这些日志不含 content 或 arguments。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | raw exception 只允许经本地 RuntimeLogger 进入 runtime diagnostic，配置的 operational runtime log 文件必须包含；credential/token/prompt 脱敏，禁止其他输出面消费。 | runtime logger、tool failure、terminal submit 测试；代码审查 |
| 性能/容量 | 同步字段序列化仅发生在失败路径；文本 excerpt 上限 96 字符。 | focused Vitest、`npx tsc --noEmit` |
| 可靠性/恢复 | logger 写入失败不得改变 Tool 或 terminal 结果；循环异常对象终止。 | RuntimeLogger 既有无副作用行为、focused Vitest |
| 可维护性 | 一个 `agent-common` serializer 和一组固定字段规则；无配置分支。 | code review、TypeScript 编译 |
| 可测试性 | 通过 runtime log 文件和 RuntimeLogger capture 验证结构化事件，不依赖 logger 私有实现。 | common/core/kernel focused Vitest |
| 审计/可追溯性 | runtime log 关联 run 坐标、首段延迟和工具清单；不作为 audit 或 trace 事实。 | observability focused Vitest |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Tool 与 terminal 异常写入受控 rawExceptionData | 1.1 | runtime logger、capability governance、runtime foundation tests |
| rawExceptionData 不扩散到产品输出面 | 1.2 | tool/runtime focused tests、code review |
| 首段延迟、工具清单和零调用轮次不含内容/参数 | 1.3 | agent routing core observability test |
| 变更符合 OpenSpec 与 TypeScript | 2.1 | `openspec validate allow-runtime-execution-exception-diagnostics --strict`、`npx tsc --noEmit` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`runtime-execution-exception-diagnostics` 是本地执行异常诊断的主承载；`redaction-policy` 和 `structured-logging` 只承载其与统一观测边界的关系。
- 架构和跨模块设计：归档前更新 `openspec/designs/architecture/observability-boundaries.md`。
- 模块设计：归档前更新 `openspec/designs/modules/agent-common.md` 和 `openspec/designs/modules/agent-core.md`。
- ADR：无；这是受控现有本地诊断输出的行为边界，不新增可替换架构策略。
- 导航：归档前更新 `openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [本地日志被更广泛读取] -> 该例外仅限执行异常，保留 credential/token/prompt 脱敏和 96 字符文本上限。
- [模型/提供方异常可能经过 terminal submit] -> 规格明确该诊断不进入任何产品输出面；依赖已确认的执行异常数据前提。
- [toolNames 反映模型 descriptor 而非调用结果] -> 字段明确表示本轮可用工具，实际调用结果仍由 `tool.call.*` 事件表达。

## 迁移计划（Migration Plan）

无数据迁移。发布后 runtime log 追加新字段和事件；旧日志消费者必须忽略未知字段。回滚仅移除新增诊断字段，不影响 terminal、stream 或持久化语义。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/runtime-execution-exception-diagnostics/spec.md`：新增执行异常诊断契约。
- `openspec/specs/redaction-policy/spec.md`：提炼本地 runtime diagnostic 例外。
- `openspec/specs/runtime-logging/spec.md`：提炼本地 runtime diagnostic 例外。
- `openspec/designs/architecture/observability-boundaries.md`：记录跨模块消费者边界。
- `openspec/designs/modules/agent-common.md`、`openspec/designs/modules/agent-core.md`：记录 serializer 和 loop 日志职责。
- `openspec/designs/spec-to-design-map.md`：增加导航。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-7.1-输出结构化日志` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/redaction-policy/spec.md`、`openspec/specs/runtime-execution-exception-diagnostics/spec.md`、`openspec/specs/runtime-logging/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
