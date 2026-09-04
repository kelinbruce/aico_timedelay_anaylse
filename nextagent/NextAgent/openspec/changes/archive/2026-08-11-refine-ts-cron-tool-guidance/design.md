## 背景和现状（Context）

Cron 的执行主路径和 durable contract 已完成。本 change 只收敛模型调用指导：让模型先判断用户表达的是经过时长、下一次日历时刻、周期计划、查询还是取消，再构造当前 schema 已支持的参数。

## 目标和非目标（Goals / Non-Goals）

**目标：**覆盖常见问法；准确描述解析子集和边界；避免任务爆炸与限制误读；让 schema 各字段自解释；用测试锁定描述与实现的一致性。

**非目标：**不增加秒、年份、时区参数、自然语言解析器、`L/W/?/#`、月份或星期英文别名；不改变 cron 匹配、delay 计算、容量、Tool loop 或调度生命周期。

## 设计决策（Decisions）

1. Tool 总描述承担“选择哪个 action/调度形态”的决策树，字段 description 承担该字段的格式、默认值和边界，避免重复堆砌术语。
2. 相对经过时长使用 `delay`，总量必须为 1..525600 分钟且固定一天等于 24 小时；明确日历时刻不使用 delay。
3. 周期计划和下一次日历时刻使用本地时间五段 cron；一次性日历提醒设置 `recurring=false`，周期任务省略或设置为 true。
4. 描述只承诺解析器当前支持的数字语法：`*`、单值、逗号列表、闭区间、`*/N` 和 `A-B/N`。明确分钟精度、DoW 0/7 均为周日、DoM 与 DoW 同时受限时采用 OR。
5. 有限窗口使用最少表达式覆盖。“A 到 B 之间”默认采用 `[A,B)`，例如每天 16:00 到 18:00 之间每 10 分钟使用 `*/10 16-17 * * *` 一个任务；只有明确要求18:00也执行时才增加 `0 18 * * *`。不得展开为逐触发点 one-shot。
6. 生命周期限制采用不易混淆的表述：scope 容量是 50；单轮最多 5 次副作用调用只决定是否需要后续轮次，不是 Cron 总任务上限。
7. `prompt` 要求写成未来触发时可独立执行的完整任务，不依赖当前对话中的省略指代；身份和 scope 仍由可信上下文提供。
8. 间隔任务默认采用“一次 create + 一条表达式”。只有时间窗口端点、跨字段边界或其他日历约束无法由单条表达式精确表示时，才拆成最少数量的 Cron task。
9. 是否调用 Cron 取决于时间短语在句子中的语义角色，而不是仅检测到时间词。时间修饰“执行动作”且包含未来、延后或周期意图时使用 Cron；时间修饰“查询对象/数据范围”时立即执行原任务，不创建定时任务。例如“下午两点查询 KPI”是调度意图，“查询下午两点的 KPI”是数据时间条件。
10. 保留 action-aware `oneOf` 作为 runtime validation truth，同时在 schema 顶层增加相同字段的 object properties 作为 provider-facing disclosure。顶层不新增可接受字段、不改变 required 规则；各分支继续决定合法组合。
11. `recurring=false` 在首次匹配后完成任务，因此表达式中的范围和步长不会产生后续触发。目标日期内的一段时间多次执行必须使用 `recurring=true`；当前 contract 没有 year/endAt 导致未来年份仍可能匹配，该限制不改变当前快速映射，也不得引发模型在创建前展开替代方案。
12. 单个未来日历时刻默认采用 one-shot。只有用户明确包含“每天”“每周”“每隔”“持续”等重复语义时，模型才可省略 `recurring` 或设置为 true；“晚上十点查询”“明天八点提醒”等没有重复限定词的请求必须显式设置 `recurring=false`。
13. Cron prompt 采用“原任务子句近似逐字复制”的语义保真转换：从用户原句中只移除由 cron/delay 承担的执行时间和重复频率描述，保留任务动作、对象、数据时间、范围和用户显式约束。不得改写、翻译术语、解释缩写，也不得为了“让任务更完整”自行加入工具调用方式、RAG/记忆偏好、解释范围、网元关系、输出结构或诊断步骤。
14. 对“目标日期 + A 到 B 之间 + 每 N 分钟”的常见问法采用固定决策顺序：将“之间”解释为 `[A,B)`；分钟使用 `*/N`，小时覆盖 A 至 B 前一小时，日/月使用目标日期，`recurring=true` 以保留窗口内全部匹配；生成一个 create 调用后停止推理。只有用户明确说“包含 B 点/B 点也执行”时，才追加 B 点的 one-shot。跨年份重复属于当前已知限制，不得在单次 Tool 选择中展开方案讨论。

## 验证映射（Verification Map）

| 约束 | 验证入口 |
|---|---|
| action 与调度形态选择 | metadata/schema description assertions |
| cron 子集、步长范围和窗口示例 | parser behavior + description assertions |
| delay 总量、一次性与固定时长 | schema/adapter existing tests + description assertions |
| 50 容量与 5 次单轮限制不混淆 | description assertions |
| 间隔任务单 create 优先 | description assertions |
| 调度时间与数据时间不混淆 | positive/negative intent examples in description assertions |
| provider 可发现顶层参数 | top-level properties + existing oneOf validation tests |
| finite window 不误用 recurring=false | description assertions |
| 单个未来时刻默认 one-shot | positive one-shot and recurring counterexample assertions |
| prompt 只移除调度语义 | prompt description preservation and non-expansion assertions |
| 常见有限窗口快速映射 | deterministic interval-window example assertions |
| 无 public contract 或生命周期变化 | diff review + focused tests |

## 风险与取舍（Risks / Trade-offs）

- [描述过长增加模型上下文] -> 总描述只保留决策规则和关键陷阱，详细边界下沉到字段 description。
- [示例被误当唯一写法] -> 同时给出语法类别和代表性示例，测试验证类别而非完整文案。
- [把执行编排限制写入 Cron 元数据形成耦合] -> 只解释“5 不是总容量”的当前事实，不改变或复制执行控制逻辑。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-10.9-Cron工具` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/cron-tools/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。

## 归档阻塞记录（2026-07-31）

- **状态：**保持 active，禁止使用 `--skip-specs`。
- **原因：**stable `cron-tools` 中找不到 `Cron Tool 调用指导` Requirement。
- **解除条件：**逐 Requirement 建立 delta、stable target、Function 与长期设计的双端映射；确认正文、元数据、Scenario 和任何 REMOVED→ADDED/MODIFIED 迁移均完整同步后，再重新执行 archive。
