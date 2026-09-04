# app-config-schema Specification Delta

## ADDED Requirements

### Requirement: Recipe YAML Parsing

`agent-app` 的 `parseBuiltInConfig` MUST 提供一个入参为文本字符串、出参为 JavaScript 值的纯解析接口，使用业界标准 YAML 解析器（`js-yaml`）解析非 JSON 内容，替换手写扁平解析器。该接口只负责把文本解析为对象，不关注谁触发解析、不关注解析结果的业务语义。

**接口契约**：
- 入参：`content: string`（文本内容，来源不限）
- 出参：`unknown`（与文本结构对应的 JavaScript 值）
- 纯函数：无 I/O 副作用，无日志，无状态变更

**触发机制**：纯解析接口，不自行触发，由调用方在读取文件后同步调用。不在 request lifecycle 内，无预算检查、无后台 job、无调度机制、无用户动作触发。

**输入与前置条件**：仅需文本字符串，无对象/状态/refs/预算/安全上下文/已完成依赖。文件读取、扫描、信任校验均由调用方在调用前完成。

**输出与副作用**：返回与文本结构对应的 JavaScript 值；不产生事件、状态、日志、audit、metric、用户可见提示或后续可消费 ref；不产生 summary/artifact/checkpoint/pending input/配置状态/诊断状态/memory record/learning event。

**核心判断逻辑**：
1. 先尝试 `JSON.parse`；
2. 若抛错，走 `js-yaml` 的 `load` 解析；
3. 解析结果交由调用方处理。

**流程接入**：本接口是被调用的工具，不接入特定主流程。上游=各调用方（系统配置加载、agent 定义加载、recipe 加载，传入文本字符串）；下游=各调用方（消费解析得到的 JavaScript 值，自行做归一化与 schema 校验）。后续流程如何消费由各调用方 owner 负责，本接口不关心。

**边界**：
- 不关注调用方与触发时机（系统配置、agent 定义、recipe 加载均可是调用方）；
- 不关注解析结果是否为合法 recipe / agent 定义 / 系统配置（由各调用方自行校验）；
- 不关注文件扫描、加载目录、信任校验、失败日志（由各调用方负责）。

**失败与降级**：
- 解析失败 MUST 抛异常交由调用方处理；MUST NOT 静默返回空值或默认值掩盖失败（不得静默吞错）；
- 本接口为同步纯函数，无超时、无不可用、无超预算、无外部依赖缺失风险（`js-yaml` 是本地库）；
- 失败后是否跳过单文件、是否阻断启动、是否记录日志，均由调用方决定，本接口不兜底、不截断、不丢弃。

#### Scenario: Standard YAML Parsing
- **WHEN** 入参是合法 YAML（含缩进块、嵌套 map、块序列、混合标量）
- **THEN** `parseBuiltInConfig` MUST 返回与 YAML 结构对应的 JavaScript 值

#### Scenario: Nested Structure Parsing
- **WHEN** 入参包含嵌套 map（如 `nodes`、`next`、`inputs`、`outputs`）与块式数组
- **THEN** 解析器 MUST 将其解析为对应的嵌套对象与数组

#### Scenario: Scalar Type Inference
- **WHEN** YAML value 是数字字面量（如 `5000`）
- **THEN** 解析器 MUST 将其推断为 number 类型
- **AND** 字符串 value（如 `demo_recipe`）MUST 保持为 string
- **AND** 形如 `1.1.0` 的非合法数字字面量 MUST 保持为 string

#### Scenario: JSON Fallback Preserved
- **WHEN** 入参是合法 JSON
- **THEN** `parseBuiltInConfig` MUST 优先使用 `JSON.parse`
- **AND** 返回值 MUST 与 JSON 结构一致

#### Scenario: Flat YAML Parser Removed
- **WHEN** 入参包含嵌套缩进或块式数组等非扁平语法
- **THEN** `parseBuiltInConfig` MUST NOT 抛 `Built-in YAML uses unsupported syntax.`
- **AND** MUST 成功解析为嵌套结构

#### Scenario: Parse Failure Propagation
- **WHEN** 入参是非法 YAML
- **THEN** `parseBuiltInConfig` MUST 抛异常
- **AND** MUST NOT 静默返回空值或默认值

#### Scenario: Pure Function No Side Effects
- **WHEN** 调用 `parseBuiltInConfig`
- **THEN** 接口 MUST NOT 执行 I/O
- **AND** MUST NOT 记录日志
- **AND** MUST NOT 修改任何状态
