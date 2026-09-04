## 背景与问题（Why）

NextAgent 的电信网络诊断场景需要通过 `clipc` 调用已部署的业务 CLIP 服务。`clipc` 的使用方式与 `ls` 类似：模型提交一个严格解析的单命令，系统按固定参数策略授权后通过 sandbox gateway 执行。

当前实现存在两层断点：Bash policy 已接受 `clipc`，但 restricted local sandbox 仍拒绝该 executable；同时稳定 `bash-tool` 规格仍限定原有八个默认命令，没有定义 `clipc` 的权限、安全和执行边界。因此现有提交只能通过解析单测，无法完成真实执行，也不能作为合规实现交付。

## 变更范围（What Changes）

- 将 `clipc` 加入 Bash 默认受控命令集合，并限定模型可提交的命令形态为 `clipc <verb> <handler> [<api-path>]`。
- 首版只允许 `query` 和 `subscribe`，限制 handler、API path、参数数量和 shell 语法；禁止模型传入 executable 路径、endpoint、credential、环境变量或任意附加参数。
- restricted local sandbox 通过受信系统配置定位 `clipc` 二进制，并继续使用结构化 `spawn(executable, args)`、固定 workspace、超时、取消和输出限制。
- `clipc` 不从普通 `PATH` 猜测执行目标；缺失或无效的受信 executable 配置必须 fail closed。
- 不引入任意 executable 注册机制，不允许运行时配置扩展 Bash 命令权限，不新增 public gateway contract。
- 恢复系统 Skill 的稳定生产路径 `configRoot/skills`；测试 fixture 只能由测试专用配置定位。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `bash-tool`: 默认受控命令集合增加 `clipc`，并定义严格参数授权、网络业务命令例外及负向安全行为。
- `sandbox-runtime`: restricted local adapter 增加由受信 app composition 提供的 `clipc` executable 定位，并定义缺失配置时的 fail-closed 行为。

## 影响范围（Impact）

- 代码：`agent-capability` Bash policy、`agent-platform-gateway-local` restricted sandbox、`agent-app` 配置校验与 composition。
- 配置：默认系统配置新增受控 `clipc` executable locator，只允许从指定环境变量目录解析同名二进制。
- 安全：`clipc` 是 Bash 网络 CLI 禁止规则的显式业务例外；模型仍不能控制路径、环境、凭据或 endpoint。
- 测试：增加 policy、gateway 和 app composition 集成测试，覆盖成功执行、配置缺失、非法参数、未知命令和路径逃逸。
- API/contract：不修改 `SandboxExecutionRequest`、Capability public contract 或 Web API。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/bash-tool/spec.md`：更新默认命令集合、`clipc` 参数策略和网络 CLI 受控例外。
- `openspec/specs/sandbox-runtime/spec.md`：补充受信 executable 定位和 fail-closed 行为。

长期背景：
- `openspec/overview.md`：补充受控业务 CLI 可通过既有 sandbox gateway 执行的稳定能力摘要。

设计视图：
- `openspec/designs/architecture/runtime-boundaries.md`：补充模型命令授权与 gateway executable 定位的两层职责。
- `openspec/designs/modules/agent-capability.md`：补充 `clipc` 参数策略归 Bash owner。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充受信 `clipc` locator 和 fail-closed 处理。
- `openspec/designs/modules/agent-app.md`：补充 composition 注入受信 executable 配置。
- `openspec/designs/adr/<id>.md`：无。
- `openspec/designs/spec-to-design-map.md`：更新 `bash-tool` 与 `sandbox-runtime` 的验证入口。

验证入口：
- Bash policy unit tests。
- restricted local sandbox focused tests。
- app composition integration tests。
- `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。
