## 背景和现状（Context）

当前 `AskUserQuestion` 使用 `questions[].options[]` 表达预设答案，question-level `custom=true` 只允许一个没有具体 option 归属的自定义文本。`PendingInputAnswer.answers` 是按 question 排序的 `string[][]`：文本题为一个字符串，普通单选为一个 option value，多选为多个 option value。`agent-runtime` 拥有 accepted pending shape 和 answer validation，`agent-channel-common`/Web 只投影安全字段，`frontend/agent-web` 的共用 `RespondInput` 承载三种 host 的浏览器交互。

现有前端还兼容把 `value="custom"` 的 option 当作 question-level custom 行的显示标签，但 `AskUserQuestion` 的稳定 model-facing guidance 要求 `custom=true` 时只提供具体预设 options。该兼容行为不能表达多个具体选项各自需要输入，也不能在答案中同时保留类别和参数。

本变更需要扩展 `agent-contracts` 的 question pending option public shape。用户已在本线程明确要求按该方向实现并提交 PR；change review 仍必须把该 additive contract refinement 作为独立检查项，确认 agent-core producer、runtime/gateway contract 与 Web 命名和语义完全一致，并确认 workflow contract 不变。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 一个单选 question 中多个不同 option 均可声明 `requiresTextInput=true`。
- 选中此类 option 后在同一行展开一个必填、最多 500 字符的文本框。
- 一次回答通过现有 `string[][]` 同时提交稳定 option value 和用户文本。
- Tool description 明确告诉模型：自由文本题直接输入；普通 option 只提交 value；question-level custom 是一个通用其他答案；option-attached input 是具体 option 的参数。
- 所有 producer、runtime、projection、持久化和三 host 前端路径使用同一字段与验证规则。

**非目标：**

- 不支持 multi-select option 分别携带多个输入值。
- 不支持一个 option 携带多个字段、数字/日期/文件上传或任意表单 schema。
- 不修改 `HUMAN_HANDOFF`、confirmation、authorization 或 workflow node authoring schema。
- 不新增 pending 状态、runtime command、answer DTO、数据库表、队列或 capability-private lifecycle。
- 不删除前端已有 `value="custom"` question-level custom 显示兼容；该兼容不进入新的 model-facing 推荐形态。

## 设计决策（Decisions）

### D1：在 option 上增加两个扁平 optional 字段

唯一选定的 public shape 是：

```ts
interface PendingInputOption {
  readonly value: string;
  readonly label: string;
  readonly requiresTextInput?: boolean;
  readonly inputPlaceholder?: string;
}
```

`requiresTextInput=true` 表示选择该 option 后必须补充一个文本值；缺省或 `false` 表示普通 option。`inputPlaceholder` 是可选安全展示文本，只能在 `requiresTextInput=true` 时出现，长度为 1–200 字符。

采用扁平字段而不是 `input: { type, required, ... }`，因为首版只有固定的必填文本输入，不需要提前建立表单类型体系。拒绝继续复用多个 `value="custom"`：option value 必须唯一，且 `custom` 是 question-level 权限，不是 option 类型。

### D2：首版只允许 single-select attached input

一个 question 可以有多个 `requiresTextInput=true` options，但最终只能选择其中一个。只要存在 attached-input option：

- `multiple` 必须缺省或 `false`；
- question-level `custom` 必须缺省或 `false`；
- 每个 option value 继续唯一；
- confirmation、authorization 和 human handoff intent 不得携带 attached-input option。

该互斥规则在 `AskUserQuestion` producer 进入 pending 前和 runtime accepted-intent boundary 双重校验，防止其它 trusted producer 产生无法解释的 shape。

### D3：复用 `string[][]`，attached answer 固定为二元 entry

不新增 answer DTO。选中普通 option 仍提交：

```json
["new_example_project"]
```

选中 attached-input option 固定提交：

```json
["existing_project", "E:/PROJECT/demo"]
```

runtime 先用第一个字符串解析 accepted option，再根据该 option 的 `requiresTextInput` 决定 entry 必须是一项还是两项。第二项必须非空且最多 500 字符。这样 answer 仍由 runtime 按 accepted request 解释，客户端不能通过自行增加第二项扩权。

拒绝把 option value 和文本拼成一个字符串：拼接格式会把解析规则泄漏给模型和客户端，且无法安全区分分隔符。拒绝新增结构化 answer DTO：当前目标只需一项附加文本，改变 runtime command 和持久化 answer envelope 会扩大冻结契约变更面。

### D4：Tool description 和 schema 明确形态，不依赖自然语言猜测

`AskUserQuestion` option schema 增加两个字段及具体长度说明。description 必须明确：

- 缺少 options 的问题是直接自由文本输入，不设置 attached-input 字段；
- 需要选项参数时在对应具体 option 上设置 `requiresTextInput=true`；
- 同题多个具体 options 可以分别设置；
- 每个 option 使用唯一业务 value，不用 `custom` 作为 attached-input 标记；
- attached input 与 `multiple=true`、question-level `custom=true` 互斥；
- question-level custom 仍只表示一个通用非 option 答案。

`agent-core` 把两个字段从已通过 descriptor validation 的 arguments 映射到 `PendingInputIntent`，不做选项文案语义推断。

### D5：runtime 保存和验证 canonical facts，前端只拥有交互状态

agent-core producer 映射相同 optional 字段，runtime/gateway question pending option 类型增加对应字段；既有 pending request JSON/Record mapping 显式透传，不新增 persistence owner。channel projection只透传已接受字段。workflow pending option 类型和 JSON 投影保持不变。

