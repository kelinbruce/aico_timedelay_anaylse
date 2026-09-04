## 背景与问题（Why）

local 模式需要支持受信任开发和本地诊断场景中临时放宽 sandbox 函数校验。现有 restricted local sandbox 始终执行命令 allowlist、路径边界、环境变量和工作目录校验；这对默认安全姿态是正确的，但会阻断部分由本地操作者明确授权的函数调用验证、驱动调试或工具兼容性验证。

该能力必须保持电信级安全边界的默认行为：动态执行仍必须进入 sandbox gateway boundary，不得因为 local 模式或配置开关直接绕过 `SandboxGatewayPort` 使用宿主执行 API。关闭的范围只限 restricted local adapter 内部的函数校验策略，不改变 runtime、capability 或 web/API 边界。

## 变更范围（What Changes）

- 在 app composition 的 `sandbox` 配置组中新增 local-only `disable` 布尔配置。
- `disable` 缺省为 `false`，保持现有 restricted local sandbox 校验行为。
- 当 `deployment.mode=LOCAL` 且 `sandbox.disable=true` 时，restricted local sandbox SHALL 跳过 adapter 内部的命令 allowlist、路径参数、环境变量和工作目录校验。
- 当 `deployment.mode=LOCAL` 且 `sandbox.disable=true` 时，builtin `bash` tool SHALL 同步跳过 tool-level 命令 allowlist、命令专用参数和路径授权策略，但仍解析为 executable + args 并通过 sandbox dependency 提交。
- 即使关闭函数校验，动态执行仍 SHALL 通过 `SandboxGatewayPort.execute()`，并继续使用固定 workspace cwd、清洗后的环境、timeout、cancellation 和 stdout/stderr byte limit。
- 配置 schema SHALL 拒绝非布尔值或未知 sandbox 配置字段，避免静默启用宽松模式。
- BREAKING：无。默认配置和未声明该字段的用户配置保持原行为。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `sandbox-deny-by-default-adapter`: 增加 local restricted sandbox 在显式配置关闭函数校验时的可验证行为，以及默认仍启用校验的 fail-closed 行为。
- `app-config-schema`: 增加 app composition `sandbox.disable` 配置字段的 startup validation 和 frozen config 行为。
- `bash-tool`: 增加 local trusted config 关闭函数校验时，Bash tool policy 同步放宽的行为契约。

## 影响范围（Impact）

- 代码：`agent-app` 配置 schema、frozen config shape、default config、local app composition 到 sandbox gateway 和 Bash tool config 的投影；`agent-capability` Bash policy；`agent-platform-gateway-local` restricted local sandbox adapter。
- 配置：`packages/agent-app/config/default-system.yaml` 默认声明 `sandbox.disable=false`。
- 测试：补充配置验证、默认行为、显式关闭行为和关闭后仍通过 sandbox gateway 的 adapter 测试。
- 运维：local 模式操作者可在重启后通过配置显式关闭函数校验；该配置不是热更新，不影响 remote 或 unavailable/deny-by-default adapter。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/sandbox-deny-by-default-adapter/spec.md`：新增 local restricted sandbox 可配置关闭函数校验的行为契约。
- `openspec/specs/app-config-schema/spec.md`：新增 `sandbox.disable` 配置字段、默认值和 startup validation 行为。
- `openspec/specs/bash-tool/spec.md`：新增 `sandbox.disable=true` 时 Bash tool 同步放宽 tool-level policy 的行为契约。

长期背景：
- `openspec/overview.md`：无。

设计视图：
- `openspec/designs/architecture/configuration-boundary.md`：补充 `sandbox.disable` 属于 app composition startup config 的 local-only 投影。
- `openspec/designs/modules/agent-app.md`：补充 frozen config 到 sandbox gateway 的配置投影。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 restricted local sandbox 的校验开关语义和保留的执行边界。
- `openspec/designs/adr/<id>.md`：无，不新增长期 ADR。
- `openspec/designs/spec-to-design-map.md`：补充上述 spec 到 configuration/sandbox module design 的导航。

验证入口：
- `openspec validate --all --strict`
- `npm test -- --run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts tests/agent-kernel/config-assembly.test.ts`
- `npm run build`
