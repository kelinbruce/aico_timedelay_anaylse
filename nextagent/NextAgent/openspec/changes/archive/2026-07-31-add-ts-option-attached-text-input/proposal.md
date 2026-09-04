## 背景与问题（Why）

`AskUserQuestion` 当前能够表达自由文本题、普通单选/多选题，以及一个 question-level 自定义答案入口，但不能表达“选择某个具体语义选项后，为该选项补充一个参数”。例如单元测试生成需要区分“已有项目”和“单个文件”，同时分别收集项目目录或文件路径；现有 `custom=true` 只能提供一个无归属的通用文本入口，提交结果会丢失所选业务类别，或者要求模型在恢复后再次追问。

系统需要在不新增 pending lifecycle、不改变 Tool producer ownership 的前提下，让一个单选问题中的多个具体 option 分别声明附带文本输入，并在一次回答中同时保留稳定 option value 和用户输入文本。自由文本题应继续直接提供文本输入，不要求用户先点击伪选项。

## 变更范围（What Changes）

- **BREAKING（契约语义扩展）**：扩展 question pending input option public shape，增加 `requiresTextInput?: boolean` 和 `inputPlaceholder?: string`；涉及 `agent-contracts/runtime`、`agent-contracts/gateway` 及 Web projection DTO，不扩展 workflow pending option contract。
- 扩展 `AskUserQuestion` model-facing description 和 input schema，明确自由文本、普通选项、question-level custom answer、option-attached text input 四类形态及互斥规则。
- 一个单选问题可以有多个不同 option 声明 `requiresTextInput=true`；用户只能选择其中一个，选中后该 option 原地展开一个文本输入框。
- option-attached answer 继续复用 `PendingInputAnswer.answers: string[][]`，对应 entry 固定为 `[optionValue, inputText]`；不新增平行 answer DTO 或 runtime command。
- `multiple=true`、question-level `custom=true` 与 option-attached text input 首版互斥；`inputPlaceholder` 只能用于 `requiresTextInput=true` 的 option；非法组合在创建 pending 前或回答边界 fail closed。
- 自由文本题仍使用无 `options` shape 并直接显示文本框；普通选项和现有 question-level custom answer 行为保持不变。
- 不修改 `HUMAN_HANDOFF`、confirmation、authorization、workflow interrupt 或 pending lifecycle。

## Capability 影响（Capabilities）

### 新增 Capability

- 无。

### 修改的 Capability

- `ask-user-question-tool`：扩展 option schema、model-facing description、producer normalization 和非法组合校验。
- `question-pending-input`：扩展 accepted question shape 与单选 answer validation，使选项值和附带文本能够在同一 answer entry 中提交。
- `ts-core-contracts`：扩展 pending input question option 的最小 public contract 和 `string[][]` answer 解释规则。

## 影响范围（Impact）

- 合同：`packages/agent-contracts` 中 runtime/gateway question pending input option shape 与 runtime schema；workflow contract 不变。
- Tool：`packages/agent-capability` 的 `AskUserQuestion` description/input schema。
- 编排与生命周期：`packages/agent-core` 的 AskUserQuestion argument normalization；`packages/agent-runtime` 的 pending intent 与 answer validation。
- 持久化与投影：既有 gateway Record/JSON mapping、stream envelope 和 Web state contract 增量透传两个 optional 字段，不新增表或写入事务。
- 前端：`frontend/agent-web` 共用 `RespondInput` 在 local、immersive、collaborative host 中一致渲染 option-attached textarea。
- 测试：contract/schema、producer、runtime negative/answer、stream projection、前端交互及多 host 构建验证。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/ask-user-question-tool/spec.md`：合并 option-attached text input 的 model-facing schema、互斥和 producer validation。
- `openspec/specs/question-pending-input/spec.md`：合并 `[optionValue, inputText]` answer 规则及 negative cases。
- `openspec/specs/ts-core-contracts/spec.md`：合并 pending option optional 字段和 answer 解释规则。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/runtime-boundaries.md`：补充 option-attached input 仍复用 runtime-owned pending answer boundary。
- `openspec/designs/architecture/conversation-ui-state.md`：补充 question option-attached input 的投影和用户交互矩阵。
- `openspec/designs/modules/agent-capability.md`：补充 AskUserQuestion option schema 与 producer validation 落点。
- `openspec/designs/modules/agent-runtime.md`：补充 attached answer validation 落点。
- `openspec/designs/modules/agent-channel-web.md`：补充 optional option fields 的安全投影。
- `openspec/designs/adr/<id>.md`：无；本变更沿用现有 pending answer envelope，不形成独立长期技术决策。
- `openspec/designs/spec-to-design-map.md`：更新受影响 spec 的验证入口说明。

验证入口：
- AskUserQuestion schema/producer tests、pending input contract/runtime tests、stream projection tests、`RespondInput` 用户交互测试。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`。
- `frontend/agent-web` 下 `npm run build`、focused tests、`npm run build:vite:modes`。
- `openspec validate --all --strict`。
