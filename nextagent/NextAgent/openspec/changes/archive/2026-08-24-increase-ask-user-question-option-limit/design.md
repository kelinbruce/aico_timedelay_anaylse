## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.6 向用户提问` | 单个问题正常接受的预定义选项上限从十个提高到十五个，超出上限仍安全拒绝；中文自由文本入口使用“手动输入” | `ask-user-question-tool` | `FN-5.6 向用户提问` |

## `FN-5.6 向用户提问`

### 目标与规范依据

本设计落实 proposal 中单个问题支持十一至十五个候选项、十六个候选项安全失败且不产生部分 pending input 的黑盒目标，并把中文自由文本入口文案简化为“手动输入”。选项数量和文案变化不得放宽现有可见文本边界、问题数量边界、选项唯一性、回答语义或 pending lifecycle。

#### 本 Function 的目标 Requirements

canonical spec：`ask-user-question-tool`

- `ADDED`：`单个问题支持至多十五个预定义选项`
- `ADDED`：`中文界面使用简洁的手动输入标签`

### 当前实现

- `agent-capability` 拥有 builtin `AskUserQuestion` descriptor。`ask-user-question-schemas.ts` 当前通过 `questions[].options.minItems=2`、`maxItems=10` 定义 model-facing 正常输入边界，并分别限制 `prompt`、option `value`、option `label` 为最多 500 个字符，`inputPlaceholder` 为最多 200 个字符。
- `ask-user-question-tool.ts` 的总 model-facing description 指导模型为已知候选项提供 options；`questions[].options` 的 model-facing schema description 没有公开选项数量范围或简短表达建议。
- `agent-core` 从当前 resolved descriptor 编译输入校验器；合法输入完整映射为 pending input intent，校验失败时不创建 pending input。该路径没有独立的八项硬编码。
- `agent-runtime` 对 pending question options 保留独立的 50 项防御上限；Web projection 按顺序映射 accepted options，不包含八项上限。
- 当前默认 OpenAI-compatible profile 的 `contextWindowTokens` 为 128,000、`maxOutputTokens` 为 2,048，本地 overlay 的 `maxOutputTokens` 为 4,096。context engine 会估算 tool descriptors 和已进入上下文的 tool messages，并在 provider 调用前执行输入预算门。
- `builtin-tool-guidance.test.ts` 直接锁定 descriptor 的 `maxItems=10`。`capability-governance.test.ts` 覆盖 canonical descriptor 和 producer pending 路径，其中测试 fixture 复制十项上限。
- `agent-web` 的 `zh-CN` 本地化资源当前把自由文本入口标记为“我手动输入”，组件通过 `respondInput.customAnswer` 消费该文案。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 九至十五个合法选项被完整接受 | descriptor 当前从第十一项开始校验失败 | model-facing schema 上限需提高到十五，并由 producer 路径证明完整保序 |
| 十六个选项安全失败且不创建 pending input | 当前 descriptor 从第十一项开始均失败 | 失败边界需精确移动到十六，并锁定无截断、无 pending side effect |
| descriptor 公开 `2..15` 正常边界 | schema、描述和测试当前公开 `2..10` | schema、字段 description 和断言需使用同一边界 |
| 增加候选项不造成实际 prompt 容量回退 | 固定 descriptor 已纳入上下文预算；短选项从十项增至十五项增加五个 option objects，但字段理论最大值较大 | description 需要求简短 option value/label，验证需使用十五个真实短选项；不得把字段理论最大值误当成推荐用法 |
| 中文自由文本入口使用简洁标签 | `zh-CN` 资源当前显示“我手动输入” | 仅把该资源值改为“手动输入”，保持组件和回答 contract 不变 |

### 修改方案

唯一实现路径是在 `agent-capability` 的 canonical schema 中把 `questions[].options.maxItems` 从 10 改为 15，并在同一 schema 字段 description 中明确“二至十五个简短预定义选项”。总 Tool description 保持现有文本，避免重复规则增加固定 prompt；`agent-core` 继续只消费 resolved descriptor，不增加平行校验常量。accepted input 继续使用现有 pending intent 映射，以保持 options 顺序和字段。十六项输入由同一个 descriptor validation 路径返回安全失败，producer 不执行截断或兼容归一。

