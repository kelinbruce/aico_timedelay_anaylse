## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-6.3 沙箱执行命令` | 允许可信启动配置以可选白名单收窄本地 executable 授权，保留黑名单拒绝优先级，并将白名单模式限制为 direct execution | `sandbox-runtime` | `FN-6.3 沙箱执行命令` |

## `FN-6.3 沙箱执行命令`

### 目标与规范依据

本设计实现 proposal 定义的最小授权结果：未配置白名单时保持现有 denylist 与 shell composition 行为；配置白名单后只允许白名单成员的 direct execution，denylist 冲突或需要 shell interpretation 时拒绝。

#### 本 Function 的目标 Requirements

canonical spec：`sandbox-runtime`

- `MODIFIED`：`Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`

### 当前实现

- `agent-app` 的 source config、runtime config 与 composition contract 只携带 `deniedExecutables`，缺失时归一化为空数组。
- `agent-contracts/gateway` 的 `GatewayProviderSandboxConfig` 只暴露 required `deniedExecutables`。
- `agent-platform-gateway-local` 已将 allowlist/denylist 构造成可选 `ReadonlySet<string>`；`sandbox.enabled=true` 时按 `request.command` 精确授权，`false` 时跳过校验。
- `agent-capability` 将 sandbox policy 投影到 Bash config schema，但 Bash 本身不执行 executable 授权。
- adapter 已在检测到 `&&`、`||`、`|`、`&`、`;`、`(`、`)` 等控制 token 时选择 trusted shell，但 allowlist presence 尚未限制该路径；未触发 shell path 的 `>` 等文本按普通 argv direct execution。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 白名单模式只允许 direct execution | allowlist 成员仍可携带 shell control token 进入 trusted shell | 需要在唯一 gateway policy owner 中拒绝 shell interpretation，并保证不启动 shell/子命令 |
| 不依赖危险字符穷举 | `>` 等未触发 shell 的文本已按普通 argv 传递 | 需要负例确认该文本没有重定向或 expansion 副作用 |
| 缺失白名单与 disabled 行为不变 | 既有 shell composition 路径仍需保留 | direct-only guard 必须只在 allowlist 存在且 validation enabled 时生效 |

### 修改方案

采用一条从可信配置到 local adapter 的可选字段投影路径：

1. `RawSystemConfig.sandbox.allowedExecutables` 与校验 schema 接受 optional、unique、non-empty string array；`SandboxConfig.allowedExecutables` 保持 optional，禁止用 `?? []` 归一化，从而保留字段缺失与显式空数组的语义差异。
2. `SandboxGatewayFactoryInput`、`GatewayProviderSandboxConfig`、`CapabilitySandboxToolPolicy` 与 Bash config metadata 采用同名 optional readonly array。app composition 只在值存在时投影该字段；Bash config 仅描述配置，不成为授权 owner。
3. `RestrictedLocalSandboxOptions.allowedExecutables` 为 optional readonly string array。adapter 内部将缺失保存为 `undefined`，存在时保存为 `ReadonlySet<string>`；该状态只来源于 trusted startup/app composition，不持久化，也不接受请求覆盖。
4. `validateRequest` 保留 `enabled=false` 的立即返回；启用时按以下唯一决策表执行。名单拒绝继续复用 `denied-executable`，白名单 direct-only 拒绝使用唯一原因 `shell-composition-not-allowed`，并在 capability boundary 映射为既有 `COMMAND_NOT_ALLOWED`。
5. 仓库内置 `packages/agent-app/config/default-system.yaml` 显式配置 `enabled: false` 与 `allowedExecutables: [curl, clipc]`。默认启动配置因此保留批准名单但按既有 disabled 语义跳过 executable policy 校验；需要启用白名单 direct-only 的部署必须显式改为 `enabled: true`。自定义部署仍可通过省略 `allowedExecutables` 保留 denylist-only 语义。

