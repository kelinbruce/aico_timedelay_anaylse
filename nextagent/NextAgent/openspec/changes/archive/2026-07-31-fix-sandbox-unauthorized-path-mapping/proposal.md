## 背景与问题（Why）

受限本地 sandbox 在 Python 脚本路径无法匹配当前执行文件系统根时返回 `PYTHON_EXECUTION_UNAVAILABLE`，并携带安全原因 `unauthorized-path`。现有 capability 错误归一化只把 `unsafe-path` 映射为 `CAPABILITY_PATH_REJECTED`，因此 `unauthorized-path` 落入通用不可用分支，最终向模型暴露为 `SANDBOX_UNAVAILABLE`。

该结果把确定性的路径授权拒绝误报为 sandbox 依赖不可用，导致模型和运维诊断无法区分安全策略拒绝与基础设施故障，并可能触发无意义的 Bash/Python 重试。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- `unauthorized-path` 必须归一化为 `CAPABILITY_PATH_REJECTED`、`AUTHORIZATION`、`retryable: false`。
- 真正的 sandbox dependency unavailable 失败继续归一化为 `SANDBOX_UNAVAILABLE`、`UNAVAILABLE`。
- 回归测试覆盖授权路径拒绝与真实不可用两个分支。

**非目标：**

- 不允许 host 绝对路径、路径穿越或未授权 Skill projection 路径。
- 不修改 restricted local sandbox 的路径匹配、filesystem roots 或执行策略。
- 不新增 public DTO、错误枚举、配置项、API、stream event 或持久化事实。

## 变更范围（What Changes）

- 修改 `agent-capability` 既有 sandbox safe-error 归一化，使 `unauthorized-path` 与既有 `unsafe-path` 使用同一 `CAPABILITY_PATH_REJECTED` 授权拒绝策略。
- 补充 capability 层回归测试，证明路径拒绝不会被包装为 `SANDBOX_UNAVAILABLE`，同时保留真实 unavailable 映射。

## Capability 影响（Capabilities）

### 新增 Capability

无。

### 修改的 Capability

- `sandbox-runtime`：修改 sandbox 路径拒绝的运行时安全错误归一化行为。

## 影响范围（Impact）

- 代码：`packages/agent-capability/src/builtins/sandbox/sandbox-execution-port.ts`。
- 测试：`packages/agent-capability/tests/` 中 sandbox execution port 的安全错误归一化测试。
- API、配置、依赖和持久化格式不变。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：合并路径拒绝必须投影为授权类安全错误的要求。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/`：无。
- `openspec/designs/modules/agent-capability.md`：无，既有 safe failure mapping owner 与职责不变。
- `openspec/designs/adr/`：无。
- `openspec/designs/features/`：无。
- `openspec/designs/functions/`：无。
- `openspec/designs/spec-to-design-map.md`：无导航变化。
