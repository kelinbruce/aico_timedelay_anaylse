## 背景与问题（Why）

当前 `bash` 与 `python` 虽然都通过 sandbox gateway 执行，但 capability 失败收口并不一致。`bash` 在进入 sandbox 后若发生 timeout、sandbox safe error 或非零退出，会按既有 capability 结果路径收敛为 `DEGRADED`、`TIMED_OUT` 或 `FAILED`，`agent-core` 会继续写入模型可见 `CAPABILITY_RESULT`、发出 `DEGRADATION_NOTICE`，并在可恢复场景下允许下一轮模型基于失败证据调整参数或改用其他 capability。

`python` 当前存在一条不一致路径：当 sandbox boundary 抛出 `AgentError` 时，tool 实现会把该异常吞成 `SUCCEEDED + exit_code=126` 的普通结构化结果。这样虽然下一轮模型仍可看到 `stderr`，但 runtime/core 无法把它识别为 capability failure truth，因此不会统一发出 `DEGRADATION_NOTICE`，也无法在 failure/timed_out 语义下复用既有日志、timeline 和 repeated-failure guard。

这会带来两个直接问题：

- 相同的 sandbox execution failure，在 `bash` 与 `python` 上留下不同的 capability truth，削弱了 runtime 对动态执行失败的统一治理。
- `python` 的 sandbox failure 缺少统一的 capability failure 投影，后续上下文虽然能看到局部字符串，但看不到规范化的 failure status / safe error 事实，影响模型修正、诊断和 loop 收敛。

因此需要把 `python` 的 sandbox execution failure 语义收敛到与 `bash` 一致的 capability failure 路径，同时保留 Python 既有“非零 `exit_code` 仍是结构化结果”的黑盒契约。

## 变更范围（What Changes）

- 统一 `python` tool 的 sandbox execution failure 收口：
  - sandbox timeout 映射为 capability `TIMED_OUT`。
  - sandbox unavailable / deny / safe failure 映射为 capability `FAILED`。
  - 上述 failure MUST 走现有 `agent-core` tool loop 的失败投影路径，而不是再伪装成 `SUCCEEDED + exit_code=126`。
- 保持 `python` 的非零 `exit_code` 语义不变：
  - 仅当 sandbox execution 已成功返回结构化输出时，`exit_code != 0` 仍作为普通结构化结果返回；
  - 本 change 不把 Python 非零退出改成 `DEGRADED`。
- 统一模型可见 failure 证据：
  - `python` 的 sandbox failure / timeout 必须像 `bash` 一样落成 bounded `CAPABILITY_RESULT` failure payload，支持下一次执行依据 safe error 事实继续推理。
- 统一 observability：
  - `python` 的 sandbox failure 必须与 `bash` 一样落在 runtime log 的 sandbox execution failure / capability completion 语义中，便于运维定位和重复失败收敛。

## Capability 影响（Capabilities）

### 新增 Capability

无

### 修改的 Capability

- `python-tool`: 修改 Python tool 对 sandbox timeout 与 sandbox safe failure 的 capability-level 结果语义；这些场景不再伪装成普通成功结果，而要进入统一 failure/timed_out 路径。非零 `exit_code` 保持普通结构化结果语义不变。

## 影响范围（Impact）

- 代码：
  - `packages/agent-capability/src/builtins/python/python-tool.ts`
  - `packages/agent-capability/tests/python-capability.test.ts`
  - `packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  - 视需要补充 `agent-core` 现有 tool-loop / runtime observability 回归测试
- 行为：
  - Python sandbox timeout / unavailable / denial 将改变为 capability `TIMED_OUT` / `FAILED`
  - 后续上下文中的 Python failure 将通过标准 `CAPABILITY_RESULT` failure payload 暴露
- 可观测与诊断：
  - runtime log、timeline `DEGRADATION_NOTICE`、repeated failure guard 将对 Python sandbox failure 生效
- 测试：
  - 需要补充 Python capability contract tests 和 runtime observability characterization tests

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：
  - `openspec/specs/python-tool/spec.md`：修改 timeout 与 sandbox failure requirement；保留非零 `exit_code` 的结构化结果 requirement

- 长期背景：
  - `openspec/overview.md`：无

- 设计视图：
  - `openspec/designs/architecture/runtime-boundaries.md`：无
  - `openspec/designs/modules/agent-capability.md`：无
  - `openspec/designs/adr/<id>.md`：无
  - `openspec/designs/spec-to-design-map.md`：如 `python-tool` 的长期设计导航需要补充 failure truth 对齐说明，则更新；否则无

- 验证入口：
  - `npx vitest run packages/agent-capability/tests/python-capability.test.ts`
  - `npx vitest run packages/agent-app/tests/runtime-trajectory-observability.test.ts`
  - 相关 `agent-core` tool loop focused tests