`agent-runtime` 的 50 项防御上限和 Web projection 不修改：前者是跨 producer 的防御边界，不是模型正常输入能力；后者只投影已经接受的数据。问题数量、各字符串长度、option uniqueness、`multiple`、`custom`、`requiresTextInput`、回答和恢复语义均保持不变。

容量方面不新增总字符上限，也不缩短既有公共字段长度。固定总 Tool description 不增长；schema 只发生常数字符级变化。正常告警级别等短选项相对当前十项实现仅增加五个小型 JSON object，并继续受模型 `maxOutputTokens`、context engine 输入预算和既有字段长度校验约束。全部字段取理论最大值时，模型输出本来就可能先达到 provider 输出上限；本 change 不把这种极端输入声明为推荐载荷，也不扩大任何字符串长度。若后续需要引入 aggregate Tool input budget，应通过独立 OpenSpec change 定义，不与本次数量边界混合。

测试同时覆盖 schema 黑盒边界和 producer 可观察结果：十项、十四项、十五项合法；十六项失败；十五项 pending options 完整保序；十六项不创建 pending input。描述测试锁定范围和简短表达指导，防止 schema 与 prompt guidance 再次漂移；前端本地化测试锁定中文标签。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | 无新增黑盒质量目标；由功能性 Requirement 的有界输入派生 | 相对当前实现仅增加五个有界 option entries；保留字符串边界、模型输出上限和 context budget，不新增总 Tool description | 总 Tool description 仍满足既有 4096 字符门禁；十五个短选项可在默认输出预算内构造 |
| 可测试性 | 无新增黑盒质量目标；由功能性 Requirement 的边界场景派生 | schema 与 producer 使用同一 descriptor truth，不复制生产常量 | 同时断言 10/14/15 accepted、16 rejected、pending side effect 和中文标签 |

## 验证策略

- unit/descriptor 层编译真实 model-facing JSON Schema，验证十项、十四项和十五项输入通过、十六项输入失败，并断言公开的 `minItems`、`maxItems` 与描述一致。
- integration/producer 层通过 canonical `AskUserQuestion` 调用路径验证十五个短选项创建一个 `QUESTION` pending input 且完整保序；十六项得到安全输入失败且不创建 pending input。
- frontend i18n 层断言 `zh-CN` 的 `respondInput.customAnswer` 精确为“手动输入”。
- characterization 层保留问题数兼容、可见文本长度、选项唯一性、回答形态、runtime 防御和 Web projection 既有测试，证明本 change 没有扩大相邻边界。
- OpenSpec strict validation 和模型语义检视覆盖 canonical spec 归属、容量取舍、架构 owner 与并行 active change 一致性。

## 长期基线刷新计划

- `openspec/specs/ask-user-question-tool/spec.md`：归档时加入本 change 的选项数量 Requirement。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.6-向用户提问.md`：归档时在规格表加入单个问题的预定义选项范围。
- `openspec/designs/features/D5-Capability能力体系/D5.2-内置工具/F-5.4-向用户提问.md`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无；不改变 capability invocation、pending lifecycle 或 context budget 架构。
- `openspec/designs/modules/agent-capability.md`：归档时把 AskUserQuestion descriptor 验证关注点补充为单题 `2..15` 个正常选项。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化；归档时仅在现有验证入口摘要需要时同步边界证据。

## 风险与取舍

- `enable-ask-user-question-free-text-answer` active change 同样触及 AskUserQuestion description、schema 相关测试。合并前必须基于最新 `main` 重放本 change，保留自由文本分类语义，并对最终组合 diff 重新验证。
- 十五个字段取最大长度的选项可能超过小 `maxOutputTokens` profile 的单次生成能力。这是既有十项边界已经存在的字段长度与输出预算组合风险；本 change 通过模型指导要求简短选项，不放宽字符串长度。aggregate input budget 留给独立 change，避免在本次需求中引入新的拒绝规则。

## 待确认问题

无。
