# FN-3.2 编译智能体装配

> 能力域 D3 Agent 装配与主链路 · 子域 [D3.1 智能体装配](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-3.1](../../../features/D3-Agent装配与主链路/D3.1-智能体装配/F-3.1-装配智能体.md) |
| 主规格 | `agent-package-assembly` |
| 遗留规格 | `extension-registration` |
| 接口 | 系统启动期内部编译 |

## 描述

启动期将智能体配置编译为运行时装配，包括唯一的 Agent loop 与单轮 Tool-call 接纳上限；请求路径直接使用编译结果，不重新解析配置。registry 支持运行时动态刷新发现新增 agent，`active(agentId)` 支持查找任意已注册 user-invocable agent，不再限制为单一 configured `activeAgentId`。

## 前置条件

- 智能体配置已注册。
- `agentsRoot` 目录可访问；`systemConfig` 和 `modelProfiles` 已初始化；`assemblyRegistry` 已在启动时完成首次编译。

## 输入

智能体配置文件。

## 输出

运行时装配（含 `modelIds/defaultModelId`、提示词、能力、策略、`maxTurns` 和 `maxToolCallsPerTurn` 的编译结果），不包含模型接入配置。

## 处理过程

1. 启动期扫描已注册的智能体配置。
2. 显式模型引用必须有效；省略模型范围时，builtin 与开发者 Agent 统一继承冻结 system config 的完整有序模型清单并以首项为默认。
3. 校验 runtime settings 的封闭字段和数值范围；`maxTurns` 必须为正安全整数，`maxToolCallsPerTurn` 必须为 `1..100` 的安全整数。
4. 编译为运行时装配，冻结装配结果；省略时分别采用 `maxTurns=50` 与 `maxToolCallsPerTurn=30`。
5. 启动期将 Agent 文件目录配置（`readDirectories`/`writeDirectories`）编译为 root-qualified canonical authority：区分缺省与显式空集合，`.` 为 `workspace`，普通无前缀目录为 `workspace/<directory>`，已知 root 保持 root-qualified，规范化全部目录并拒绝非法目录；写目录自动加入有效读权限。装配结果不可由请求扩大。
6. 请求路径直接使用冻结的编译结果，不重新解析配置，也不允许 request 或模型覆盖 Agent-owned limits。
7. registry 在 `active`/`require`/list 方法调用时同步检测 `agentsRoot` 下顶层 agent 目录的 fingerprint 变化（新增、删除、agent.yaml 修改）并重建 assembly 集合；fingerprint 不覆盖 `agents/{parentAgentId}/subagents/` 目录。重建复用启动时编译边界和校验规则。重建失败时保留上一次有效集合并通过 structured log 记录（`agent.registry.refresh_failed`）。并发请求不阻塞等待重建：当前请求同步完成重建后返回新集合，重建期间到达的新请求使用上一次有效集合响应。已 accepted request 通过 `require(agentId, agentVersion)` 继续使用 frozen assembly，不受重建影响。

## 结果

- 正常：编译成功，装配可用于请求处理。
- 编译失败：安全失败，智能体不可用。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| 编译时点 | 启动期、请求接收前完成；请求路径重新解析或编译次数为 0 | `agent-package-assembly`：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup`、`Request path does not reparse Agent prompt inputs` |
| 省略 `modelIds` | 按冻结 system config 的 provider/profile 顺序继承全部已校验 canonical `modelId` | `agent-package-assembly`：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup` |
| 显式模型范围 | `modelIds` 必须非空、有序、无重复且全部有效；`defaultModelId` 如存在必须属于该范围，省略时使用第一个 eligible model | `agent-package-assembly`：`Agent Package Assembly Compiles Runtime-Ready Assembly At Startup` |
| Agent loop 运行上限 | 每个 request 的普通 model turn 上限为正安全整数，缺省 50；每个普通 model turn 的 Tool call 接纳上限缺省 30、有效域 1..100；不存在其他 Tool-call 数量预算 | `agent-package-assembly`：`Agent 运行设置只定义轮次上限和单轮工具调用上限` |
| registry 刷新模式 | active/require/list 调用时同步检测 fingerprint 并重建；重建失败保留上一次有效集合；并发不阻塞；已 accepted request 不受影响 | `agent-package-assembly`：`AgentAssemblyRegistry 支持运行时动态刷新发现新增 agent` |
| active 查找范围 | 任意已注册 user-invocable agent，不限于 configured `activeAgentId` | `agent-package-assembly`：`AgentAssemblyRegistry Lookup Semantics Stay Frozen`
| 文件目录规范形式 | `.` 为 `workspace`，普通目录为 `workspace/<directory>`，已知 root 保持 root-qualified | `agent-package-assembly`：`Agent 装配编译 root-qualified 文件目录权限` |
