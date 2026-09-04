## ADDED Requirements

### Requirement: ToolSearch 投影被延迟的 CLIP Tool 结果

当 `ToolSearch` 返回一个来自 ToolSearch 延迟的 `clip_server` provider 的受治理可见 Tool 时，它 MUST 把该结果投影为一个被延迟的 CLIP Tool 匹配，同时仍通过既有的 request-local `CapabilityContextPatch.allowedTools` 机制激活具体的 Tool descriptor。该行为属于 ToolSearch 结果投影；CLIP provider 发现仍由 API 支持的 Tool source 拥有。

ToolSearch 结果 MUST 只为匹配到的 CLIP Tool 暴露安全受治理的元数据。它 MUST NOT 暴露 provider 私有的 CLIP id、primitive、命令模板、endpoint 引用、路径、原始 CLIP payload，或一个通用的 `clipc`、`clip_api_call` 或 `api_name + args` 分发 Tool。

#### Scenario: ToolSearch 为匹配到的被延迟 CLIP Tool 发出 available-clipc

- **WHEN** `ToolSearch` 搜索受治理的可见 capability 元数据
- **AND** 一个或多个结果是来自 `clip_server` provider 的 ToolSearch 延迟 CLIP 支持的 Tool
- **THEN** ToolSearch capability 结果 MUST 把匹配到的 CLIP Tool 作为普通 `kind=TOOL` 安全结果包含在内
- **AND** ToolSearch MUST 生成一条 `<available-clipc>` meta message，在可用时列出每个匹配 Tool 的 `capability_id`、`name`、`kind=TOOL`、`defer_loading=true` 和安全描述
- **AND** ToolSearch MUST 把匹配到的 CLIP Tool 的 `capabilityId` 值加入 `contextPatch.allowedTools`。

#### Scenario: 被激活的 CLIP 结果成为普通的 model tool

- **WHEN** ToolSearch 已把一个匹配到的被延迟 CLIP Tool 加入 `contextPatch.allowedTools`
- **THEN**下一个 model 输入 MAY 把该匹配的 CLIP Tool 作为一个普通 model tool descriptor 暴露
- **AND** 暴露的 descriptor MUST 使用该 CLIP Tool 自己的 `inputSchema`
- **AND** 不得要求 model 提供 provider 私有的 CLIP id、primitive、命令、endpoint、路径或 API 选择器字段。

#### Scenario: 未匹配的 CLIP Tool 保持不披露

- **WHEN** `ToolSearch` 未匹配到任何被延迟的 CLIP Tool
- **THEN** ToolSearch MUST NOT 生成 `<available-clipc>` meta message
- **AND** ToolSearch MUST NOT 把 CLIP Tool id 加入 `contextPatch.allowedTools`
- **AND** 后续的 model tool 列表 MUST 使未匹配的被延迟 CLIP Tool 保持不可用，除非它们被另一个受治理的 request-local 机制激活。
