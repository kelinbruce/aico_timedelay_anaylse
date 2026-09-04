## Why

平台集成方调用北向 action 时，需要在同一请求终态中取得 Bash Tool 已产生的结构化执行结果。当前 lifecycle Hook 的能力结果后边界无法同时判断本次 Bash 输入是否包含部署方为插件配置的目标字符串，因此 Hook 不能只在目标调用完成后选择性返回结果；若对所有 Bash 调用返回结果，会扩大不必要的输出范围并泄露无关工具结果。

现在处理该问题，是为了让北向 action 调用具备可测试、可审计且最小暴露的结果输出路径，并保持非目标 Capability 调用的现有行为不变。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 提供稳定身份为 `northbound-output-normalization-hook` 的 lifecycle Hook。
- Agent 开发者必须通过目标 Agent 的 Hook activation 配置非空检查字符串；仅当已完成的 runtime Capability 是 `Bash`，且该次有效输入的 `command` 字符串或 `args` 中至少一个字符串包含区分大小写的连续检查字符串时，Hook 才返回 `PASS` 和 Bash 结构化结果。
- Hook 在 `HookResult.resultSummary` 中按 JSON 语义原样返回 Bash 结构化结果，不解析、不筛选、不重命名、不补全业务字段。
- 所有不同时满足上述条件的调用返回 `SKIP`，且不提供 `resultSummary`。
- 返回结果继续遵守当前 Owner Scope、Agent Scope、JSON 合法性和容量边界；非法或超限结果不得部分输出。
- backend-capable 本地运行包随附可加载的 Northbound Hook 插件资产，供部署方按需声明并由目标 Agent 激活。

**非目标：**

- 不执行配置文本指向的 action，不改变 Bash Tool 输入、执行、sandbox、安全策略或结构化结果。
- 不匹配 `description`、环境变量或 Bash 结果内容中的配置文本。
- 不把包含配置文本的其他 runtime Capability 当作匹配调用。
- 不新增结果解析、northbound 业务 schema、字段映射、裁剪、脱敏或降级结果。命中时同时返回 `resultSummary`（写入 `hookResults` 供北向消费）和 `mutation: { structuredPayload }`（替换 boundary 中的 structuredPayload 供模型和 CAPABILITY_RESULT_DELTA 使用）。
- 不默认激活 Hook，不改变其他 Agent 的 Hook 配置。
- 不因随包交付资产而自动把插件写入 system plugin 声明或默认 Agent Hook activation。

## What Changes

- 修改 Capability 结果后 Hook 的公共边界，使 Hook 能在执行完成后同时取得既有 `capabilityId` 和本次调用的已生效输入；这些事实只用于当前 stage 的 Hook 判定，不改变 Capability 调用结果。
- 新增 `northbound-output-normalization-hook`。
- 修复 Hook invocation `requestContextId` 超 64 字符限制导致 `HOOK_INVOKED` 事件写入失败的问题：runtime 使用确定性短哈希压缩 `requestContextId`。它支持由目标 Agent 的 Hook activation 显式配置检查字符串，只支持 `AFTER_CAPABILITY_RESULT`，只观察已完成调用，不返回 mutation 或 lifecycle control。
- 当目标条件命中时，Hook 把 Bash `structuredPayload` 作为 `HookResult.resultSummary` 原样返回；未命中时返回 `SKIP` 且省略结果。
- 结果继续进入既有 Hook invocation 事实和同一请求终态 Hook 结果快照，不新增平行事件、DTO 或输出通道。
- backend-capable 本地运行包随附可加载的插件资产，但该交付行为不自动声明插件，也不自动激活 Hook；frontend-only 产物不包含该后端插件资产。

## Feature 影响（Features）

### 修改的 Feature

- `F-10.1 扩展生命周期钩子`：Agent 开发者可配置并启用一个仅针对目标 northbound Bash 调用输出原始结构化结果的标准 Hook；组成 Functions 不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.1 注册和执行钩子` → `specs/lifecycle-hook-execution/spec.md`
  - 功能边界：扩展 `AFTER_CAPABILITY_RESULT` 的最小判定输入，并新增按 Bash runtime Capability 身份和插件配置字符串返回原始结构化结果的 Hook 行为；不改变 Capability 执行结果、mutation 或 lifecycle control。
  - 系统质量属性：安全、审计/可追溯性、可测试性。
  - 映射说明：canonical spec；本 change 不触及 legacy spec；实现依赖已完成的 `refine-ts-hook-result-event-summary` 与 `add-ts-terminal-hook-result-snapshot` 契约。

## 影响范围（Impact）

- 平台集成方：当前请求终态可取得匹配 northbound action 调用的 Bash 结构化结果；未命中调用不增加结果。
- Agent 开发者：必须在目标 Agent 中显式启用该 Hook；未启用 Agent 行为不变。
- 公共契约：`AFTER_CAPABILITY_RESULT` 增加只读、已生效调用事实，属于 additive `agent-contracts/runtime` refinement，需要完成契约升级确认。
- 安全与运维：匹配结果按当前可信请求 scope 输出，并受既有 JSON 与容量校验约束；不新增日志、metric、trace 或 audit 中的原始 Tool 输入输出。
- 代码与验证：影响 lifecycle Hook contract、结果后 boundary 组装、Hook 开发资产、本地运行包交付，以及对应 contract、SDK、kernel、终态快照和打包测试。
