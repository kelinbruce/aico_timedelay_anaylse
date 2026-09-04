## 设计范围

本 change 只修改 `FN-2.4 查看请求状态` 的 Capability 结果呈现策略：把四个现有 Capability 身份加入内置 `STATUS_ONLY` 基线，并用配置与共享投影测试证明精确覆盖不会突破平台安全上限。设计不新增 projector、公共 schema、运行时状态、持久化路径或前端业务分支。

## FN-2.4 查看请求状态

### 目标与规格依据

目标 Requirement 为 `ts-run-status-visibility` 的“Capability 结果呈现策略受平台安全上限约束”。目标行为是：默认策略显式请求 `STATUS_ONLY`；集成方可以请求 `SUMMARY` 或 `DETAIL`；有效投影仍取请求级别与平台安全上限中的较低者。

#### 本 Function 的目标 Requirements

唯一 canonical spec 为 `ts-run-status-visibility`：

- `MODIFIED`：`Capability 结果呈现策略受平台安全上限约束`。

### 当前实现

应用配置归一化先建立内置策略表，再按经过 schema 校验的精确规则执行同名替换或新增。共享 Web projector 先确定平台安全上限，再把配置级别收窄到该上限。四类 Capability 当前都没有 Web 安全成功 projector，因此平台安全上限为 `STATUS_ONLY`；但内置策略表尚未显式包含它们，默认安全效果依赖未知结果降级间接成立。

### 缺口

内置策略不能直接表达产品对四类敏感结果的默认意图，配置文档也没有给出四类身份的明确基线。只验证默认页面为 `STATUS_ONLY` 无法区分“显式基线生效”与“未知结果偶然降级”，也无法证明 `SUMMARY`、`DETAIL` 覆盖已经被配置层接受。

### 唯一修改路径

1. 在现有内置策略表中新增四个精确条目，级别统一为 `STATUS_ONLY`；不创建新配置项、helper 或平行策略层。
2. 保留现有精确规则覆盖逻辑，以配置归一化测试分别断言 `SUMMARY` 和 `DETAIL` 已进入冻结策略，并断言其他内置项不受影响。
3. 在共享 Web projector 测试中使用四类代表性结果与泄漏哨兵，覆盖 `STATUS_ONLY`、`SUMMARY`、`DETAIL` 三档，断言最终均为 `STATUS_ONLY` 且没有成功结果正文或投影字段。
4. 保留既有安全失败投影，并用同一矩阵回归失败原因可见且原始结果不可见。
5. 同步用户配置说明中的内置基线清单与平台上限说明；前端组件不增加分支。

选择该路径是因为安全结果必须由平台管理的 projector 明确白名单化。仅加入四个基线条目即可消除配置意图歧义；为当前 issue 新增摘要 schema、前端渲染或 SkillHub provider 会扩大数据披露和集成范围，不符合第一性原理与 KISS。

### 质量影响

- 安全：显式默认拒绝四类成功结果正文进入普通 Web 投影；任何精确覆盖仍受平台上限约束。
- 可测试性：配置层与投影层分别提供证据，避免三档 Web 结果相同造成的误判。
- 可维护性：复用唯一内置策略表和唯一共享 projector，不形成 memory/SkillHub 专用显示分支。
- 可靠性、容量、审计：不改变事件数量、payload 上限、持久化或可观测契约。

## 验证策略

- 配置测试：断言四个默认条目均为 `STATUS_ONLY`；分别加载精确 `SUMMARY`、`DETAIL` 规则，断言冻结策略记录请求级别，并保留其他基线。
- 共享投影测试：四个 Capability 乘以三档配置，断言成功投影有效级别为 `STATUS_ONLY`，正文与全部安全摘要/详情字段为空或缺失；同时覆盖安全失败不回归。
- 组合回归：运行现有配置组合测试，确认 local、immersive、collaborative 使用同一冻结策略。
- 完整服务：使用同一配置根目录依次以默认、`SUMMARY`、`DETAIL` overlay 重启 MiniMax 完整服务；每档创建新会话，真实调用可用的三个 memory tools，检查实时页面、刷新后页面和 run events history。三档都应只显示业务标题与完成状态。`acquire_skill` 若因默认 Agent 未绑定且 composition 未提供 SkillHub access factory 而不可调用，不伪造生产路径；其成功与失败投影由自动化矩阵完整验证，并记录环境能力限制。
- 全量门禁：执行 OpenSpec strict validation、后端 build/test/contract/architecture gate、受影响前端 build 和语义代码检视。

## 风险与取舍

- 集成方可能把 `SUMMARY` 或 `DETAIL` 理解为立即显示更多内容。文档必须明确它们只是请求级别，当前四类结果的平台安全上限仍为 `STATUS_ONLY`。
- 三档真实页面结果相同不能单独证明配置加载成功，因此配置归一化自动化断言是必需的互补证据。
- 不新增 projector 会延后安全摘要能力，但避免在没有已批准字段白名单和容量边界时扩大披露面。

## 长期基线刷新计划

归档前同步：

- `openspec/specs/ts-run-status-visibility/spec.md`：归并修改后的 Requirement 与新增 Scenarios。
- `openspec/designs/functions/D2-请求运行时/D2.2-请求状态与处理/FN-2.4-查看请求状态.md`：刷新结果与 Capability 结果呈现级别规格清单。
- `openspec/designs/architecture/configuration-boundary.md`：在既有启动期冻结策略说明中补充四类显式基线。
- `openspec/designs/architecture/conversation-ui-state.md`：在既有安全投影说明中补充四类平台上限行为。

本 change 不改变 Feature 组成、模块职责、ADR 决策或 spec-to-design 导航，因此这些长期文档无需修改。

## 开放问题

无。
