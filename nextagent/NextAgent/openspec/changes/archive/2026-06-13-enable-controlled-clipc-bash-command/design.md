## 背景和现状（Context）

`agent-capability` 已把 `clipc` 加入 Bash policy，但 stable `bash-tool` 规格没有该行为，`agent-platform-gateway-local` 也仍拒绝 `clipc`。当前工作区尝试增加通用 `additionalExecutables` 注册表并把 system Skill 根切到测试 fixture；前者扩大了 sandbox 安全配置面，后者让生产路径依赖测试目录，均超出解决 `clipc` 断点所需范围。

本变更涉及 Bash 参数授权、app 受信配置和 gateway executable 定位三层。模型输入只到达 Bash policy；二进制目录只来自系统配置指定的环境变量；最终执行仍只发生在 gateway-local。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 让 `clipc query ...` 和 `clipc subscribe ...` 通过 Bash Tool 的严格单命令路径真实执行。
- 让现有 CLIP provider runner 的 `list`、`describe`、`execute` 继续复用同一 sandbox gateway executable。
- 保持模型参数授权与宿主 executable 定位分层，缺失配置时 fail closed。
- 保持 `configRoot/skills` 为生产 system Skill 根。

**非目标：**

- 不提供任意 executable 注册、任意环境变量透传或通用网络 CLI。
- 不新增 `SandboxExecutionRequest` 字段或 executable enum。
- 不改变 CLIP provider 的模型可见普通 Tool 映射。
- 不执行 Skill 内任意 shell 脚本。

## 设计决策（Decisions）

### D1：`clipc` 是 Bash 默认集合中的显式业务命令

`agent-capability` 继续拥有模型输入解析和参数授权。`query` 使用固定 handler/ref 形态；`subscribe` 只开放固定顺序且数值有界的 timeout、event count 和输出格式参数。两者只开放 `query`、`subscribe`，不会暴露 provider-private 的 `list`、`describe`、`execute` 给模型。

放弃把 `clipc` 仅作为通用任意 executable 配置项，因为那会让系统配置绕过 Bash stable default set，并扩大安全审查面。

### D2：app config 只声明 `clipc` directory env 名称

系统配置使用单一字段 `sandbox.clipcExecutableDirectoryEnv`。`agent-app` 从该受信环境变量读取目录，并以 `clipcExecutableDirectory` 传给 restricted local sandbox。模型、Capability 参数和 channel metadata 均不能覆盖该值。

默认值为 `CLIP_HOME`。gateway locator 会兼容 Windows 环境配置中常见的一层外部双引号，但不会执行变量展开或 PATH fallback。环境变量缺失时 app 仍可启动，但 `clipc` 执行返回 unavailable；这样不会让与 CLIP 无关的能力因可选业务依赖缺失而整体阻塞。

### D3：gateway 只增加专用 `clipc` locator

`RestrictedLocalSandboxOptions` 增加可选 `clipcExecutableDirectory`，不增加字典型 executable registry。gateway 对 `clipc` 构造 `${directory}/clipc[.exe]`，要求目标存在且为普通文件，再以 `shell: false` 执行。

gateway 不搜索任意 `PATH`，不把 `CLIP_HOME` 或其它新增环境变量传给子进程。现有环境清理、workspace cwd、timeout、AbortSignal 和输出限制保持不变。

### D4：同一 gateway 服务两条受信路径

Bash Tool 路径提交 policy 已授权的 `query`/`subscribe` 参数。CLIP provider runner 由 app composition 直接构造受控 `list`/`describe`/`execute` 参数。两条路径共享 `command="clipc"` 和同一个专用 locator，但不共享模型参数授权面。

### D5：测试 fixture 不进入生产 Skill 根

`createRuntimePaths()` 保持 `configRoot/skills`。`tests/e2e/fixtures/skills` 只能由测试显式定位，不修改生产默认路径。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 模型只能控制固定 verb/handler/path；executable 目录来自受信 app config；未知 executable 与 locator 缺失均 fail closed | Bash negative tests、gateway negative tests、语义审查 |
| 性能/容量 | 每次执行只增加一次同步路径校验；进程容量、超时和输出上限沿用现有 sandbox 边界 | focused gateway tests、现有 timeout/truncation tests |
| 可靠性/恢复 | 配置缺失产生稳定 unavailable，不回退到 PATH 或宿主 shell；取消语义不变 | missing locator、AbortSignal tests |
| 可维护性 | 使用专用字段而非通用 registry，避免平行 command policy；职责分为 policy、composition、execution 三层 | architecture lint、code review |
| 可测试性 | gateway option 可注入临时目录中的测试 executable；无需依赖真实 CLIP 安装 | unit/integration tests |
| 审计/可追溯性 | 继续使用已有 tool-use message 和 sandbox safe result；不新增 raw path、command 或输出日志 | 现有 observability contract tests、review checkpoint |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| Bash 只接受受控 `clipc` 形态 | 2.1 | `bash-capability.test.ts` |
| gateway 使用专用 locator 且未知命令 fail closed | 2.2 | `restricted-local-sandbox.test.ts` |
| app 从受信 env 解析目录并注入 gateway | 2.3 | config/app composition tests |
| 生产 Skill 根保持 `configRoot/skills` | 2.4 | local Skill source config tests |
| policy 到 gateway 可真实执行 | 3.1 | focused integration test |
| 不新增 public contract 或架构逃逸 | 3.2 | contract tests、`npm run lint:architecture` |
| OpenSpec 与实现一致 | 1.1-4.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/bash-tool/spec.md`、`openspec/specs/sandbox-runtime/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/runtime-boundaries.md`。
- 模块设计：`openspec/designs/modules/agent-capability.md`、`agent-platform-gateway-local.md`、`agent-app.md`。
- ADR：无；该决策是现有边界内的局部扩展。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] restricted local adapter 不提供真实网络隔离，`clipc` 能访问其业务 endpoint。 -> 仅开放固定业务命令形态，endpoint 不由模型提供；真实隔离继续由可替换 sandbox adapter 承担。
- [风险] `CLIP_HOME` 配置错误导致执行不可用。 -> 返回稳定 unavailable，禁止 PATH fallback，并用启动配置和 focused test 提供诊断证据。
- [取舍] 专用 `clipc` option 比通用 executable registry 扩展性低。 -> 当前只需要一个已规格化业务命令，较小安全面优先。

## 迁移计划（Migration Plan）

部署环境在启动 NextAgent 前设置 `CLIP_HOME` 指向包含 `clipc` 或 `clipc.exe` 的目录。未设置时其它能力保持可用，`clipc` 调用 fail closed。回滚时移除本 change 的代码和配置字段即可，不涉及持久化迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/bash-tool/spec.md`：合并默认命令、参数策略和网络业务例外。
- `openspec/specs/sandbox-runtime/spec.md`：合并专用受信 executable locator 行为。
- `openspec/overview.md`：记录受控业务 CLI 的稳定能力。
- `openspec/designs/architecture/runtime-boundaries.md`：记录 policy 与 executable locator 的职责分层。
- `openspec/designs/modules/agent-capability.md`：记录 `clipc` 参数授权 owner。
- `openspec/designs/modules/agent-platform-gateway-local.md`：记录专用 locator 与 fail-closed 行为。
- `openspec/designs/modules/agent-app.md`：记录受信 env 到 gateway option 的 composition。
- `openspec/designs/spec-to-design-map.md`：更新验证导航。

## 待确认问题（Open Questions）

无。
