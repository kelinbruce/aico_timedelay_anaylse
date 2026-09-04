## 背景和现状（Context）

AskUserQuestion 或等价 upstream producer 可在后续把模型侧追问转换成 runtime-owned `QUESTION` pending input intent。本 change 只定义 `QUESTION` pending input 已经进入 runtime-owned pending 后的黑盒行为。`refine-ts-pending-input-contracts` 把 question shape 收敛为 `options + multiple? + custom?`，客户端 answer 仍是 `string[][]`，不携带 schema。

本 change 把 question 的黑盒行为收敛为文本题、单选题、多选题和允许自定义文本的选项题。所有暂停、answer、timeout、恢复仍由 core/timeout change 提供。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 定义 `QUESTION` 的文本题、单选题、多选题和 custom 选项题 answer 规则。
- 为后续 AskUserQuestion tool 或等价 upstream producer 提供 request/answer 约束。
- answer 后恢复原 run，不新建 root request。

**非目标：**

- 不决定模型什么时候必须追问。
- 不实现表单引擎、分组问题、条件跳转、逐题流式提交或问卷引擎。
- 不修改 pending input 三对象契约。
- 不让客户端 answer 携带 schema。

## 设计决策（Decisions）

### D1：用 options + multiple 区分文本、单选和多选

选定方案：`options=[]` 表示文本题；`options` 非空且 `multiple` 缺省或 false 表示单选题；`options` 非空且 `multiple=true` 表示多选题。

理由：复用现有 `PendingInputQuestion`，避免新增题型 enum 或 answer DTO。

### D2：custom 由 pending request 决定

选定方案：`custom=true` 只在 question/request 中出现。客户端提交的 answer 只是字符串数组；runtime 按已持久化 request 判断是否接受非 option value。对选项题，`custom=true` 时每个 question 至多接受一个非 option 自定义文本值。

理由：题型权限来自 trusted upstream intent 和 runtime validation，不能由客户端 answer 提权。

### D3：多选值必须唯一且受 question 约束

选定方案：多选 answer entry 可以包含多个字符串，但必须去重后与原数组长度一致；除允许的 custom 文本外，每个值都必须匹配 option value。

理由：多选不能变成自由文本列表，也不能用重复值制造歧义或影响后续模型可读事实。

### D4：后续 AskUserQuestion tool 不得等待回答

选定方案：若后续实现 AskUserQuestion tool，tool handler 只能校验问题并提交 runtime-owned pending input intent，返回 pending ref。用户回答后由 runtime 恢复原 run。本 change 不新增该 tool，也不把 tool handler 作为等待用户的 lifecycle owner。

理由：tool handler 等待用户会造成 capability 私有生命周期和不可恢复阻塞。

## 质量属性设计（Quality Attributes）

安全：question text/options/multiple/custom 在进入 pending 前必须已通过 safe request validation；answer 不携带 schema。验证入口是 runtime negative tests，以及后续 tool change 的 producer validation tests。

性能/容量：不引入长轮询或 tool handler blocking；问题数量和文本大小使用现有 schema/contract 限制。验证入口是 runtime validation tests。

可靠性/恢复：answer 通过 core pending lifecycle 恢复；timeout 不合成答案。验证入口是 runtime resume/timeout tests。

可维护性：question 仅定义 type-specific validation；核心生命周期仍在 runtime。验证入口是 architecture tests。

可测试性：文本、单选、多选、custom、timeout 都可独立测试。

审计/可追溯性：只通过 `USER_INPUT_*` safe refs 追踪，不记录 raw hidden prompt。验证入口是 projection tests。

## 验证映射（Verification Map）

- 文本题 answer：T2.1；runtime validation test。
- 单选题 answer：T2.2；runtime validation test。
- 多选题 answer：T2.3；runtime validation test。
- custom 选项题：T2.4；runtime validation test。
- 非法多选重复/越权 custom：T2.5；negative test。
- answer 恢复：T3.1；runtime integration test。
- future AskUserQuestion boundary：T1.2；architecture/source review check。

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/question-pending-input/spec.md`。
- 架构设计：pending input/user interaction architecture 文档或 runtime boundary 文档。
- 模块设计：`agent-runtime`、`agent-channel-web` 模块文档；`agent-capability` 只在后续 AskUserQuestion tool change 中更新。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] custom 被客户端滥用。-> runtime 只按 persisted request 的 `custom` 判断。
- [风险] 多选被误当成任意字符串列表。-> spec 约束 option value、唯一性和至多一个 custom 文本。
- [取舍] 不新增 typed answer DTO。-> 保持三对象契约稳定，首版只通过 question shape 解释 `string[][]`。

## 迁移计划（Migration Plan）

无生产迁移。本 change 不新增 AskUserQuestion tool；若后续实现该 tool，应使其接受 `multiple?` 和 `custom?` 并由 runtime pending request 统一校验 answer。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/question-pending-input/spec.md`。
- 若 `ask-user-question-tool` stable spec 存在或后续新增，在对应 change 中对齐。
- 更新 runtime/user-interaction architecture 和相关模块文档。
- 更新 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
