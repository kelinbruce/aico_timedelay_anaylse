## 背景与问题（Why）

当前 restricted local sandbox 会把“请求被本地受限沙箱拒绝”和“沙箱执行能力不可用”都折叠成 unavailable 结果与日志。对于 Windows 上 `bash` 提交 `cd` 这类不受支持命令，产品路径最终只看到 `SANDBOX_UNAVAILABLE`，无法区分是策略/路径拒绝还是 sandbox 基础设施真的不可用。

这会带来两类问题：

- 用户可见 safe error 不准确，误导排障。
- 结构化日志把 rejected request 误记为 unavailable，降低可诊断性。

## 变更范围（What Changes）

- 明确 restricted local sandbox 的 request rejection 与 adapter unavailability 是两类不同结果。
- 约束 request rejection 的 safe mapping：不支持的命令映射为 `COMMAND_NOT_ALLOWED`，不安全路径映射为 `CAPABILITY_PATH_REJECTED`。
- 约束 observability mapping：rejected request 使用独立安全事件，不再复用 unavailable 事件名。

## 影响范围（Impact）

- `agent-platform-gateway-local`：restricted local sandbox 需要输出可区分的 safe rejection reason，并区分 rejected / unavailable observability。
- `agent-app`：sandbox safe error 到 capability safe error 的映射需要消费 rejection reason，并回落到既有 `COMMAND_NOT_ALLOWED` / `CAPABILITY_PATH_REJECTED` vocabulary。
- 测试：需要覆盖 restricted local sandbox request rejection 与 product-path safe error 映射。

## 非目标（Non-Goals）

- 不修改冻结 `SandboxExecutionRequest` / `SandboxExecutionResult` contract。
- 不引入新的 capability-facing public error vocabulary。
- 不改变 non-zero exit、timeout、canceled、output overflow 等既有 execution result 语义。

## 验证入口

- `npm run build`
- `npm test`
- `npm run test:contract`
- `npm run lint:architecture`
- `openspec validate refine-ts-sandbox-rejection-mapping --strict`
- `openspec validate --all --strict`
