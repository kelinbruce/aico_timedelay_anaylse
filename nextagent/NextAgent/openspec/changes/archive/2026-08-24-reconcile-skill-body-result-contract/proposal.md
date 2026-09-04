## Why

当前 `Skill` tool 实现已经把 inline Skill 正文放入 `CapabilityInvocationResult.structuredPayload.body`，并让 `generatedMessages` 为空；普通会话投影也会隐藏 `CAPABILITY_RESULT` 正文，避免用户可见泄漏。但 stable `skill-tool` spec 仍要求正文通过恰好一条 hidden generated message 传输，并禁止 `structuredPayload` 携带正文。实现与权威规格已经漂移，导致既有回归测试无法同时表达当前受治理行为与规格基线。

需要单独收敛该契约，避免把 Skill 正文传输语义混入 directed Skill lifecycle 展示 change。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 将 inline Skill 成功加载的目标态定义为：`structuredPayload` 携带 `name`、`status: "loaded"` 和 canonical Skill `body`，`generatedMessages` 为空。
- 保持 Skill 正文只对模型上下文可见，不进入普通用户可见会话内容或过程详情。
- 保留既有 canonical body、资源投影、wrapper boundary、编码、大小和 source-private 泄漏检查。
- 更新 stale 的 directed Skill payload 回归测试，使其断言当前目标态。

**非目标：**

- 不改变 Skill 解析、授权、资源投影、context patch、模型调用或 directed Skill lifecycle 行为。
- 不恢复 page-hidden USER message 传输方式。
- 不新增 Web API 字段、stream event type、数据库表或前端展示逻辑。
- 不处理 directed Skill ProcessDetail lifecycle 展示；该行为由 `show-targeted-skill-process-lifecycle` 承载。

## What Changes

- 修改 inline Skill 成功结果契约：canonical Skill 正文作为 `structuredPayload.body` 随同一个 `CapabilityInvocationResult` 返回，不再通过 hidden generated message 单独传输。
- 明确 `generatedMessages` 在 inline Skill 成功加载时必须为空，避免正文重复进入模型上下文。
- 明确用户可见会话投影和过程投影不得暴露 `structuredPayload.body`。
- 更新 directed Skill 真实 Skill body 回归测试，锁死 `structuredPayload.body` 与空 `generatedMessages` 的目标态。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-5.9 调用技能` → `specs/skill-tool/spec.md`
  - 功能边界：inline Skill 成功结果的正文承载位置从 hidden generated message 收敛为同一 `CapabilityInvocationResult.structuredPayload.body`。
  - 系统质量属性：安全、可维护性、可测试性。
  - 映射说明：canonical spec 为 `skill-tool`。

## 影响范围（Impact）

- **模型上下文**：Skill 正文继续进入下一模型步骤，但由 tool result payload 携带，不再产生额外 hidden USER message。
- **用户可见输出**：普通会话和过程投影继续不得展示 Skill 正文。
- **公共 API / stream contract**：不新增字段或事件；仅收敛既有 `CapabilityInvocationResult` 内部语义。
- **测试**：更新 `skill-tool` 与 directed Skill payload 相关回归测试。
