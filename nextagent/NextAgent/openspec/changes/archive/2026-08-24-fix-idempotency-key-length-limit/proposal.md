# Proposal: 修复幂等键长度超限导致 WM_HTTP_ERROR

## Why

生产环境（容器、远程 NAIE Memory 服务）出现 `WM_HTTP_ERROR`：某次运行在追加 assistant-tool-use 消息阶段抛出 `Memory service returned HTTP 400`。

系统对重复操作保持幂等的能力依赖 `idempotencyKey`：相同键返回首次结果，不产生重复副作用。当模型一轮返回多个 tool call 时，系统为该批 assistant-tool-use 消息生成一个 `idempotencyKey`，其值由 `runId`、固定标记和全部 `toolCallId` 拼接组成。该拼接长度无界——本次请求模型一次性返回 19 个 tool call，每个 `toolCallId` 约 25 字符，拼接后 key 达 648 字符。

远程 Memory 服务对该字段施加 `0~256` 字符上限，超长直接返回 HTTP 400，系统将其映射为 `WM_HTTP_ERROR`，该轮运行失败。本地验证未暴露该问题：本地 memory 实现不校验键长度，静默接受任意长度；长度上限只存在于远程服务的 DTO 校验层。同一份生成逻辑本地通过、生产被拒。

根因：生成的 `idempotencyKey` 既要内容可重现（支持重试/重放去重）又要长度有界，而直接拼接只满足前者。`idempotency-contract` 既有 Requirements 约束了 replay 行为、stable key 与 redaction，但未编码“生成值必须符合下游服务长度上限”这一义务。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- 运行时生成的 `idempotencyKey` 不超过下游 memory/gateway 服务的长度上限（256 字符），消除批量 tool call 场景下的 `WM_HTTP_ERROR`。
- 超长时以确定性方式塌缩，使重试与重放仍命中同一键，幂等去重语义不变。
- 非超长场景的键字面量与改前完全一致，存量行为零变化。

**非目标：**

- 不改变 `idempotencyKey` 的 replay 行为、redaction 规则或 gateway 端口契约（仍是 opaque branded string）。
- 不要求远程 Memory 服务放宽长度上限。
- 不重构其他同类单 ID 幂等键生成点（现实不会超限）；本 change 确立的原则为后续提供锚点。

## What Changes

- 在 `idempotency-contract` spec 新增 Requirement：生成的 `idempotencyKey` MUST 不超过 256 字符，超长 MUST 用内容哈希塌缩且保持确定性。
- 在 `agent-common` 新增 `IDEMPOTENCY_KEY_MAX_LENGTH = 256` 常量与 `deriveAssistantToolUseIdempotencyKey` 生成器：literal 不超限时保留原字面量；超限时把 `toolCallId` 列表塌缩为 sha256 截断摘要。
- `tool-loop.ts` 的 `appendAssistantToolUseMessage` 改用该生成器。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-11.2 幂等写入` → `specs/idempotency-contract/spec.md`
  - 功能边界：新增“生成的幂等键必须符合下游长度上限”约束，覆盖批量 assistant-tool-use 消息的键生成。
  - 系统质量属性：涉及可靠性/恢复（塌缩保持重试/重放幂等）；无新增系统质量属性 Requirement，由功能性 Requirement 派生。
  - 映射说明：canonical spec；本 change 不触及 legacy specs。

## 影响范围（Impact）

- `agent-common`：新增 `createHash` import、一个常量、一个导出函数。
- `agent-core`：`tool-loop.ts` 一处 import 与一处调用点变更；不新增 event 名、error code 或 capability contract。
- 测试：`idempotency-contract.test.ts` 新增 4 项长度/确定性契约测试，复现生产 19 个真实 provider ID 的场景。
- 不改 gateway contract、不改跨服务契约、不触及前端。
- 同类单 ID 生成器（如 `deriveCapabilityInvocationIdempotencyKey`）现实不会超 256，本次不重构。