| `enabled` | allowlist 状态 | denylist 命中 | allowlist 命中 | 需要 shell interpretation | 结果 |
|---|---|---|---|---|---|
| `false` | 任意 | 任意 | 任意 | 任意 | 跳过 policy 校验 |
| `true` | 缺失 | `true` | 不适用 | 任意 | `denied-executable` 拒绝 |
| `true` | 缺失 | `false` | 不适用 | `true` | 保留 trusted shell 路径 |
| `true` | 缺失 | `false` | 不适用 | `false` | direct execution |
| `true` | 存在 | `true` | 任意 | 任意 | `denied-executable` 拒绝 |
| `true` | 存在 | `false` | `false` | 任意 | `denied-executable` 拒绝 |
| `true` | 存在 | `false` | `true` | `true` | `shell-composition-not-allowed` 拒绝 |
| `true` | 存在 | `false` | `true` | `false` | direct execution |

不引入 policy mode enum、操作符配置、通配符、规范化 helper 或新的 policy service。direct-only 以“是否会调用 shell interpreter”为结构化边界，不通过穷举所有 shell-like 字符决定安全性：需要 shell path 时拒绝；不需要时保持 `shell: false`，因此 `>` 等文本只是 argv。trusted executable resolution、cwd/env/timeout/cancellation/output controls 均保持不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由功能性 Requirement 的拒绝语义派生 | 保留配置 presence，denylist 优先，白名单模式禁止 shell path，policy 只来自 trusted composition | 空白名单、名单冲突、未授权 executable、shell/子命令未启动、普通 argv 无重定向副作用 |
| 可维护性 | 无新增黑盒质量目标；由功能性 Requirement 的一致配置语义派生 | 与 `deniedExecutables` 使用同名字段和同一投影路径，不新增平行 owner | contract、composition 与 adapter 字段一致 |
| 可测试性 | 无新增黑盒质量目标；由功能性 Requirement 的场景派生 | 决策表每一有效分支具有可重复测试入口 | 缺失/空/命中/冲突/disabled 分支 |

## 验证策略（Verification Strategy）

- unit/adapter tests 断言未配置白名单时的兼容行为、白名单命中、未命中、显式空数组、黑名单冲突优先、白名单 shell composition 拒绝、普通 argv 不被解释和 disabled 跳过。
- configuration/contract tests 断言字段缺失保持 `undefined`、显式空数组被保留、非法元素或重复项被拒绝，验证 composition 投影，并验证仓库默认配置为 `enabled: false` 且保留 `curl` 与 `clipc` 名单。
- build 与 architecture gate 验证跨 package public export 和 owner 边界未被破坏。
- OpenSpec strict validation 验证 Requirement delta、Function 映射和 artifact 完整性。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：归档时合并 executable allow/deny policy 目标态。
- `openspec/designs/functions/D6-安全与治理/D6.2-执行与风险治理/FN-6.3-沙箱执行命令.md`：刷新描述、处理过程、结果和 executable policy 规格。
- `openspec/designs/features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md`：刷新可选白名单用户价值摘要。
- `openspec/overview.md`：刷新 sandbox executable policy 概览。
- `openspec/designs/architecture/configuration-boundary.md`：补充 `allowedExecutables` presence 语义和名单优先级。
- `openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-capability.md`、`openspec/designs/modules/agent-platform-gateway-local.md`：同步配置投影、非授权 owner 和 adapter policy。
- ADR：无。
- `openspec/designs/spec-to-design-map.md`：刷新 sandbox-runtime 设计摘要，不改变映射关系。

## 风险与取舍（Risks / Trade-offs）

- executable 名称继续采用现有精确、区分大小写的字符串匹配；在大小写不敏感平台上，配置大小写不一致可能无法命中。通过文档说明和配置测试缓解，本 change 不扩大到平台规范化策略。
- 显式空数组会拒绝全部 executable，可能因误配置导致工具不可用；该行为是 fail-closed 的安全选择，可通过删除字段回退到仅黑名单模式。
- allowlist presence 会使依赖 shell builtin、pipeline、chaining 的命令不可用；这是最小授权的主动取舍，运维需要改用单一受控 executable 或专用 wrapper。

## 迁移与回滚（Migration / Rollback）

- 现有部署不增加 `allowedExecutables` 即保持原行为，无需数据迁移。
- 启用白名单前，运维人员必须列出当前 Agent 需要的全部 executable 并在受控环境验证。
- 若白名单遗漏导致业务命令被拒绝，回滚方式是移除 `allowedExecutables` 字段并重启，使系统恢复仅黑名单策略；回滚后通过既有 sandbox adapter 验证确认所需命令恢复。

## 待确认问题（Open Questions）

无。
