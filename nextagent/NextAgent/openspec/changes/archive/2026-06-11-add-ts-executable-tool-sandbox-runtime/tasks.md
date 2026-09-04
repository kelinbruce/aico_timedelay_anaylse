## 1. 复用冻结 sandbox gateway 契约

- [x] 1.0 明确本 change 是当前 active changes 中 NextAgent 侧沙箱执行接入职责归口，覆盖 executable capability routing、`SandboxExecutionRequest` 构造、统一 `SandboxGatewayPort` submission、结果映射和 observability；local / remote sandbox 具体 adapter 分别归对应 gateway package，真实 sandbox 平台实现不在本 change 范围内
  来源：proposal 职责归属；design 黑盒目标；spec requirement "Executable Sandbox Runtime Owns Sandbox Execution Integration"
- [x] 1.1 确认 `SandboxGatewayPort`、`SandboxExecutionRequest`、`SandboxExecutionResult` 已位于 `agent-contracts/gateway`（core-contracts.md 已有定义），不得新建竞争词汇
  来源：design D1
- [x] 1.2 明确 `agent-platform-gateway-local` 的 restricted local sandbox 是 local 运行态默认 `SandboxGatewayPort` 实现，`agent-platform-gateway-remote` 的 sandbox adapter 是 remote 实现；本地隔离机制和远端协议细节停留在各自 adapter 私有实现内，不承担 deny-by-default adapter selection
  来源：design D2

## 2. SandboxGatewayPort 接入边界

- [x] 2.1 在 `agent-app` / capability composition 中接入当前已装配的 `SandboxGatewayPort`，让 executable builtin tool invocation 只通过该 port 提交；不得在本 change 中新增第二套 execution port 或直接调用宿主 child process
  来源：design D2
- [x] 2.2 确认 local / remote / deny-by-default adapter 只作为 `SandboxGatewayPort` 的可替换实现被消费；本 change 不完整实现真实 local / remote sandbox 平台，也不定义其私有协议、隔离机制或 endpoint 配置
  来源：design D2
- [x] 2.3 将现有 tool-facing sandbox dependency 收敛到 `SandboxGatewayPort.execute()` 适配路径；若保留短期内部 wrapper，其职责只能是构造 `SandboxExecutionRequest` 和映射 `SandboxExecutionResult`，不得长期形成竞争 port
  来源：design D2
- [x] 2.4 实现受控 timeout / cancellation 传递到当前 `SandboxGatewayPort.execute()`，不无界等待 sandbox adapter
  来源：design 质量属性设计
- [x] 2.5 错误响应使用 `SafeError` 或 SafeError-compatible capability failure；不得新建 `SandboxError` 或新的 sandbox result vocabulary
  来源：design D4

## 3. CapabilityInvocation 集成

- [x] 3.1 在 capability invocation 前，根据 capability 种类判断是否需要 sandbox 执行（shell、python、bash、脚本、模型生成代码等 executable capability 必须通过 sandbox gateway）
  来源：design D3
- [x] 3.2 如果需要 sandbox，统一调用当前装配的 `SandboxGatewayPort.execute()`（传入 `SandboxExecutionRequest`），由 adapter result 表达真实执行、deny 或 unavailable
  来源：design D3
- [x] 3.3 如果当前装配的 `SandboxGatewayPort` 返回 deny/unavailable `SandboxExecutionResult`，将该结果映射为 SafeError-compatible `CapabilityInvocationResult`（例如 `SANDBOX_UNAVAILABLE`），不得在 capability 侧绕过 gateway 自行执行或另造不可用分支
  来源：spec requirement scenario "Sandbox unavailable does not fall back to host execution"；design D4、D5；`add-ts-sandbox-deny-by-default-adapter`
- [x] 3.4 将 `SandboxExecutionResult` 映射为 `CapabilityInvocationResult`
  来源：spec requirement scenario "Sandboxed invocation is mapped back into capability result"；design D4
- [x] 3.5 确保 shell、python、hook、bash、脚本和模型生成代码等 executable capability 必须通过 sandbox gateway 执行
  来源：spec requirement scenario "Executable capability uses sandbox gateway"；design D3
- [x] 3.6 确保 Skill discovery 和内容加载阶段只登记安全 executable resource refs，不执行本地命令且不暴露 raw host path
  来源：spec requirement scenario "Skill discovery registers refs without local execution"；design D5
- [x] 3.7 执行前校验可见性、参数、risk policy、working directory 和 env allowlist；sandbox availability 由当前 `SandboxGatewayPort` adapter 的标准结果表达
  来源：spec requirement scenario "Invalid execution input does not reach sandbox"；design D5
