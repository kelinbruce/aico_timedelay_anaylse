# Design

## 设计范围（Scope）

本 change 修改既有的 Skill 资源访问 Function。目标 delta 限定为 Skill Tool 资源投影失败诊断、并发投影锁恢复，以及对应的聚焦测试覆盖。

本 change 不修改 Skill Tool 输入校验、Skill 激活授权、投影路径授权、sandbox 执行、可写路径策略、Web API、stream、timeline、audit 或 metric。

## Skill 资源访问

### 目标与规范依据

目标 Requirements 是 `openspec/changes/fix-skill-projection-diagnostics/specs/skill-resource-access/spec.md` 中的 `Skill Projection Failures Emit Safe Runtime Diagnostics` 和 `Concurrent Skill Projection Reuses Committed Resources`。

系统必须保持安全的模型可见失败，同时为运维人员提供足够的 runtime 诊断证据来区分常见投影失败类别。系统还必须防止同一 Skill 投影的并发首次激活仅因另一进程已在发布同一已提交资源树而失败。

### 当前实现

Skill Tool 已经捕获 `WorkspaceFilePort.projectSkillResources(...)` 的失败并向模型返回 safe failure。SafeError 失败保留其 safe code，未知异常则被映射为通用的 `EXECUTION_FAILED` 结果。

在本 change 之前，该边界不会发出带有一界分类器的稳定诊断事件，因此本地运维人员无法快速区分权限失败与路径拒绝、路径缺失、文件系统繁忙、资源上限或未知异常。

投影发布方在 staging 和 commit 周围使用目录锁。进程本地的 `initializedSkillProjectionBases` 只允许在当前进程已激活投影 base 之后复用。在多进程并发激活期间，竞争进程可能持有空的进程本地缓存，等待锁，然后在第一个发布方已提交投影之后超时或重建同一投影。

### GAP 分析

既有的 safe result 对模型可见面是正确的，但对本地排障不够。加入原始异常消息会让诊断更容易，但会违反日志边界，因为异常文本中可能出现文件系统路径、source root、Skill 参数或其他敏感值。

因此所需的能力是一个只包含代码持有低基数字段的诊断事件。

既有的投影锁对发布完整性是正确的，但复用条件对并发激活而言过窄。一旦观察到竞争，应允许竞争进程校验并复用已提交的投影。锁超时且没有可复用的已提交投影属于临时竞争失败，应以可重试的 safe failure 语义暴露，而不是不可重试的内部失败。

### 修改方案

`agent-capability` 在投影失败捕获边界返回既有 safe failure 之前，发出一个 `skill.tool.resource_projection_failed` runtime diagnostic。

该事件只使用由受治理 Skill 身份、source capability 形态、SafeError code/category、归一化的 Node 错误码、有界的 failure kind、允许清单内的失败阶段、允许清单内的失败原因码和允许清单内的数值证据派生的稳定字段。实现不向 logger 传递原始异常消息、堆栈、路径、Skill 参数、资源内容、prompt 文本或模型输出。

failure kind 把已知 SafeError code 和常见 Node 文件系统错误码映射为稳定类别：

- `RESOURCE_LIMIT`
- `PATH_REJECTED`
- `PERMISSION_DENIED`
- `MISSING_PATH`
- `FILESYSTEM_BUSY`
- `SAFE_ERROR`
- `UNKNOWN_EXCEPTION`

投影自有的 SafeError 还可以携带安全的诊断细节。Skill Tool logger 只复制允许清单内的细节 key：

- `failureStage`
- `failureReasonCode`
- `resourceCount`
- `maxResourceCount`
- `pathLength`
- `maxPathLength`
- `sizeBytes`
- `expectedSizeBytes`
- `lockWaitMs`

字符串值必须是全大写的代码持有标识符。数值必须是非负安全整数。任意 detail 字段被忽略。

公开失败路径保持不变。这在保持模型规划和用户可见行为兼容性的同时改进本地诊断。

对于锁恢复，`WorkspaceFilePort.projectSkillResources(...)` 保持相同的锁和 staging 模型。当锁创建报告锁已存在时，锁循环在每次轮询时校验 `projectionCommitted(...)`。如果存在匹配的已提交投影，竞争激活返回同一资源 root，不再列举或读取资源。

如果竞争激活在观察到竞争之后最终获得锁，它会在重建之前执行相同的已提交投影校验。这样当第一个发布方在轮询间隔之间释放锁时，可以避免不必要的重复重建。

对于无竞争的首次激活，服务重启刷新行为保持不变：一个未观察到竞争就获得锁的新进程仍然刷新投影，而不是信任来自另一个 runtime 生命周期的进程本地初始化。

对于有界的锁超时，Skill Tool 识别代码持有的安全锁消息并返回 `category=UNAVAILABLE` 且 `retryable=true`。其他投影 `CONFLICT` 失败继续使用既有 safe 映射，不会被广泛地改为可重试。

### 质量属性影响

安全：新的诊断事件刻意保持低基数，排除原始异常文本、路径、内容、credential、token、prompt 文本和模型输出。

可诊断性：运维人员可以从 runtime 日志识别失败类别，而不依赖通用的模型可见错误消息。

可靠性：日志不是权威，不改变投影重试、失败或清理语义。

并发可靠性：共享同一执行 scope 的独立激活可以收敛到第一个有效的已提交投影，而不是竞争产生重复投影工作或不可重试的请求失败。

## 验证

- 针对权限类投影失败的聚焦 Skill Tool 测试。
- 断言公开失败保持通用的聚焦测试。
- 断言 runtime diagnostic 包含有界分类器且不包含原始文件系统路径的聚焦测试。
- 证明允许清单内的投影诊断细节被记录且任意 detail 字段被忽略的聚焦 Skill Tool 测试。
- 针对可重试锁超时语义的聚焦 Skill Tool 测试。
- 针对跨独立 workspace file port 并发复用的聚焦投影测试。
- 既有 model-output 恢复测试保持独立，并验证单独的内容完整性修复。

## 归档前更新基线（Baseline Promotion Plan）

归档前，把新 Requirement 合并进 `openspec/specs/skill-resource-access/spec.md`，并保持实现/测试证据链接自归档后的 change。
