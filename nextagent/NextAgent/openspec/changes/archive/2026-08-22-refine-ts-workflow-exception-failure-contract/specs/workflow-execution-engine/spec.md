## ADDED Requirements

### Requirement: Exception Failure Variable Contract

当节点执行失败且重试耗尽后进入 exception 路由时，engine MUST 把失败信息注入 exception 分支的 condition 变量空间，注入位置为 `error`。失败变量空间 MUST 仅包含 `code`、`message` 和可选的 `category` 三个字段。

`code` MUST 为非空字符串，是失败的第一标识。当失败由 capability（含 RESTful 节点）业务失败引起时，`code` MUST 直接携带上游接口返回的业务 code，engine MUST NOT 用框架码覆盖业务 code。当失败由 engine 自身结构性原因引起时，`code` MUST 携带框架码（如 `WORKFLOW_NODE_TIMEOUT`）。engine MUST NOT 解释或映射业务 code 的语义。

`message` MUST 为字符串，是失败的人类可读原因。当失败由 capability 业务失败引起时，`message` MUST 取上游接口返回的 message；当失败由 engine 合成时，`message` MUST 取 engine 生成的 message。`message` 取代原 `reasonCode` 字段。

`category` 为可选字段。仅当失败由 engine 合成的超时引起时，`category` MUST 为 `"TIMEOUT"`。其他所有失败 MUST NOT 携带 `category` 字段。engine MUST NOT 在 exception 变量空间中暴露 `VALIDATION`、`UNAVAILABLE`、`NOT_FOUND`、`POLICY_DENIED`、`CANCELED`、`INTERNAL`、`AUTHORIZATION`、`CONFLICT` 等 category 值。

注入的 `error` 对象 MUST 被冻结，且 MUST 与既有 workflow 变量合并后作为 exception condition 的求值上下文。exception condition 的求值上下文 = 原有 workflow 变量 + 注入的 `error`，两者平级可见，recipe 可自由组合。原有 workflow 变量 MUST 保留可见，recipe 可从 workflow 上下文取到既有变量。

设计入口：openspec/designs/modules/agent-workflow.md、openspec/designs/adr/workflow-exception-category-collapse.md

#### Scenario: Business failure code passthrough
- **WHEN** RESTful 节点调用的 capability 返回业务失败，其 `safeError.code` 为 `5001`
- **THEN** engine 注入的 `error.code` MUST 等于 `5001`
- **AND** `error.code` MUST NOT 等于 `WORKFLOW_CAPABILITY_FAILED`
- **AND** `error` MUST NOT 携带 `category` 字段

#### Scenario: Business failure message passthrough
- **WHEN** capability 返回业务失败，其 `safeError.message` 为 `order not found`
- **THEN** engine 注入的 `error.message` MUST 等于 `order not found`

#### Scenario: Timeout category overlay
- **WHEN** 节点执行超过声明的 timeout，engine 合成超时失败
- **THEN** `error.code` MUST 等于 `WORKFLOW_NODE_TIMEOUT`
- **AND** `error.category` MUST 等于 `"TIMEOUT"`
- **AND** `error.message` MUST 为非空字符串

#### Scenario: Engine structural failure without category
- **WHEN** 节点抛出非超时、非业务失败的 engine 合成错误（如重试耗尽后的兜底失败）
- **THEN** `error` MUST NOT 携带 `category` 字段
- **AND** `error.code` MUST 为非空框架码字符串

#### Scenario: Existing workflow variables remain visible
- **WHEN** engine 注入 `error` 后对 exception condition 求值
- **THEN** 原有 workflow 变量 MUST 保持可见且可被 condition 引用
- **AND** `error` MUST 被冻结不可变

#### Scenario: Condition routes by business code
- **WHEN** exception 分支声明 `condition: "${error.code == '5001'}"`
- **AND** 注入的 `error.code` 等于 `5001`
- **THEN** engine MUST 选中该分支

#### Scenario: reasonCode field removed and injection location changed
- **WHEN** engine 注入 `error` 后检查变量空间
- **THEN** `error` MUST NOT 包含 `reasonCode` 字段
- **AND** 变量空间 MUST NOT 包含 `__workflow` 键

## MODIFIED Requirements

### Requirement: Timeout and Retry

engine MUST 支持节点级 timeout 和 retry。

#### Scenario: Retry Exhausted
- **WHEN** 节点重试耗尽
- **THEN** engine MUST 产出失败或跳过结果
- **AND** 若进入 exception 路由，失败变量 MUST 符合 Exception Failure Variable Contract

#### Scenario: Timeout Produces Failure Variable
- **WHEN** 节点执行超过声明的 timeout
- **THEN** engine MUST 合成 `code` 为 `WORKFLOW_NODE_TIMEOUT` 的失败
- **AND** 注入的 `error.category` MUST 为 `"TIMEOUT"`
- **AND** 注入的 `error.message` MUST 为非空字符串
