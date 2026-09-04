## MODIFIED Requirements

### Requirement: Cron Tool 调用指导

系统 SHALL 为 `Cron` Tool 及其输入字段提供与实际 schema、解析器和执行生命周期一致的模型可见描述。描述 MUST 使模型能够区分相对 delay、一次性日历 cron、周期 cron、list 和 delete；MUST 说明支持的五段数字 cron 子集、本地时间与分钟精度、recurring 默认行为、delay 总量边界以及 task scope 容量。描述 MUST NOT 把单轮副作用 Tool 调用限制表述为 Cron 的总任务上限。

#### Scenario: 相对时长选择 delay

- **WHEN** 用户要求“10 分钟后”或“2 小时后”执行一次任务
- **THEN** 模型可见描述 MUST 引导使用结构化 `delay`
- **AND** MUST 说明 delay 是一次性经过时长，不用于“明天上午 9 点”等日历时刻

#### Scenario: 日历时刻选择 cron

- **WHEN** 用户要求每天、每周、工作日、每 N 分钟或下一次日历时刻执行任务
- **THEN** 描述 MUST 引导使用本地时间五段 cron
- **AND** 下一次日历时刻 MUST 使用 `recurring=false`，周期任务默认或显式使用 `recurring=true`

#### Scenario: 有限窗口使用最少表达式

- **WHEN** 用户要求“每天 16:00 到 18:00 之间每 10 分钟执行”
- **THEN** 描述 MUST 引导使用最少数量的周期 cron 精确覆盖窗口
- **AND** MUST 避免把每个触发点展开为多个一次性任务

#### Scenario: 间隔任务优先一次下发

- **WHEN** 用户要求按固定间隔持续执行，且单条 cron 表达式能够准确表示
- **THEN** 描述 MUST 引导模型只调用一次 `Cron(action=create)`
- **AND** MUST NOT 为每个预期触发时间逐个创建任务

#### Scenario: 时间是数据条件而非调度条件

- **WHEN** 用户要求“查询下午两点的 KPI”，且没有未来、延后或周期执行意图
- **THEN** 描述 MUST 引导模型立即执行查询并把下午两点作为数据时间条件
- **AND** MUST NOT 仅因输入包含时间词就调用 Cron

#### Scenario: 时间修饰未来执行动作

- **WHEN** 用户要求“下午两点查询 KPI”
- **THEN** 描述 MUST 引导模型把下午两点理解为执行时间并创建定时任务

#### Scenario: Provider 从顶层发现 Cron 参数

- **WHEN** 模型 provider 只读取 Tool schema 顶层 object properties
- **THEN** schema MUST 在顶层披露 action、cron、delay、prompt、recurring 和 id
- **AND** action-aware `oneOf` MUST 继续作为 runtime validation 规则拒绝非法字段组合

#### Scenario: 一次性 cron 只执行第一次匹配

- **WHEN** cron 表达式包含范围或步长且 `recurring=false`
- **THEN** 描述 MUST 明确任务只在第一次匹配时执行一次
- **AND** MUST NOT 引导模型用一个 one-shot task 表示仅某一天的多次触发窗口

#### Scenario: 单个未来时刻默认一次性

- **WHEN** 用户要求“晚上十点帮我查询某指标”或“明天八点提醒我”，且没有每天、每周、每隔或持续等重复语义
- **THEN** 描述 MUST 引导模型创建 cron task 并显式设置 `recurring=false`
- **AND** MUST NOT 因 cron 表达式可以重复匹配而默认创建周期任务

#### Scenario: 明确重复词才创建周期任务

- **WHEN** 用户要求“每天晚上十点查询某指标”
- **THEN** 描述 MUST 引导模型省略 `recurring` 或设置 `recurring=true`

#### Scenario: List 保留 false 生命周期事实

- **WHEN** `Cron(action=list)` 返回一个 `recurring=false` 的任务
- **THEN** Tool result MUST 显式包含 `recurring=false`
- **AND** MUST NOT 因布尔值为 false 而省略该字段，导致消费者根据 cron 文本错误推断生命周期

#### Scenario: Prompt 保持原任务语义

- **WHEN** 用户要求“晚上十点查询什么是 AMF”
- **THEN** 生成的 prompt MUST 保留“查询什么是 AMF”的原始任务语义
- **AND** MUST 只移除已由 cron 表达的“晚上十点”执行时间
- **AND** MUST 尽量逐字保留原任务子句，不改写、不翻译术语且不解释缩写
- **AND** MUST NOT 擅自增加知识源、工具选择、网元关系、输出格式或其他用户未要求的约束

#### Scenario: Prompt 保留数据时间

- **WHEN** 用户要求“晚上十点查询下午两点的 KPI”
- **THEN** cron MUST 表达晚上十点的执行时间
- **AND** prompt MUST 保留“下午两点”作为数据查询条件

#### Scenario: 日期有限窗口快速映射

- **WHEN** 用户要求“明天晚上7点到10点之间，每10分钟查询一次什么是 AMF”
- **THEN** 描述 MUST 默认把“之间”解释为起点包含、终点不包含
- **AND** MUST 引导模型生成一个目标日/月限定的 `*/10 19-21 ...` cron task
- **AND** MUST 设置 `recurring=true` 以执行窗口内所有匹配
- **AND** MUST NOT 围绕终点是否包含或 one-shot 展开方案进行反复推理

#### Scenario: 用户明确要求包含窗口终点

- **WHEN** 用户明确说“晚上10点也执行”
- **THEN** 描述 MUST 引导模型保留主窗口任务，并只增加一个晚上10点的 one-shot task

#### Scenario: 描述与解析器一致

- **WHEN** 模型读取 `cron` 参数说明
- **THEN** 说明 MUST 只承诺 `*`、数字单值、逗号列表、闭区间、通配符步长和范围步长
- **AND** MUST 明确不支持的扩展语法不能被假定可用

#### Scenario: 容量与单轮限制不混淆

- **WHEN** 一次用户意图需要创建多个 Cron task
- **THEN** 描述 MUST 说明当前 scope 最多保存 50 个任务
- **AND** MUST 说明单轮最多 5 次副作用调用不是 Cron 总容量，剩余创建应由后续执行轮次继续
