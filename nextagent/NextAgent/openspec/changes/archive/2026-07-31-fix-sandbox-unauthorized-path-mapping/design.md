## 当前实现基线（Current Baseline）

`agent-capability` 的 `createWorkspaceBackedSandboxExecutionPort` 是 sandbox gateway 结果到 builtin Bash/Python capability 结果的归一化 owner。调用链为 builtin Tool executor 调用 `SandboxExecutionPort`，该 port 向 `SandboxGatewayPort.execute` 提交请求，并在 gateway 返回 `safeError` 时通过 `toSandboxCapabilitySafeError` 转换后抛出 `AgentError`。

当前映射先读取 `safeDetails.reason`：`unsupported-executable` 映射为 `COMMAND_NOT_ALLOWED`，`unsafe-path` 映射为 `CAPABILITY_PATH_REJECTED`，之后才按 error category 处理取消和不可用。受限本地 sandbox 对脚本路径授权拒绝实际返回 `safeDetails.reason: "unauthorized-path"`，因此该 reason 未命中路径分支，并因 gateway error category 为 `UNAVAILABLE` 被映射为 `SANDBOX_UNAVAILABLE`。

现有 restricted local sandbox 测试已证明未授权脚本路径会在解释器启动前被拒绝；现有产品装配测试分别证明 unsupported executable 映射为授权拒绝、真实 unavailable 映射为 `SANDBOX_UNAVAILABLE`。当前缺口是 capability boundary 没有覆盖 adapter 实际产生的 `unauthorized-path` reason。

## 目标设计（Proposed Design）

唯一实现路径是在 `toSandboxCapabilitySafeError` 的既有路径拒绝分支中同时识别 `unsafe-path` 和 `unauthorized-path`。两者均在通用 category 分支之前归一化为：

| gateway `safeDetails.reason` | capability code | category | retryable |
|---|---|---|---|
| `unsafe-path` | `CAPABILITY_PATH_REJECTED` | `AUTHORIZATION` | `false` |
| `unauthorized-path` | `CAPABILITY_PATH_REJECTED` | `AUTHORIZATION` | `false` |
| 其他或缺失，且 gateway category 为 `UNAVAILABLE` | `SANDBOX_UNAVAILABLE` | `UNAVAILABLE` | 保留 gateway 值 |

`agent-capability` 继续拥有 capability-facing safe error 归一化；restricted local sandbox 继续拥有路径解析与授权拒绝。实现不修改 gateway error code、adapter reason、filesystem roots、脚本参数翻译、公开契约或执行策略，也不新增兼容层或第二套映射入口。

路径拒绝结果继续保留既有 bounded `safeDetails`，并使用既有 `sandboxReasonCode` 记录 gateway error code。该映射不得加入原始命令或物理路径。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证方向 |
|---|---|---|
| 安全 | 只修正拒绝分类，不放宽任何路径；授权拒绝保持不可重试，safe error 不新增物理路径或命令。 | capability boundary negative test、人工审查 |
| 性能/容量 | 仅增加一个常量字符串比较，不改变 I/O、并发、内存或输出上限。 | 定向 unit test |
| 可靠性/恢复 | 确定性授权拒绝不再伪装为基础设施故障，避免无意义重试；真实 unavailable 行为保持不变。 | 路径拒绝与 unavailable 双分支测试 |
| 可维护性 | 复用既有单一归一化函数和既有错误 vocabulary，不新增 helper、配置或 public contract。 | 代码审查、TypeScript build |
| 可测试性 | gateway safe error 可由 deterministic test double 构造，直接断言 capability-facing safe error。 | unit test |
| 审计/可追溯性 | 不改变日志、trace 或 audit shape；既有 bounded reason 和 gateway code 仍可用于本地诊断。 | 回归测试与人工审查 |

## 验证策略（Verification Strategy）

unit test 在 `createWorkspaceBackedSandboxExecutionPort` 的 public boundary 注入 sandbox gateway test double，并通过 `runPython` 分别断言 `unauthorized-path` 与 `unsafe-path` 最终 `AgentError` 为 `CAPABILITY_PATH_REJECTED`、`AUTHORIZATION`、不可重试且不是 `SANDBOX_UNAVAILABLE`。同一测试层补充无路径拒绝 reason 的 `UNAVAILABLE` case，证明分支没有吞并真实不可用错误。

restricted local sandbox 的既有 characterization test 继续覆盖未授权 Python 脚本路径在执行前失败；本 change 不锁定路径解析的私有函数形状。TypeScript build 和 OpenSpec strict validation 分别覆盖实现类型完整性与规格结构。

## 风险与取舍（Risks / Trade-offs）

gateway reason 目前是字符串 vocabulary，后续 adapter 若新增另一种同语义 path rejection reason，仍可能遗漏 capability mapping。此次按最小变更只纳入当前既有 `unsafe-path` 和实际产生的 `unauthorized-path`；测试固定二者的同形策略，后续若扩展 reason 必须同步规格与映射。

## 待确认问题（Open Questions）

无。

## 长期基线刷新计划

本节将旧模板的“归档前更新基线”归一为可审计的归档门禁；以下均为**归档前待执行**，不表示 stable baseline 已刷新。

- **Function：**以 `FN-6.3-沙箱执行命令` 为唯一用户可见行为 owner；若本 change 增加的行为不能被该 Function 的既有边界完整表达，先在同一能力域新增一个单一职责 Function，再更新 `openspec/designs/functions/index.md`，不得把实现细节直接写入 Function。
- **Stable spec：**将 delta Requirement 合并至 `openspec/specs/sandbox-runtime/spec.md`，逐条核对 Requirement 标题、MUST/SHALL 语义、场景、迁移和 metadata；不得以 `--skip-specs` 绕过同名 Requirement 重叠。
- **长期设计：**先执行本 design/proposal 已列出的“归档前更新基线”设计 owner；再在 `openspec/designs/spec-to-design-map.md` 为上述 stable spec 写入该 Function、实际承载的 architecture/module/ADR 与验证入口。若现有 map 无该 spec 行，先创建该行，而非把 change-local design 当作长期设计。
- **归档判定：**Function、stable spec、长期设计和 map 四端均完成 diff 审阅且 `openspec validate --all --strict` 通过后，才允许归档；任一端无法唯一归属时保留 active 并标记阻塞。
