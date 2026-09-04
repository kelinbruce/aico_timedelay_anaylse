# bash-tool Specification Delta

## ADDED Requirements

### Requirement: 本地部署中前台 Bash 超时自动转入后台

当一次前台 Bash 调用（不带 `run_in_background`）在 `backgroundExecutionEnabled === true` 的 local deployment 中超时时，sandbox gateway SHALL NOT 杀掉子进程。它 SHALL 把正在运行的进程转成一个后台任务，并返回后台任务句柄 `{ taskId, status: "RUNNING", stdoutRef, stderrRef, backgroundReason: "TIMEOUT_AUTO_BACKGROUND" }` 作为 `SUCCEEDED` capability outcome，使 agent 循环不阻塞地继续。被脱离的进程 SHALL 继续运行，其完成 SHALL 恰好一次地触发既有的后台任务 continuation 通知路径。

当 `backgroundExecutionEnabled === false`（remote deployment，或未启用后台能力的 local deployment）时，前台超时 SHALL 继续杀掉进程并返回 `TIMED_OUT` capability outcome——与基线行为保持不变。

前台完成路径（进程在超时前退出）SHALL 返回正常的 bounded 前台结果，且 SHALL NOT 触发 continuation 通知；`markNotified` 原子标志 SHALL 保证前台完成与后台通知路径永远不会为同一任务同时提交 continuation。

#### Scenario: 前台命令在超时前完成时返回前台结果且不带 continuation

- **WHEN** 一次前台 Bash 调用运行在 `backgroundExecutionEnabled === true` 的 local deployment 中
- **AND** 命令在超时到来之前退出
- **THEN** 该调用 MUST 返回正常的 bounded 前台结果（stdout/stderr/exitCode）
- **AND** 该调用 MUST NOT 返回后台任务句柄
- **AND** 该任务 MUST NOT 提交任何后台任务 continuation 通知

#### Scenario: 本地部署中的前台超时使进程自动转入后台

- **WHEN** 一次前台 Bash 调用在 `backgroundExecutionEnabled === true` 的 local deployment 中超时
- **THEN** sandbox gateway MUST NOT 杀掉子进程
- **AND** 该调用 MUST 返回携带 `{ taskId, status: "RUNNING", stdoutRef, stderrRef, backgroundReason: "TIMEOUT_AUTO_BACKGROUND" }` 的 `SUCCEEDED` capability outcome
- **AND** 被脱离的进程 MUST 在工具返回后继续运行
- **AND** 当进程随后退出时，MUST 恰好提交一条后台任务 continuation 通知

#### Scenario: Remote deployment 中的前台超时仍然杀掉进程并返回超时

- **WHEN** 一次前台 Bash 调用在 `backgroundExecutionEnabled === false` 时超时
- **THEN** sandbox gateway MUST 杀掉子进程
- **AND** 该调用 MUST 返回 `TIMED_OUT` capability outcome
- **AND** MUST NOT 出现任何后台任务句柄
