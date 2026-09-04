# Change: 将 ToolSearch 设为延迟能力的默认发现入口

## Why

Agent 开发者需要同时使用两类受治理能力：默认即可调用的能力，以及为控制模型上下文而延迟披露的能力。当前 ToolSearch 只在部分配置模式下可见，且会搜索已经默认披露的能力，导致默认可见能力重复出现，而延迟能力缺少稳定的发现入口。

## 目标

- 当前 Agent/run 已授权且 `modelInvocable=true` 的 Tool 和 Skill 保持默认可见。
- `ToolSearch` 成为当前 Agent/run 内 `modelInvocable=false` Tool 和 Skill 的默认发现入口。
- 搜索结果只包含安全元数据，并在请求内激活命中的候选，供后续模型 step 调用。
- 未命中搜索时返回安全空结果，不回退到已经默认可见的能力。

## Out of Scope

- 不改变 SkillHub 协议、远端内容获取或安装行为。
- 不允许客户端请求体、模型输出或 capability 参数改变 Agent Scope、Owner Scope、capability binding、availability 或 disclosure policy。
- 不在同一个模型 step 内完成搜索和候选调用。
- 不披露 CLIP provider 私有 id、primitive、命令模板、endpoint、路径或原始 payload。
- 不引入模型、embedding、外部搜索服务或 provider 私有评分进行自然语言排序。

## What Changes

- `ToolSearch` 在当前 Agent/run 已授权且可用时默认进入模型 Tool 列表，同时不删除、重排或改写原有 `modelInvocable=true` Tool。
- `ToolSearch` 只搜索受治理、可用、非隐藏且 `modelInvocable=false` 的 Tool、Skill 和已配置 CLIP-backed Tool。
- `query` 支持省略、空字符串和 `*` 的有界候选列表查询，并支持 `keyword`、`natural` 和精确 metadata scalar filters。
- 命中的 Tool 通过 request-local `allowedTools` 激活；命中的 Skill 通过 request-local `discoveredSkills` 激活。
- `modelInvocable=true` Skill 继续在 system prompt 中作为 enabled Skill 披露。

## Function 影响（OpenSpec Capabilities）

| Function | 变更类型 | canonical spec | 变化边界 | 系统质量属性 |
|---|---|---|---|---|
| `FN-5.14 搜索工具` | 修改 | `tool-search-tool` | 修改默认入口、搜索候选范围、查询输入、结果激活和安全空结果；不改变 capability authority | 无新增黑盒质量目标 |

## Feature 影响

| Feature | 变更类型 | 变化边界 |
|---|---|---|
| `F-5.8 工具渐进式加载` | 修改 | 从配置触发的 ToolSearch 披露调整为延迟能力的默认发现入口，同时保持默认可见能力不变 |

## 被动影响

- ToolSearch input/runtime schema、搜索排序和安全结果投影。
- Tool/Skill 的 context disclosure 与 request-local activation 测试。
- CLIP-backed Tool descriptor 的默认可调用标记和搜索后激活路径。
