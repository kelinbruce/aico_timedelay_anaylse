## 背景和现状（Context）

当前 stable spec 与代码都把 `sandbox.enabled=true` 解释为 Bash 的 strict direct-executable validation 模式：`cd`、`&&`、`||`、`|` 等依赖 shell 解释的 token 在该模式下会因为 `unsupported-executable` 被拒绝，只有 `sandbox.enabled=false` 才会进入 trusted shell mode。这个行为已经通过当前仓内测试验证。

这与新黑盒诉求冲突。我们现在要支持的是：

- 在 `sandbox.enabled=true` 下，Bash 对模型暴露的能力应当是“只要命令未命中 trusted denylist，就允许进入 sandbox 执行”；
- 在 `sandbox.enabled=false` 下，跳过 deny 校验，但仍保持 gateway-owned 执行边界；
- 不能再把 shell built-in / chaining 与 direct executable 的差别暴露成 capability 级失败。约束条件如下：

- 仍然必须经过 `SandboxExecutionPort` / `SandboxGatewayPort` 边界；
- Bash capability 仍然不能直接执行 host shell；
- denylist 必须继续是 trusted app composition input；
- `cwd`、sanitized env、timeout、cancellation、output limits 等 adapter-owned 安全边界不能放松；
- 需要把当前 `agent-app` / `agent-capability` / `agent-platform-gateway-local` 三处对 `sandbox.enabled` 的既有语义统一收敛。

当前 implementation-vs-spec gap 在于：现实现与 stable spec 一致，都会在 `enabled=true` 时拒绝 `cd`。因此本 change 不是“代码修正文档偏差”，而是“显式修改 stable behavior baseline”。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 把 `sandbox.enabled=true` 下的 Bash 命令级预拒绝原则收敛为：仅 denylist 可以阻止命令进入 sandbox。
- 允许 non-denied shell built-in / chaining 在 `enabled=true` 下执行。
- 明确 `sandbox.enabled=false` 下跳过 deny 校验，但仍保留 gateway-owned 执行边界和 fail-closed 执行控制。
- 保持 direct executable 与 shell composition 共用同一 sandbox boundary、同一 safe error mapping、同一 execution controls。
- 明确 Bash capability、sandbox gateway、app composition 的唯一职责分界，避免平行 policy。

**非目标：**

- 不为 remote sandbox 定义新的 shell mode。
- 不改变 malformed quote 的 capability 级拒绝语义。
- 不引入新的 public tool input shape、配置开关或多套 deny policy。
- 不把路径约束、文件类型校验、env governance 回退到 Bash capability 层。

## 设计决策（Decisions）

### 1. `enabled=true` 以 denylist 作为唯一命令级预拒绝来源

唯一选定路径是：restricted local sandbox gateway 在 `sandbox.enabled=true` 的 `bash` 请求上先应用 trusted denylist；若命中 denylist，立即安全拒绝；若未命中 denylist，则继续执行路径选择。我们不再保留 “strict 模式额外拒绝 shell built-in / chaining” 的第二套命令分类逻辑。

放弃的备选方案：

- 备选 A：保留 `enabled=true` direct-only，新增另一个开关控制 shell support。
  - 放弃原因：把一个黑盒能力拆成两套配置语义，增加运维和模型心智负担，不符合 KISS。
- 备选 B：让 Bash capability 在前置解析阶段维护 shell token allowlist。
  - 放弃原因：会重建 capability-owned policy，与 “gateway owns policy” 边界冲突。

### 2. gateway 按 token sequence 选择 direct execution 或 trusted shell execution

唯一选定路径是：Bash capability 仅负责 deterministic tokenization。gateway 接收 trusted token sequence 后：

- 若命令不需要 shell 解释，继续走现有 `shell: false` direct execution；
- 若命令需要 shell built-in / chaining，走 trusted shell interpreter 执行路径；
- 两条路径都保留在同一 sandbox gateway boundary 内，并使用同一 `cwd`、sanitized env、timeout、cancellation、output limits。

