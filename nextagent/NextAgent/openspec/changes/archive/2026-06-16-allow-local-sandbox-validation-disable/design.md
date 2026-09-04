## 背景和现状（Context）

当前 local product composition 通过 `DefaultSystemConfig.sandbox.builtinExecutables` 和 `clipcExecutableDirectoryEnv` 构造 `RestrictedLocalSandboxGateway`。该 adapter 在 `validateRequest()` 中统一校验环境变量、working directory、命令 allowlist 和路径参数。默认校验满足当前安全基线，但 local 诊断场景需要一个受信任操作者显式开启的宽松模式，用于验证不在首版 allowlist 内的函数或兼容本地调试命令。

现有 stable spec 已要求动态执行必须进入 `SandboxGatewayPort`，并且 app config 必须 startup validation 后冻结。本 change 增加 frozen local config 到 Bash tool policy 与 restricted local adapter 的一个布尔投影，不新增 public API、runtime command、持久化事实或 remote sandbox 语义。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 在 `sandbox` 配置组新增 `disable`，默认 `false`。
- `true` 同步关闭 Bash tool policy 和 local restricted sandbox 的 adapter 内部函数校验。
- 保持 sandbox gateway boundary、固定 cwd、sanitized env、timeout、cancellation、output limit。
- 通过 OpenSpec、配置测试和 sandbox adapter 测试覆盖默认、关闭和非法配置路径。

**非目标：**
- 不支持 request-time、tool-time 或模型输出控制该开关。
- 不改变 Bash/Python tool 的 public input schema；Bash 仍只接受 `command`、`description`、`timeout`。
- 不为 remote sandbox、deny-by-default adapter 或 PaaS sandbox 定义等价开关。
- 不新增持久化表、Web API 或 stream event。

## 设计决策（Decisions）

选定方案：在 `agent-app` app composition config 的 `sandbox` 组内新增 `disable?: boolean`，validated/frozen 后作为 `DefaultSystemConfig.sandbox.disable` 同时传入 `createRestrictedLocalSandboxGateway({ disable })` 和 Bash tool config。

当 `disable !== true` 时，Bash 维持现有 strict single-command、allowlist、参数和路径授权策略，`RestrictedLocalSandboxGateway` 维持现有 `validateRequest()` 行为。当值为 `true` 时，Bash 只做 deterministic tokenization，得到 executable 和 args 后提交 sandbox dependency；adapter `execute()` 不调用 `validateRequest()`，直接进入 `prepareExecution()` 和 `executeProcess()`。`prepareExecution()` 仍使用 adapter-owned executable resolution；`executeProcess()` 仍强制 `cwd=this.workspaceRoot`、`env=sanitizedEnvironment()`、`shell=false`、timeout、AbortSignal 和输出截断。

