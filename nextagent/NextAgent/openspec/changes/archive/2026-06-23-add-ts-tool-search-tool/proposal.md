## 背景与问题（Why）

`ToolSearch` 涉及候选工具检索、source 可见性、权限过滤和结果披露，容易与动态工具源、安装和 conflict resolution 混淆。需要独立 change 定义它作为查询型工具入口的黑盒边界。

## 变更范围（What Changes）

- 新增 `ToolSearch` tool descriptor、input/output schema 和 safe result。
- 定义 ToolSearch 只查询当前 run 已治理的候选工具索引或 catalog projection。
- 定义搜索结果的安全字段、排序、limit、truncation 和 scope 约束。

## Capability 影响（Capabilities）

### 新增 Capability

- `tool-search-tool`：模型通过 Tool 入口搜索当前可见的候选工具说明。

## 影响范围（Impact）

- `agent-capability`：ToolSearch descriptor 和 executor adapter。
- capability catalog/source projection owner：提供安全候选工具索引。
- `agent-context-engine` / model render：消费搜索结果用于后续 tool selection。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不动态安装工具。
- 不扫描文件系统、SkillHub、MCP server 或 API source。
- 不定义 capability conflict resolution 或 source configuration。
- 不扩大当前 Agent 已授权/可见工具集合。
