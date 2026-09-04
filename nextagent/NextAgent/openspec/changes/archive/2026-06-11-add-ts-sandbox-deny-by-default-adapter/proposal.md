## 背景与问题（Why）

架构和核心契约已经冻结了 sandbox execution gateway boundary，并要求所有 shell、python、脚本和模型生成代码等动态执行都必须通过 `SandboxGatewayPort` 进入受控执行边界。

本地运行态可以使用 `agent-platform-gateway-local` 提供的 restricted local sandbox 作为默认 `SandboxGatewayPort` 实现；远端运行态可以使用 remote sandbox gateway。当这些可执行 sandbox adapter 被显式禁用、未配置、不可用或平台不受支持时，如果系统没有一个明确的安全兜底实现，就会出现两类风险：

- 动态执行调用点可能被实现者直接绕过 gateway boundary，落回宿主进程权限；
- 不同运行形态可能用临时异常、未定义返回或静默跳过来表示“不支持执行”，导致行为不一致、不可诊断、也不可验证。

本 change 的目标，是把“当前运行态没有可用 sandbox adapter 时的兜底行为”收敛成稳定规格：拒绝或显式不可用，但永远不允许绕过 sandbox gateway 边界。

## 变更范围（What Changes）

- 新增 `sandbox-deny-by-default-adapter` spec，冻结 deny-by-default / unavailable sandbox adapter 的触发机制、输入前置、输出契约和失败降级语义。
- 明确 deny-by-default adapter 只是安全兜底实现，不等同于 restricted local sandbox 或 remote sandbox 能力。
- 明确 `agent-app` 在 restricted local sandbox / remote sandbox 被禁用、未配置、不可用或平台不受支持时，如何装配该 adapter。
- 明确 deny-by-default adapter 只返回标准化 `SandboxExecutionResult` 或 safe error，不执行任何宿主级动态命令。

## 核心实现策略（Current Strategy To Freeze）

冻结以下黑盒策略：

- 动态执行请求一律先进入 `SandboxGatewayPort`；
- 在 restricted local sandbox / remote sandbox 不可用、未启用、未配置或平台不支持时，系统装配 deny-by-default / unavailable adapter；
- deny-by-default adapter 同步拒绝执行并返回标准化安全结果；
- deny-by-default adapter 的拒绝结果可以被后续 capability、policy、audit、logging 和 metrics 消费，但不产生任何宿主执行副作用。

## Impact

- 需要统一 sandbox 不可用兜底的安全默认值与错误解释。
- 需要补齐配置缺失、平台不支持、解释器未配置和远端 gateway 不可用时的标准行为。
- 需要为后续 `add-ts-security-test-gate`、risk policy 和真实 sandbox adapter 保留清晰的替换边界。

## 归档前基线提升计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-deny-by-default-adapter/spec.md`