- [x] 3.8 确保 sandbox deny/unavailable、policy 拒绝、timeout、canceled、command failed、output too large 或 adapter 通过 `safeError` 表达的资源类失败时不回退到 unsandboxed local execution
  来源：spec requirement scenario "Sandbox unavailable does not fall back to host execution"；design D5
- [x] 3.9 确保 `CapabilityInvocationResult` 不直接暴露 host path、raw command、raw stdout/stderr、secret、credential 或完整内部执行轨迹
  来源：spec requirement scenario "Sandboxed capability result is redacted"；design D5

## 4. 错误码映射

- [x] 4.1 将 deny-by-default / unavailable adapter 返回的不可用结果映射为 `SANDBOX_UNAVAILABLE` SafeError-compatible code
  来源：spec requirement scenario "Sandbox unavailable does not fall back to host execution"；design D5
- [x] 4.2 实现 `SANDBOX_TIMEOUT` SafeError-compatible code
  来源：spec requirement scenario "Sandbox execution failure emits safe diagnostics"；design D5
- [x] 4.3 将 adapter 已通过 `safeError.code` 表达的资源、网络或文件系统类拒绝透传/归一为 SafeError-compatible capability failure；本 change 不新增 `SandboxExecutionResult` resource usage 字段，也不承诺真实资源计量实现
  来源：spec requirement scenario "Sandbox execution failure emits safe diagnostics"；design D4、D5
- [x] 4.4 实现 `SANDBOX_EXECUTION_FAILED` SafeError-compatible code
  来源：spec requirement scenario "Sandbox execution failure emits safe diagnostics"；design D5
- [x] 4.5 实现 `OUTPUT_TOO_LARGE` SafeError-compatible code
  来源：spec requirement scenario "Output too large is explicit"；design D5
- [x] 4.6 实现 `SANDBOX_BYPASS_DENIED` SafeError-compatible code
  来源：spec requirement scenario "Direct host execution bypass is denied"；design D5

## 5. 最小安全可观测性

- [x] 5.1 在 executable sandbox runtime 映射点产生最小安全诊断事实，至少区分 submitted、completed、failed、timeout / canceled、denied / unavailable；不得记录 raw command、raw stdout/stderr、host path、secret、credential 或完整内部执行轨迹
  来源：design 质量属性设计
- [x] 5.2 将最小诊断接入当前已有 structured logging / metric / audit 边界中的可用路径；若完整 telemetry 平台尚未落地，本 change 只验证安全诊断数据形状，不实现独立 telemetry 平台
  来源：design 质量属性设计

## 6. 验证

- [x] 6.1 编写 `SandboxGatewayPort` 接入单元测试，确认 executable invocation 构造 `SandboxExecutionRequest` 并调用当前装配的 port
  来源：design D1
- [x] 6.2 编写 local / remote / deny adapter contract 消费测试，确认本地隔离细节、远端协议 DTO 和 SDK 类型不泄漏到 capability public result；不要求本 change 完整实现真实 local / remote adapter
  来源：design D2
- [x] 6.3 编写沙箱执行集成测试
  来源：spec requirement scenario "Sandboxed invocation is mapped back into capability result"；design D3
- [x] 6.4 编写 Skill executable 只产生安全 resource ref 且 descriptor 不含 raw host path 的测试
  来源：spec requirement scenario "Skill discovery registers refs without local execution"
- [x] 6.5 编写 discovery/content loading 不执行本地命令的测试
  来源：spec requirement "Discovery And Content Loading Must Not Execute Local Commands"
- [x] 6.6 编写 sandbox deny/unavailable、timeout、canceled、output too large、execution failed 和 adapter safeError 时不回退 unsandboxed local execution 的测试，其中 unavailable 必须通过当前 `SandboxGatewayPort` adapter 结果进入 capability 映射
  来源：spec requirement scenario "Sandbox unavailable does not fall back to host execution"
- [x] 6.7 编写 capability、hook、policy 绕过 sandbox 直接执行 shell/python/script/generated code 被拒绝的测试
  来源：spec requirement scenario "Direct host execution bypass is denied"
- [x] 6.8 编写 `CapabilityInvocationResult` 不泄漏 host path、raw command、raw stdout/stderr、secret、credential 或完整执行轨迹的测试
  来源：spec requirement scenario "Sandboxed capability result is redacted"
- [x] 6.9 运行 `npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`
  来源：AGENTS.md 验证门禁
- [x] 6.10 运行 `openspec validate add-ts-executable-tool-sandbox-runtime --strict`
  来源：AGENTS.md 验证门禁

## 归档前基线提升检查（非实施任务）

归档时需要把长期有效内容提炼到以下基线：
- `openspec/specs/capability-spi/spec.md`
- `openspec/designs/contracts/capability-spi.md`
