# add-ts-bilingual-telecom-output

规划入口：[roadmap-v2](../nextagent-ts-change-roadmap-v2.md)
所属分组：Bilingual Telecom Language

状态：ready
类型：实施 change
主要 owner：`agent-context-engine`、`agent-core`
依赖：`add-ts-context-prompt-shaping`

目标：
- 支持回答语言默认跟随用户主语言，并在 prompt/context 组装中要求保留电信术语原始表达。

能力组共享输入：

整理状态：已整理为能力组级输入

能力组目标：
- 以一个首版 change 支持回答语言跟随用户主语言，并保留电信领域术语原始表达。

共享规格输入：
- 纳入首版本地 release。
- `locale` 是核心上下文中唯一的用户语言/区域化输入事实；本 change 可从 `locale` 和用户输入派生回答语言，但不得向 `RequestContext`、`ContextAssemblyRequest` 或 `ContextAssembly` 增加 `language` 字段。
- 回答语言默认跟随用户主语言。
- 保留电信术语原始表达。
- 不引入独立语言检测服务、复杂术语库治理或多 change 拆分。

并行边界：
- 该 change 只定义输出语言和术语保留规则。

后续维护：
- 本文件承载该 change 的详细规格输入、契约输入、实现约束、非目标、验收要点和并行边界。
- 如果本 change 需要修改已冻结核心契约，必须先提出 contract refinement change。