放弃的方案：
- 使用环境变量直接关闭校验：会绕过 app configuration freeze，不符合配置 ownership。
- 在 tool input 中传递 `disableSandboxValidation`：会把授权交给模型或请求输入，不符合安全边界。
- 新增第二个 gateway adapter：会复制执行逻辑并增加 bypass 面；单 adapter 内条件化校验更小且更容易测试。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 默认仍启用 Bash policy 和 adapter 校验；关闭只来自 frozen local config；关闭后 Bash 仍通过 sandbox dependency，adapter 仍保留 gateway boundary、sanitized env、fixed cwd 和 bounded output。 | `bash-capability.test.ts` 覆盖默认拒绝和关闭后提交 sandbox；`restricted-local-sandbox.test.ts` 覆盖 adapter 默认拒绝、关闭后执行、环境和 cwd 不从 request 生效；`config-assembly.test.ts` 覆盖非法配置失败。 |
| 性能/容量 | 新增布尔判断，无额外 I/O 或持久化；关闭校验减少路径检查开销但不改变 timeout/output limit。 | 单元测试覆盖 timeout/output limit 仍由现有路径执行；无需新增 benchmark。 |
| 可靠性/恢复 | 配置 restart-scoped，不引入 runtime mutable state；非法配置在 startup 阶段 fail closed。 | 配置验证测试和 `openspec validate --all --strict`。 |
| 可维护性 | 复用现有 `sandbox` 配置组和 restricted local adapter，不新增平行配置或 adapter。 | `npm run build`；code review 检查没有 request-time 配置读取。 |
| 可测试性 | 通过构造 Bash tool config、gateway options 和 raw config fixture 做 deterministic 测试。 | `npm test -- --run packages/agent-capability/tests/bash-capability.test.ts packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts tests/agent-kernel/config-assembly.test.ts`。 |
| 审计/可追溯性 | 不新增日志字段或 audit contract；执行结果仍沿用 `SandboxExecutionResult` 和现有 observability 消费路径。 | code review 检查不新增 raw command/output logging。 |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| `sandbox.disable` startup validated, default false, frozen | 1.1 | `tests/agent-kernel/config-assembly.test.ts` |
| local app composition passes frozen switch to Bash tool and restricted sandbox | 1.2 | `npm run build` + source review |
| 默认仍执行 Bash policy 与 adapter 命令/路径/request env/workingDirectory 校验 | 2.1 | `bash-capability.test.ts` and `restricted-local-sandbox.test.ts` negative cases |
| `true` 跳过 Bash policy 和 adapter function validation but keeps gateway execution controls | 2.2 | `bash-capability.test.ts` and `restricted-local-sandbox.test.ts` positive and boundary cases |
| OpenSpec 与 tasks 完整 | 3.1 | `openspec validate --all --strict` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/bash-tool/spec.md`、`openspec/specs/sandbox-deny-by-default-adapter/spec.md` 和 `openspec/specs/app-config-schema/spec.md`。
- 架构和跨模块设计：`openspec/designs/architecture/configuration-boundary.md`。
- 模块设计：`openspec/designs/modules/agent-app.md`、`openspec/designs/modules/agent-platform-gateway-local.md`。
- ADR：无。
- 导航：`openspec/designs/spec-to-design-map.md`。

## 风险与取舍（Risks / Trade-offs）

- [风险] local 操作者关闭校验后可运行更宽的本地命令。-> 默认开启；只允许 frozen local config 控制；保留 gateway boundary 和执行资源限制。
- [风险] 名称被误解为关闭 sandbox。-> 文档和字段语义限定为 `disable`，明确只是关闭函数校验，不是绕过 sandbox gateway。
- [取舍] 不对 remote 模式提供同类开关。-> remote sandbox 的授权边界不同，需独立 change 定义。

## 迁移计划（Migration Plan）

无数据迁移。未声明 `sandbox.disable` 的配置默认保持现有校验行为。需要宽松模式的 local 操作者在配置中显式设置 `sandbox.disable=true` 并重启进程；回滚时移除该字段或设置为 `false` 并重启。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/sandbox-deny-by-default-adapter/spec.md`：同步 local restricted sandbox 可配置关闭函数校验的行为契约。
- `openspec/specs/app-config-schema/spec.md`：同步 `sandbox.disable` 配置字段、默认值和非法值处理。
- `openspec/specs/bash-tool/spec.md`：同步 Bash tool 读取 frozen local config 并在 `true` 时跳过 tool-level policy 的行为契约。
- `openspec/designs/architecture/configuration-boundary.md`：提炼该字段属于 app composition startup config，且不是 request-time authorization input。
- `openspec/designs/modules/agent-app.md`：提炼 frozen config 到 sandbox gateway options 的投影。
- `openspec/designs/modules/agent-platform-gateway-local.md`：提炼 disable 对 restricted local adapter 的影响和保留边界。
- `openspec/designs/spec-to-design-map.md`：补充导航。

## 待确认问题（Open Questions）

无。