Web state option 使用 `id` 对应 canonical option value，并携带两个 optional 字段。`RespondInput` 选择 attached option 时把本题本地 answer 初始化为 `[optionId, ""]`，textarea 更新第二项；选择其它 option 时完整替换本题 answer，从而清除旧输入。提交 completeness 由当前 answer 与 selected option constraint 计算，不把浏览器校验当作可信边界。

### D6：失败行为 fail closed

以下情况以现有 safe validation error 拒绝，不创建/不 resolve pending：

- `inputPlaceholder` 没有对应 `requiresTextInput=true`；
- attached input 与 `multiple=true` 或 `custom=true` 组合；
- attached option answer 缺少文本、文本为空、超过 500 字符或多于两项；
- ordinary option answer 带第二项；
- answer 第一项不是 accepted option value；
- non-QUESTION protected pending kinds 携带 attached-input option。

日志、timeline、safe error、metric 不记录 prompt、placeholder 或 answer 文本。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | attached text 仍是 untrusted answer，只由 runtime 对 accepted option 校验；placeholder 有界且只作文本渲染；诊断面不记录原文 | runtime negative tests、projection tests、代码审查 |
| 性能/容量 | 每个 option 只增加两个 optional scalar；沿用 2–8 options、最多 20 accepted questions、placeholder 200 和 answer 500 字符上限，不新增请求或存储 | schema/contract tests、现有 pending capacity tests |
| 可靠性/恢复 | 字段随 canonical pending request 持久化，恢复后按相同 accepted shape 校验；不改变 checkpoint、lane、timeout、cancel 或 terminal commit | pending resume/answer tests、full runtime tests |
| 可维护性 | 使用一个 canonical 字段名跨 agent-core producer、runtime/gateway question pending contract 与 Web；不引入表单抽象、第二 answer DTO 或 workflow 扩展 | contract tests、architecture lint、model code review |
| 可测试性 | producer、runtime 与 DOM 行为均可用确定性 shape 验证；negative cases 不依赖模型文案推断 | focused Vitest、contract tests、frontend tests |
| 审计/可追溯性 | 沿用 `USER_INPUT_*` 和现有 pending refs；不新增高基数或原文 observation | projection/observability regression tests |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Tool schema/description 精确表达四类输入和互斥规则 | 1.1、1.2 | AskUserQuestion schema/description tests |
| public option fields 跨 owner 同形同策 | 1.3 | contract tests、TypeScript build |
| producer 只映射已校验字段并拒绝非法组合 | 2.1 | agent-core AskUserQuestion tests |
| runtime intent 和 answer fail closed | 2.2、2.3 | runtime pending answer/negative tests |
| Record/stream/Web projection 保留安全 optional fields | 2.4 | gateway/channel projection tests |
| attached option 原地展开、提交二元 entry、切换清理 | 3.1、3.2 | `RespondInput` DOM interaction tests |
| 三 host 复用同一行为 | 3.3 | frontend build、`build:vite:modes` |
| 无 minimal-kernel/架构回归 | 4.1 | root build/test/contract/architecture gates |
| OpenSpec 与代码一致 | 4.2 | strict validate、nextagent-skill-review、nextagent-code-review |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ask-user-question-tool/spec.md`、`openspec/specs/question-pending-input/spec.md`、`openspec/specs/ts-core-contracts/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/runtime-boundaries.md` 主承载 pending answer envelope 和 owner boundary；`openspec/designs/architecture/conversation-ui-state.md` 主承载浏览器投影交互。
- 模块设计：`openspec/designs/modules/agent-capability.md`、`agent-runtime.md`、`agent-channel-web.md` 分别承载 schema/producer、validation、projection 落点。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [二元 string entry 与普通单选一元 entry 不同] -> runtime 必须先解析 accepted option 再验证长度，Tool description 和 contract tests 固定该顺序。
- [多个 option 输入增加模型生成字段组合] -> 使用两个扁平字段和明确互斥描述，不引入 nested form schema 或条件 discriminator。
- [前端 compatibility custom 行与新机制并存] -> model-facing description 只推荐 canonical attached-input 字段，runtime 通过 accepted shape 区分，两种机制同题禁止混用。
- [新增 public contract 字段] -> 保持 additive optional、跨 subpath 同名同义、独立 contract review，并提供 negative tests；不改变 identity、scope、command 或 persistence owner。

## 迁移计划（Migration Plan）

该变更是 optional 字段扩展。旧 pending records 和旧客户端投影在字段缺省时保持现有行为。新后端与前端应作为同一版本 artifact 发布；回滚时未解决的新 shape 可能无法由旧前端展示，因此发布前必须通过同仓 Web artifact/modes 验证，不进行跨版本 mixed deployment 承诺。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ask-user-question-tool/spec.md`：合并 model-facing shape、producer preservation 和 invalid combinations。
- `openspec/specs/question-pending-input/spec.md`：合并二元 answer 和浏览器可观察行为。
- `openspec/specs/ts-core-contracts/spec.md`：合并 option optional fields 与现有 answer envelope refinement。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/runtime-boundaries.md`：提炼 canonical option facts、answer interpretation 和 owner boundary。
- `openspec/designs/architecture/conversation-ui-state.md`：提炼 selected option attached input 的投影/交互。
- `openspec/designs/modules/agent-capability.md`、`agent-runtime.md`、`agent-channel-web.md`：提炼各模块消费/暴露 contract 与验证落点。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新导航和验证入口。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-5.2-调用能力` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/ask-user-question-tool/spec.md`、`openspec/specs/question-pending-input/spec.md`、`openspec/specs/ts-core-contracts/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
