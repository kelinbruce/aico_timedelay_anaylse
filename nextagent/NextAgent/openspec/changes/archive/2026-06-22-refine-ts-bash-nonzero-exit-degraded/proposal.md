## 背景与问题（Why）

当前 `bash` tool 把“命令已通过策略校验并进入 sandbox 执行，但进程以非零 exit code 结束”统一映射为 capability 级 `FAILED`，并使用 `BASH_EXECUTION_FAILED` / `SANDBOX_EXECUTION_FAILED` 一类 safe error 结束整个 tool loop。`agent-core` 对 `FAILED + INTERNAL` 的既有消费规则是立即终止当前 run，因此模型无法看到已经受限、已脱敏且有界的 `stdout` / `stderr` / `exitCode` 结果，也无法基于这些结果在同一次 request 内继续自修正。

这个处理把两类语义不同的失败混在了一起：

- 命令已经被执行，返回了受控的业务结果，只是 exit code 非 0；
- 平台不支持、sandbox 不可用、策略拒绝、结果非法或真正的执行边界失败。

前者更接近“有结果的降级执行”，后者才是必须终止 run 的 capability 失败。当前 Bash 行为与 Python tool 已有的“非零退出仍保持结构化结果”语义也不一致，导致工具结果体验和模型恢复路径不统一。

## 变更范围（What Changes）

- 调整 Bash 对“sandbox 已执行且返回非零 exit code”场景的外部行为契约：
  - 不再把该场景映射为 capability 级 `FAILED + INTERNAL`；
  - 改为 capability 级 `DEGRADED`，并保留有界 `stdout` / `stderr` / `exitCode` / truncation flags 作为结构化结果进入后续模型上下文。
- 保持以下场景继续走失败终止语义，不纳入本次放宽：
  - policy rejection；
  - sandbox gateway unavailable / canceled；
  - adapter/platform unsupported；
  - response shape invalid；
  - timeout；
  - output overflow / result invalid 等执行边界失败。
- 对齐 Bash 相关测试与 tool-loop characterization，确保：
  - 非零 exit code 结果会产生 `DEGRADED` + `DEGRADATION_NOTICE`；
  - 后续模型步骤可消费该结果；
  - 真正的平台/边界失败仍然终止 run。

## Capability 影响（Capabilities）

### 新增 Capability

无

### 修改的 Capability

- `bash-tool`: 修改 Bash 对非零 exit code 的结果语义，从 capability failure 改为 degraded structured result。

## 影响范围（Impact）

- `packages/agent-capability/src/builtins/bash/` 中 Bash result mapping
- `packages/agent-core/src/tools/tool-loop.ts` 的现有 `DEGRADED` 消费路径覆盖范围
- Bash capability tests、tool-loop tests，以及必要的 stream / result projection characterization
- 依赖 Bash 非零退出终止当前 run 的现有测试断言

## 归档前更新基线（Baseline Promotion Plan）

- 行为契约：
  - `openspec/specs/bash-tool/spec.md`：更新 Bash 非零 exit code 的稳定行为

- 长期背景：
  - `openspec/overview.md`：无

- 设计视图：
  - `openspec/designs/architecture/capability-spi.md`：无，现有 `DEGRADED` 结果消费规则已足够承载本次变化
  - `openspec/designs/modules/agent-capability.md`：按需补充 Bash / executable capability 的结果映射一致性；若 archive 时确认现有模块设计已覆盖，可不更新
  - `openspec/designs/adr/<id>.md`：无
  - `openspec/designs/spec-to-design-map.md`：按需补充 `bash-tool` 对 `agent-capability` 模块设计的导航；若现有映射已足够，可不更新

- 验证入口：
  - `npm test -- --run packages/agent-capability/tests/bash-capability.test.ts tests/agent-kernel/tool-loop.test.ts`
  - `openspec validate --all --strict`