这里的关键不是“永远走 shell”，而是“由 gateway 在 sandbox 内部根据 token sequence 选择唯一路径”。这样能保留 direct executable 的简单路径，同时满足新的黑盒诉求。

### 3. `sandbox.enabled` 收敛为 validation mode，而不是 shell-support mode

唯一选定路径是重新定义 `sandbox.enabled`：

- `true`：启用 trusted validation mode，包含 denylist 检查，但不再禁止 shell built-in / chaining；
- `false`：跳过 denylist 检查，并允许 trusted local shell/direct execution 继续通过 gateway 执行。

也就是说，`enabled=false` 不再是“唯一允许 shell mode 的开关”，但它仍然是“是否跳过 deny 校验”的开关。shell support 在 `enabled=true` 与 `enabled=false` 下都存在，差别在于 trusted validation 是否启用。

### 4. safe error mapping 只保留真实 fail-closed 含义

当前 `unsupported-executable -> COMMAND_NOT_ALLOWED` 的路径覆盖了 `cd` 这类 strict-mode shell built-in 拒绝。变更后，这条 reason 不再用于 “命令需要 shell 解释” 这一正常情况，只保留给真正的 fail-closed 场景，例如：

- deny 之外但 direct executable 和 required shell interpreter 都无法解析；
- trusted shell interpreter 缺失；
- 平台不支持所需执行路径。

这样模型看到的 `COMMAND_NOT_ALLOWED` 更接近真正的 policy / availability 失败，而不是内部实现分流暴露。

### 5. 文档与实现的唯一 owner

- 行为契约 owner：`sandbox-runtime` spec、`bash-tool` spec
- app composition wiring owner：`agent-app`
- tokenization / malformed quote owner：`agent-capability`
- execution-path selection / deny policy owner：`agent-platform-gateway-local`

