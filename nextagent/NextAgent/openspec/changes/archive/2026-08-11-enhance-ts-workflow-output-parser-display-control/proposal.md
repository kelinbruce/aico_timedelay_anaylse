# Proposal: Enhance output_parser with display type, data, message_level and show_aigc

## 背景与问题（Background and Why）

产品规格（`docs/workflow/Recipe specification.md`）为 `output_parser` 定义了六个显示控制字段：`show_title`、`show_content`、`show_aigc`、`type`、`data` 和 `message_level`。stable spec `workflow-output-parser-contract` 及其实现只覆盖 `show_title`/`show_content`（显示可见性）和输出序列化。仍有四个字段未实现：

1. **`type`（通用）**：只有 `interaction-nodes`（DISPLAY node）读取 `outputParser.type`。projector 的 `resolveDisplayControl` 忽略它。其他节点类型无法声明显示类型。
2. **`data`**：从未被读取。没有机制把 `output_parser.data` 用作 message 内容以替代序列化输出。
3. **`message_level`**：从未被读取。Message level 由 answer-node 反向推导得出，不能按节点配置。
4. **`show_aigc`**：从未被读取。不存在 AIGC 标签透传。

此外，产品规格声明 "PIU type stores to HOFS; others store to ZENITH"。TS runtime 使用统一的 `TOOL_STRUCTURED_DELTA` timeline 事件模型，没有 HOFS/ZENITH 存储路由。这一偏差必须被文档化。

## 变更范围（What Changes）

- **新增** projector 的 `resolveDisplayControl` 中的 `type` 解析：读取 `output_parser.type`（或 camelCase 的 `type`），对照 display-type enum（TEXT/TABLE/CHART/PIU/HTML/DSL/OBJECT）校验，并映射到 structured delta 的 `ToolMessageType`。PIU 映射为 "PIU"，DSL 映射为 "DSL"，其余映射为 "TEXT"。原始 type 字符串还会作为 `displayType` metadata 透传。
- **新增** `data` 内容覆盖：当 `output_parser.data` 是非空对象时，用它替代 `serializeOutput` 作为 `TOOL_STRUCTURED_DELTA` 的 `content`。`data` 缺失时回退到输出序列化。
- **新增** `message_level` 解析：当 `output_parser.message_level`（或 `messageLevel`）是有效的 `ToolEventType` 字符串时，用它作为 structured delta 的 `toolEventType`，覆盖默认的 answer-node 推导 level。有效值：TITLE、ANSWER、DETAIL、EXPAND_PANEL。
- **新增** `show_aigc` 透传：当 `output_parser.show_aigc`（或 `showAigc`）为 true 时，在 structured delta payload 中包含 `aigc: true`。默认 false；为 false 时省略。
- **文档化** HOFS/ZENITH 偏差：TS runtime 把 PIU 数据内联承载在 `TOOL_STRUCTURED_DELTA` content 中。不需要单独的存储路由。这是相对遗留产品规格的一个显式设计例外。
- **不改变** `show_title`/`show_content` 行为（已实现）。
- **不改变** 输出序列化逻辑（已实现）。
- **不改变** `agent-common` 中的 `ToolMessageType` 或 `ToolEventType` enum。

## Capability 影响（Capability Impact）

### 修改的 Capabilities

- `workflow-output-parser-contract`：为 output parser 控制配置扩展 `type`、`data`、`message_level` 和 `show_aigc` 字段及其解析规则。

### 新增 Capabilities

无。不新增节点类型，不新增 gateway contracts，不新增 enum。

## 影响范围（Impact）

- `agent-core`：`WorkflowRuntimeEventProjector` 扩展 `resolveDisplayControl` 以返回 `displayType`、`displayData`、`messageLevel`、`showAigc`；`projectStructuredDelta` 在构建 `TOOL_STRUCTURED_DELTA` 时使用这些值。
- 对 `agent-contracts` 无影响（`outputParser` 已是 `WorkflowOpaqueObjectSchema`，无需 schema 变更）。
- 对 `agent-workflow` 无影响（interaction-nodes 已有本地 `type`/`level` 读取；projector 变更使其通用化，但不会破坏既有本地路径）。
- 对 `agent-app`、`agent-channel-web` 或前端无影响（structured delta payload 增加可选的 `displayType` 和 `aigc` 字段；前端已能优雅接收未知 payload 字段）。

## 边界对齐（Boundary Alignment）

- 与 `add-ts-workflow-output-parser-contract`（已归档）：本 change 扩展同一 stable spec。已归档 change 建立了 `show_title`/`show_content` 与序列化；本 change 补齐其余四个字段。无冲突。
- 与 `interaction-nodes` 本地的 `readDisplayOutputType`/`readDisplayLevel`：projector 层的解析是通用路径。Interaction-nodes 的本地函数继续负责 DISPLAY node 的 streaming channel 选择。无冲突——它们服务于不同层（streaming channel 与 structured delta）。
- 与 `tryOutputDrivenDelta`：它从节点输出读取 `type`/`level`/`content`。当设置了 `output_parser.type` 或 `output_parser.data` 时，新的 `output_parser` 驱动解析优先，确保 recipe 作者可以通过 `output_parser` 控制显示，而无需把显示 metadata 内嵌到业务输出中。
- 与 HOFS/ZENITH：显式文档化为不适用于 TS runtime。PIU 数据内联承载在 structured delta content 中。

## 验证（Validation）

- Projector 测试：每种显示类型（TEXT/TABLE/CHART/PIU/HTML/DSL）的 `type` 解析。
- Projector 测试：`data` 存在时的内容覆盖；缺失时回退到序列化。
- Projector 测试：`message_level` 覆盖 answer-node 推导的 level。
- Projector 测试：payload 中的 `show_aigc` 透传。
- Projector 测试：`output_parser` 驱动的解析优先于 output 驱动的 delta。
- 回归测试：既有 `show_title`/`show_content` 与序列化行为不变。
- `npx tsc -b`、`npm run lint:architecture`、完整测试套件。
