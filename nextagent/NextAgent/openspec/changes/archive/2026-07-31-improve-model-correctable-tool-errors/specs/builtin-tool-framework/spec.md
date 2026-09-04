## ADDED Requirements

### Requirement: 模型可纠正的 Tool 输入失败暴露安全诊断

Tool 框架 SHALL 为模型可在后续 Tool 调用中纠正的 Tool 参数
校验失败，返回确定性、有界、模型可见的
诊断消息。该诊断 MUST 在可用时标识安全字段或被违反的
约束，
MUST 保留该 Tool 既有的失败 code、category 和
retryable 语义，并 MUST NOT 自动重复被拒绝的调用。

公共 JSON Schema 校验路径 MUST 拥有 provider 中立的
schema
诊断，MUST NOT 按单个 Tool 名称分支。Tool 专属语义
validator MAY 为未被 JSON Schema 完整表达的约束提供稳定的纠正消息。

诊断 MUST NOT 包含被拒绝的字段值、prompt 或模型输出、
文件或附件内容、credential 或 token、物理或逻辑路径、
raw provider 响应、raw 异常、schema regex 源，或其他不安全或
高基数数据。授权、policy、内部和输出校验
失败 MAY 在额外细节会削弱安全或封装
边界时保持刻意的粗粒度。

#### Scenario: object 字段收到 JSON 编码字符串

- **WHEN** 一个 Tool 输入 schema 要求一个 object 字段
- **AND** 模型为该字段提供一个字符串
- **THEN** 该调用 MUST 以既有的输入校验 code、
  `category=VALIDATION` 和 `retryable=false` 失败
- **AND** 模型可见错误消息 MUST 标识该字段需要
  object 而不是字符串
- **AND** 它 MUST 指示模型传递原生 JSON object 而不是
  JSON 编码字符串
- **AND** 它 MUST NOT 回显该字符串值。

#### Scenario: Schema 校验报告安全可操作的约束

- **WHEN** 公共 Tool JSON Schema 校验因必填字段、类型、
  额外属性、有界长度、有界数字、enum 或有界
  数组失败
- **THEN** 模型可见错误 MUST 标识至多三个去重后的安全
  违规
- **AND** 完整错误消息 MUST 保持在固定字符预算内
- **AND** 使用公共 executor 的动态、app 组合和 Memory Tool MUST 在没有 Tool 专属 executor metadata 或分支的
  情况下获得相同行为。

#### Scenario: 语义校验提供纠正性消息

- **WHEN** 一个 builtin Tool 拒绝一个未被其 JSON Schema 完整表达的参数关系、runtime policy
  预算、安全 pattern 或有界语法规则
- **THEN** Tool 拥有的校验消息 MUST 标识模型可以纠正的安全字段或
  约束
- **AND** 它 MUST 保留既有错误 code、category 和 retryable 标志
- **AND** 它 MUST NOT 暴露被拒绝的原始值或受保护的执行事实。

#### Scenario: 详细错误支持后续纠正的 Tool 调用

- **WHEN** 一个 Tool 参数因模型可纠正的校验错误而失败
- **THEN** 失败的 Tool result MUST 通过既有
  capability-result 路径投影，并在 `errorMessage` 中携带安全诊断
- **AND** 框架 MUST NOT 用相同参数自动重试
- **AND** 较后的模型 turn MAY 提交已纠正的 Tool 调用。

#### Scenario: 不安全的失败细节保持隐藏

- **WHEN** 校验或执行遇到路径、credential、prompt、模型
  输出、附件内容、provider 响应、raw 异常、授权、
  policy 或内部失败细节
- **THEN** 模型可见错误 MUST 省略该原始细节
- **AND** 系统 MUST 保持既有安全边界和低基数
  reason-code 行为。
