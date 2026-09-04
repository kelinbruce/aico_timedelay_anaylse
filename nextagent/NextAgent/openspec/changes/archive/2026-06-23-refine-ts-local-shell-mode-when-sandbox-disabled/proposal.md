## 背景与问题（Why）

当前 local restricted sandbox 在 `sandbox.enabled=false` 时只跳过 `validateRequest()`，但仍然要求 `request.command` 必须映射到真实可执行文件。这意味着 Bash tool 虽然已经在 trusted config 下放宽了前置策略，像 `cd ... && python ...` 这类依赖 shell built-in / chaining 的命令仍会在 adapter 内部因为 `unsupported-executable` 失败。

本地开发与受信调试场景需要一个更一致的“受控 shell 模式”：

- `sandbox.enabled=true` 时继续保持现有严格模式；
- `sandbox.enabled=false` 时允许 shell built-in、命令链和受控 shell 解释执行；
- 但仍然必须保留 sandbox gateway boundary、固定 cwd、清洗环境、timeout、cancellation 和输出上限。

## 变更范围（What Changes）

- 明确 `sandbox.enabled=false` 在 local restricted sandbox 中表示 trusted shell mode，而不是 adapter unavailable。
- 当 `sandbox.enabled=false` 且 executable kind 为 `bash` 时，restricted local sandbox SHALL 通过受控 shell 解释器执行重建后的命令行。
- 受控 shell mode SHALL 支持 shell built-in 和 chaining，例如 `cd`, `&&`, `||`, `|`。
- 该模式仍 SHALL 使用 adapter-owned cwd、sanitized env、timeout、AbortSignal 和 stdout/stderr limit。
- Bash tool 在 `enabled=false` 时继续只做 deterministic tokenization，并把 token 序列交给 sandbox dependency；不得直接在 capability 层 host execute。

## 非目标（Non-Goals）

- 不修改 public `SandboxExecutionRequest` / `SandboxExecutionResult` contract。
- 不为 remote sandbox 定义同类 shell mode。
- 不把 request-time、tool input、model output 或 client metadata 变成 shell mode 开关。
- 不改变 `sandbox.enabled=true` 时的默认拒绝行为。

## 验证入口

- `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
- `npx vitest run packages/agent-capability/tests/bash-capability.test.ts`
- `openspec validate refine-ts-local-shell-mode-when-sandbox-disabled --strict`
