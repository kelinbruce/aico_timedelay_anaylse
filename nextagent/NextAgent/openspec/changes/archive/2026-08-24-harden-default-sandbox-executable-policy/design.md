## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-6.3 沙箱执行命令` | 仓库默认启动时启用 executable 校验，以四成员 allowlist 收敛 direct execution，并以精确 denylist 显式拒绝高风险入口 | `sandbox-runtime` | `FN-6.3 沙箱执行命令` |

## `FN-6.3 沙箱执行命令`

### 目标与规范依据

本设计把仓库内置默认配置从跳过 executable policy 收敛为实际执行最小 allowlist，同时保留自定义可信启动配置和现有 sandbox gateway 行为。

#### 本 Function 的目标 Requirements

canonical spec：`sandbox-runtime`

- `MODIFIED`：`Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration`

### 当前实现

- `packages/agent-app/config/default-system.yaml` 当前设置 `sandbox.enabled=false`，`allowedExecutables` 为 `curl`、`clipc`，`deniedExecutables` 为空。
- 配置校验层保留 `allowedExecutables` 缺失与显式空数组的差异，并把 `enabled`、allowlist 和 denylist 冻结后投影到 app composition。
- `RestrictedLocalSandboxGateway.validateRequest` 仅在 `enabled !== false` 时执行名单校验；allowlist 存在时，名单外 executable 和 shell composition 均在进程启动前拒绝。
- Bash 已把 `python` 请求路由到既有 Python sandbox execution port；Python invocation mode、受信脚本路径和 Skill module root 继续由既有 sandbox 规则处理。
- 默认配置加载预期分布在配置 composition、contract 和最小内核测试中，现有断言仍冻结旧的 disabled 状态与两成员名单。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 默认配置启用 executable policy | 默认 `enabled=false`，gateway 跳过名单校验 | 默认值和测试预期需要改为 `true` |
| 默认名单精确包含 `clipc`、`curl`、`python` | 当前仅包含 `curl`、`clipc` | 需要替换为目标顺序与完整集合 |
| 默认 denylist 显式拒绝高风险 executable | 当前 denylist 为空 | 需要写入 spec 冻结的精确高危 denylist，并确保与 allowlist 无交集；职责去重以及普通查询、校验和文本变换命令不进入 denylist |
| 默认配置按现有白名单 direct-only 语义执行 | adapter 已实现该语义，但默认配置未激活 | 需要用既有配置投影路径激活，不新增分支 |

### 修改方案

唯一实施路径是只修改仓库内置 `default-system.yaml` 的受信默认值，并更新直接冻结该默认值的测试：

1. 将 `sandbox.enabled` 改为 `true`。
2. 将 `allowedExecutables` 按固定顺序设置为 `clipc`、`curl`、`python`。
3. 将 `deniedExecutables` 按 spec 固定顺序设置为精确穷尽集合，并断言与 allowlist 无共同成员。
4. 更新默认配置加载和 composition/contract 测试，使其同时断言配置为 `READY`、校验启用和两份精确名单。
5. 使用现有 restricted local sandbox negative tests 证明名单外 executable、denylist 优先与 shell composition fail closed；如现有测试无法覆盖默认配置到 gateway 的集成结果，则补充一个最小黑盒测试，不复制 adapter 内部实现断言。

`agent-app` 继续拥有可信配置加载与冻结，`agent-platform-gateway-local` 继续拥有 executable policy enforcement。不要修改 schema、public gateway contract、Bash Tool input、sandbox port 或 executable 解析逻辑；本次没有新字段、兼容分支和持久化状态。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | 无新增黑盒质量目标；由 `sandbox-runtime` / `Restricted Local Sandbox Resolves Governed Business Executables From Trusted Configuration` 的功能行为产生 | 通过现有 trusted config → frozen composition → restricted local sandbox 单一路径启用精确 allowlist、denylist 优先和 direct-only 拒绝 | 两份默认精确集合及无交集、名单外拒绝、denylist 优先、shell composition 拒绝、运行时输入不能覆盖 |

## 验证策略（Verification Strategy）

- contract/configuration tests 验证默认配置可加载、`enabled=true` 且名单顺序和成员精确一致，并验证配置通过既有 composition 路径投影。
- restricted sandbox unit tests 继续覆盖 allowlist normal path、名单外 negative case、denylist 优先和 shell composition negative case。
- build 与 architecture gate 验证没有引入 contract、package owner 或依赖边界变化。
- OpenSpec strict validation 和模型语义检视验证 delta operation、Function 映射和目标态一致性。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：归档时合并默认启用状态、精确 executable 名单和对应 scenarios。
- `openspec/designs/functions/D6-安全与治理/D6.2-执行与风险治理/FN-6.3-沙箱执行命令.md`：刷新默认 executable policy 规格，使用当前三列表格格式并移除既有候选值式规格行。
- `openspec/designs/features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md`：刷新默认最小授权的用户可依赖安全保证。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/configuration-boundary.md`：刷新仓库默认 sandbox 配置值。
- `openspec/designs/modules/agent-app.md`：刷新默认配置说明。
- `openspec/designs/modules/agent-platform-gateway-local.md`：刷新默认启用 allowlist 的事实说明。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：把默认策略说明从 denylist-only 更新为启用精确 allowlist；验证入口不变。

## 风险与取舍（Risks / Trade-offs）

- 依赖默认配置执行名单外 executable 的本地使用路径会立即失败。这是目标中的安全收敛；缓解方式是由部署者在可信自定义配置中显式批准确有必要的 executable，而不是放宽仓库默认值。
- `curl` 只获得 executable 级授权，不代表任意目标或参数天然安全。本 change 不伪造参数级安全保证；生产隔离和既有 API/CLIP 治理仍是必要边界。
- `python` 保留是为了支持现有脚本和 module 路径；不改变 Python sandbox 对不支持 invocation mode 的 fail-closed 规则。

## 迁移与回滚（Migration / Rollback）

新默认值随部署配置生效，不涉及数据迁移。发布前必须确认依赖默认配置的必要 executable 已包含在四成员名单或由部署自定义配置显式批准。若上线后发现合法命令被拒绝，优先在该部署的可信配置中增加精确 executable；只有默认策略导致不可接受的系统级回归时才回滚本变更，并通过默认配置加载测试确认恢复结果。

## 待确认问题（Open Questions）

无。
