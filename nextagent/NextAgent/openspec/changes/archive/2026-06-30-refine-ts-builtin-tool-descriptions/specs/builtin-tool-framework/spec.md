# builtin-tool-framework Specification Delta

## Added Requirements

### Requirement: Builtin Tool descriptions follow unified model-facing guidance coverage

所有内置 Tool 的模型可见 `description` SHALL 覆盖统一的模型决策信息：一句话总结、适用场景、避免误用时的路由指引，以及关键行为（如输出格式、截断、失败语义和字段语义）。简单工具 MAY 省略不适用的信息；复杂工具 MAY 使用显式分段（如 "When to use" / "When NOT to use" / "Key behaviors"）或等价 prose 形态表达这些信息，只要语义覆盖保持一致。

描述 MUST 只描述已实现的行为，MUST NOT 承诺 schema 或实现未表达的能力。描述 MUST NOT 暴露 host 路径、credential、allowlist 具体命令或内部实现路径。

当多个内置 Tool 的功能存在重叠时（如 Bash 的 `grep`/`find`/`cat` 与 Grep/Glob/Read），相关 Tool 的描述 MUST 在 "When NOT to use" 段段中给出路由指引。

涉及 read-before-write 或 read-before-edit 硬性失败的 Tool（Write、Edit），其描述 MUST 在 "Key behaviors" 或 "Usage" 中说明该硬性失败和对应 reason code。

#### Scenario: Tool description includes routing guidance

- **WHEN** 一个内置 Tool 的功能与另一个内置 Tool 存在重叠
- **THEN** 该 Tool 的 `description` MUST 指引模型使用更合适的 Tool
- **AND** 该路由指引 MAY 位于显式 "When NOT to use" 段落中，或位于等价 prose 语句中

#### Scenario: Tool description reflects actual output format

- **WHEN** 一个内置 Tool 的 `description` 描述输出格式
- **THEN** 描述 MUST 与 `outputSchema` 和实现返回的真实结构一致
- **AND** 描述 MUST NOT 声称实现不提供的格式（如行号前缀、图片/PDF 支持等）

#### Scenario: Hard failure documented in description

- **WHEN** 一个内置 Tool 在特定条件下硬性失败（如 read-before-write、old_string 不唯一）
- **THEN** 该 Tool 的 `description` MUST 说明该硬性失败条件和对应的 reason code
- **AND** 描述 MUST NOT 把硬性失败描述为软性建议