我们不新增新的 capability、port、DTO 或 config schema。唯一实施路径是在现有三个模块上收敛语义。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | `enabled=true` 下 denylist 继续是命令级关闭机制；`enabled=false` 下显式跳过 deny，但 shell support 仍由 sandbox gateway boundary、adapter-owned cwd、sanitized env、timeout、output limits 和 fail-closed shell resolution 控制；Bash capability 不获得直接 host execute 权限。 | `restricted-local-sandbox.test.ts` deny + shell cases；`bash-capability.test.ts`；架构审查 `Bash MUST NOT execute directly` |
| 性能/容量 | direct executable 路径保持不变；仅在需要 shell 解释时增加 trusted shell reconstruction。没有新增持久化、网络 hop 或新缓存。 | gateway unit tests；必要时 command-path characterization |
| 可靠性/恢复 | shell composition 支持面扩大，但 direct 与 shell 两条路径仍复用同一 timeout、cancellation、bounded output 和 safe failure mapping；shell interpreter 缺失时 fail closed。 | gateway tests covering `enabled=true` / `enabled=false` / missing shell |
| 可维护性 | 把语义收敛成明确的双模式：`enabled=true` deny-governed，`enabled=false` skip-deny trusted local mode；去掉 “enabled=true direct-only / enabled=false shell-mode” 的旧双语义。 | OpenSpec review；代码审查 restricted-local-sandbox path split |
| 可测试性 | 新语义可通过黑盒测试直接验证：non-denied `cd && cat` 在 `enabled=true` 成功，deny 命令失败，malformed quote 仍在 capability 层失败。 | `restricted-local-sandbox.test.ts`、`bash-capability.test.ts`、`config-assembly.test.ts` |
| 审计/可追溯性 | 不新增 raw command/raw output 暴露面；现有 safe diagnostics、tool-use persistence、safe error mapping 继续适用。 | 现有 observability/result redaction tests + shell support regression cases |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `enabled=true` 下 non-denied shell built-in / chaining 可以进入 sandbox 执行 | 1.1, 2.1 | `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` |
| `enabled=true` 下 denylist 是唯一命令级预拒绝来源，`enabled=false` 下跳过 deny | 1.2, 2.2 | `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts` |
| Bash capability 不再因 shell composition 直接拒绝，但 malformed quote 仍拒绝 | 1.3, 2.3 | `npx vitest run packages/agent-capability/tests/bash-capability.test.ts` |
| `unsupported-executable` 不再承载 strict-mode shell built-in 拒绝语义 | 1.4, 2.4 | `npx vitest run tests/agent-kernel/config-assembly.test.ts` |
| Bash 仍只能经 sandbox dependency 执行，不得直接 host execute | 2.3 | `npm run lint:architecture` + code review |
| OpenSpec delta 结构正确 | 3.1 | `openspec validate refine-ts-sandbox-strict-shell-support --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：
  - `openspec/specs/sandbox-runtime/spec.md`：`sandbox.enabled` 下的 validation / shell support / deny ownership 行为
  - `openspec/specs/bash-tool/spec.md`：Bash deterministic tokenization、gateway-owned policy、shell composition forwarding 行为
- 架构和跨模块设计：无新增长期 architecture 主题
- 模块设计：
  - `openspec/designs/modules/agent-app.md`：`sandbox.enabled` wiring 与 safe error mapping 语义
  - `openspec/designs/modules/agent-capability.md`：Bash capability 的 tokenization / malformed quote / gateway-owned policy 边界
- ADR：无
- 导航：
  - `openspec/designs/spec-to-design-map.md`：如基线 spec 与 module design 导航条目变化，则更新

## 风险与取舍（Risks / Trade-offs）

- [风险] shell composition 在 `enabled=true` 下放开后，命令执行面扩大。 -> 缓解方式：denylist 成为 `enabled=true` 的命令级治理入口，并补足 deny negative tests 与 shell interpreter fail-closed tests。
- [风险] `enabled=false` 跳过 deny 后，trusted local 调试模式的误用风险扩大。 -> 缓解方式：在 spec/design 中显式标注 trusted local mode 边界，并保持 gateway-owned 执行控制不变。
- [风险] 现有测试和文档默认把 `enabled=true` 当成 direct-only。 -> 缓解方式：先改 OpenSpec，再同步 characterization tests，最后改实现。
- [风险] direct executable 与 shell execution 双路径可能导致 safe error 行为不一致。 -> 缓解方式：统一 gateway-owned result mapping，只在真正解析失败/adapter 缺失时暴露 unavailable path。

## 迁移计划（Migration Plan）

无数据迁移。

发布与回滚注意事项：

- 发布前必须同步更新 `sandbox.enabled` / denylist 相关运维认知，避免仍按 “strict 模式天然拒绝 `cd`” 或 “disabled 仍校验 deny” 理解安全边界；
- 若上线后发现 denylist 不完整，可通过补充 trusted denylist 快速收敛风险；
- 如需回滚，只需回滚本 change 对 gateway / Bash tests / spec 的修改，不涉及持久化格式变更。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：提炼 `enabled=true` 下 deny-owned shell support、execution-path selection、fail-closed shell resolution
- `openspec/specs/bash-tool/spec.md`：提炼 deterministic tokenization + gateway-owned shell composition forwarding 语义
- `openspec/designs/modules/agent-app.md`：提炼 `sandbox.enabled` wiring 与 safe error mapping 新语义
- `openspec/designs/modules/agent-capability.md`：提炼 Bash capability 不拥有 shell composition policy 的稳定边界
- `openspec/designs/spec-to-design-map.md`：如导航变化则更新验证入口
- `openspec/overview.md`：无
- `openspec/designs/architecture/<topic>.md`：无
- `openspec/designs/adr/<id>.md`：无

## 待确认问题（Open Questions）

无。
