## 背景与问题（Why）

当前 `Cron` Tool 已支持标准五段 cron、结构化 delay、创建、列表和删除，但模型可见描述只提供少量示例，没有明确不同自然语言问法应选择哪种输入，也没有准确说明解析子集、时间窗口边界、一次性任务、任务容量与单轮调用限制。模型因此可能把“10 分钟后”换算成 cron、把有限时间窗口展开为大量一次性任务，或把单轮副作用调用上限误解为系统最多只能保存 5 个任务。

## 变更范围（What Changes）

- 优化 `Cron` Tool 总体描述，说明 delay、一次性 cron、周期 cron、list 和 delete 的选择规则。
- 为 action、cron、delay、prompt、recurring 和 id 增加模型可见的通俗参数说明。
- 明确当前五段 cron 支持的数字、通配符、列表、范围和步长语法，以及本地时间、分钟精度和日/月/周字段约束。
- 明确有限时间窗口应优先用最少数量的周期表达式表示；只有无法用单个表达式精确覆盖端点时才拆分，禁止按每次触发创建一批一次性任务。
- 明确间隔性重复任务优先通过一次 `Cron(action=create)` 和一条 cron 表达式下发，只有单条表达式不能精确表示时才使用最少数量的任务。
- 区分“下午两点查询某指标”这类未来调度时间与“查询下午两点某指标”这类指标数据时间；只有用户明确要求未来、延后或周期执行时才调用 Cron。
- 在不放宽 runtime validation 的前提下，于 schema 顶层披露 action、cron、delay、prompt、recurring 和 id，兼容只读取顶层 object properties 的模型 provider，避免合法 Cron 意图被生成为 `{}`。
- 明确 `recurring=false` 只保留第一次 cron 匹配，不能表示窗口内多次触发；目标日期内的间隔窗口使用日期限定 cron 和 `recurring=true`，跨年份重复作为当前已知限制，不进入单次 Tool 选择推理。
- 明确“晚上十点帮我查询某指标”“明天八点提醒我”等只包含一个明确未来执行时刻、且没有“每天/每周/每隔”等重复词的请求，默认是单次任务，必须生成 `recurring=false`；不得仅因 cron 表达式天然可重复而擅自创建周期任务。
- 明确生成 Cron `prompt` 时应保持用户原始任务语义，只移除已经由 cron/delay 表达的调度时间；不得擅自增加查询范围、输出格式、工具选择、知识源、诊断步骤或其他用户未要求的约束。时间如果属于数据过滤条件而非执行时间，必须保留在 prompt 中。
- 为“明天 A 点到 B 点之间，每 N 分钟执行”定义确定性快速映射：默认起点包含、终点不包含，直接使用一个带目标日/月字段的 cron 且 `recurring=true`；不再围绕终点包含关系或 `recurring=false` 反复推理。只有用户明确要求包含终点时才增加最少的终点 one-shot。
- 明确 scope 最多保存 50 个任务；单轮最多 5 次副作用 Tool 调用是执行编排限制，不是 Cron 总容量，不能据此声称系统最多只能创建 5 个任务。
- 通过描述契约测试和表达式行为测试保证说明与实际解析器一致。
- **BREAKING**：无。Tool 名称、合法输入集合、执行语义、gateway contract 和持久化格式均不变；仅补充 provider 可见的顶层字段披露。

## Capability 影响（Capabilities）

### 修改的 Capability

- `cron-tools`: 完善模型可见的 Tool 和入参指导，使自然语言到现有 contract 的映射准确、可泛化。

## 影响范围（Impact）

- `agent-capability`：仅修改 Cron Tool metadata/schema descriptions 和相邻测试。
- 不修改 `agent-contracts`、runtime lifecycle、gateway、scheduler、sandbox、Web API 或持久化。
- 验证：Cron focused tests、OpenSpec strict validation、语义审查。
