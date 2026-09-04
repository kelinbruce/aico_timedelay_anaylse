## 背景与问题（Why）

当前 `sandbox.enabled=true` 的 restricted local sandbox 仍保留 “direct executable only” 的严格校验语义。对于 `cd`、`&&`、`||`、`|` 等依赖 shell 解释的 built-in 或 chaining，请求会在 adapter 内部因为 `unsupported-executable` 被拒绝，而不是进入 sandbox 执行边界。我们已经用当前代码和测试验证了这一点：`enabled=true` 时 `cd` 被拒绝，`enabled=false` 时同一类请求才会切到 trusted shell mode。

这与 Bash capability 的黑盒诉求不一致。模型侧需要的是“在受控 sandbox 边界内执行一条命令意图”，而不是暴露 local adapter 对 shell built-in 和 direct executable 的内部区分。当前语义把“是否需要 shell 解释”变成了 capability 可观察失败原因，导致：

- `enabled=true` 场景下，未命中 deny 的 shell built-in / chaining 仍然失败，黑盒能力不完整；
- `sandbox.enabled` 同时承载了“是否启用校验”和“是否允许 shell 解释”两层语义，边界不清晰；
- deny policy 不是唯一的命令级约束来源，模型难以形成稳定的工具使用策略。

本变更需要重新定义 `sandbox.enabled` 的两种本地语义：

- `enabled=true`：只要命令未命中 trusted denylist，就允许进入 sandbox gateway 执行；是否需要 shell built-in / chaining 由 adapter 在 sandbox 内部处理，而不是作为 capability 级预拒绝条件。
- `enabled=false`：跳过 deny 校验，直接进入 trusted shell / direct execution 路径，但仍然必须保留 sandbox gateway boundary、adapter-owned `cwd`、sanitized env、timeout、cancellation 和 output limits。

## 变更范围（What Changes）

- 调整 restricted local sandbox 在 `sandbox.enabled=true` 下的 Bash 执行语义：
  - 允许 direct executable；
  - 允许 shell built-in / chaining；
  - 命令级不支持范围仅由 trusted denylist 定义。
- 调整 restricted local sandbox 在 `sandbox.enabled=false` 下的 Bash 执行语义：
  - 跳过 deny 校验；
  - 继续允许 trusted shell built-in / chaining 与 direct executable；
  - 不改变 sandbox gateway boundary 和 adapter-owned execution controls。
- 保留现有 sandbox gateway boundary，不改变 adapter-owned `cwd`、sanitized env、timeout、cancellation、stdout/stderr limits 等执行控制。
- Bash capability 继续只做 deterministic tokenization 和 malformed quote 拒绝；不重新引入 capability 层 command allowlist。
- **BREAKING**：stable spec 中 “`enabled=true` 时 `cd` 这类 unsupported executable 必须被拒绝” 的语义将被移除，改为允许该类命令在 sandbox 内执行。
- 调整 safe failure 语义：`unsupported-executable` 不再作为 `enabled=true` 下 shell built-in / chaining 的正常拒绝路径，仅用于 deny 之外的真实 adapter 解析失败、平台缺失或 trusted shell 不可用等 fail-closed 场景。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `sandbox-runtime`: 修改 pre-execution validation、strict mode / disabled mode 执行语义、`unsupported-executable` 失败边界，使 `enabled=true` 下的命令级限制只由 denylist 驱动，`enabled=false` 下跳过 deny 校验，并允许 shell built-in / chaining 进入 sandbox 执行。
- `bash-tool`: 修改 “strict single command” 和 `sandbox.enabled` 相关 requirement，移除对 shell composition 的 capability 级预拒绝，保留 deterministic tokenization、malformed quote 拒绝与 gateway-owned policy boundary。

## 影响范围（Impact）

- 代码：
  - `packages/agent-platform-gateway-local/src/sandbox/restricted-local-sandbox.ts`
  - `packages/agent-capability/src/builtins/bash/*`
  - `packages/agent-app/src/composition/create-app.ts`（如 safe error mapping 或 wiring 需要同步）
- 测试：
  - `packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  - `packages/agent-capability/tests/bash-capability.test.ts`
  - `tests/agent-kernel/config-assembly.test.ts`
  - 任何断言 `cd -> unsupported-executable` 的 contract / integration test
- 配置与运维：
  - `sandbox.enabled=true` 的语义从 “strict direct executable validation” 调整为 “deny-governed shell support”
  - `sandbox.enabled=false` 的语义明确为 “跳过 deny 校验的 trusted local shell support”
  - trusted denylist 只在 `enabled=true` 下作为命令级关闭手段，运维需要据此理解本地 trusted 调试风险边界
- 风险：
  - shell composition 支持面扩大后，必须靠 deny policy（`enabled=true`）、sandbox isolation、cwd/env/output/cancel 限制维持安全边界；
  - `enabled=false` 跳过 deny 后，trusted local 调试场景的风险边界需要明确；
  - 需要补充 characterization 和 negative tests，证明 `enabled=true` 的 denylist 仍然是 fail-closed，且 capability 层不会绕过 gateway。

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：
  - `openspec/specs/sandbox-runtime/spec.md`：修改 `enabled=true` 下的 validation / shell support / deny ownership 语义
  - `openspec/specs/bash-tool/spec.md`：修改 deterministic tokenization、shell composition、policy ownership 与 disable switch 语义

- 长期背景：
  - `openspec/overview.md`：无

- 设计视图：
  - `openspec/designs/architecture/<topic>.md`：无
  - `openspec/designs/modules/agent-app.md`：更新 `sandbox.enabled` wiring 语义与 safe error mapping 边界
  - `openspec/designs/modules/agent-capability.md`：更新 Bash capability 对 shell composition / gateway policy 的边界说明
  - `openspec/designs/adr/<id>.md`：无
  - `openspec/designs/spec-to-design-map.md`：如 stable spec 到 module design 的导航发生变化则更新

- 验证入口：
  - `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
  - `npx vitest run packages/agent-capability/tests/bash-capability.test.ts`
  - `npx vitest run tests/agent-kernel/config-assembly.test.ts`
  - `openspec validate refine-ts-sandbox-strict-shell-support --strict`
