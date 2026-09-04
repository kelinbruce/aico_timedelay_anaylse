## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-6.3 沙箱执行命令` | 后台 stdout/stderr 文件实施写入时硬上限，超限终止并安全失败 | `sandbox-runtime` | `FN-6.3 沙箱执行命令` |
| `FN-5.5 执行命令和脚本` | Bash 在 sandbox 前拒绝无参数 Python REPL | `command-script-tools`、`bash-tool` | `FN-5.5 执行命令和脚本` |

`FN-6.3` 是主要 owner；`FN-5.5` 只提供必要的入口诊断，不拥有后台进程资源治理。本 change 不新增产品源码、测试或运行时目录层级。新增 OpenSpec change 目录由 OpenSpec workflow 拥有，生命周期为 active 到 archive，对构建、打包和运行时无影响。

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `bash-tool` / `Bash Rejects Unsupported Python Invocation Modes Before Sandbox Submission` | `FN-5.5` / `command-script-tools` | 来源 `REMOVED` + 目标 `ADDED` `Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式` | inline、stdin、option、module、version、script 和修复提示行为无损迁移，并增加零参数 REPL；`bash-tool` 其他 Requirements 原位保留 | `bash-tool.ts` 现有 Python mode guard | 归档后删除来源 Requirement，并把 Function 与 spec-to-design-map 导航指向 canonical spec |

实施和归档期间不得由未协调 active change 同时修改上述来源 Requirement 或目标 Requirement。

## `FN-6.3 沙箱执行命令`

### 目标与规范依据

后台进程的每个输出文件在运行期间和 completion 后都不得超过 `10,485,760 bytes`；超限必须停止落盘、终止根进程、显式失败并留下安全诊断。

#### 本 Function 的目标 Requirements

canonical spec：`sandbox-runtime`

- `MODIFIED`：`Sandbox Failure And Resource Limits Are Explicit`
- `MODIFIED`：`Sandbox Availability And Execution Are Observable`

### 当前实现

`startBackgroundProcess` 使用 stdout/stderr 文件描述符作为子进程 stdio，子进程直接写文件。轮询文件大小只能在内容已经落盘后发现超限；轮询间隔内的峰值写入不受 `10 MiB` 约束，kill 与 truncate 也不能保证检测前磁盘仍有剩余空间。

本地 gateway 已拥有后台进程 spawn、输出 ref、completion 和 kill 句柄，因此无需新增 contract 或把资源治理移到 Capability。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 每文件运行期间不超过固定上限 | 子进程绕过父进程直接写文件 | 只能事后截断，不能限制峰值磁盘占用 |
| 第一个超限字节触发失败 | 以秒级轮询检测文件大小 | 触发时机依赖输出速率 |
| safe signal 不含命令和路径 | resource-limit log 携带 `request.command` 和 task identity | 与 redaction 边界冲突 |
| completion 有界结束 | 只 kill 根进程并等待 close | 输出 pipe 未受控时无法利用关闭/背压阻止继续落盘 |

### 修改方案

唯一实施路径是在 gateway-local 保持既有文件 refs，但把子进程 stdout/stderr 改为 pipe，由父进程同步执行有界写入：

1. spawn 使用 `stdio: ['ignore', 'pipe', 'pipe']`，stdout/stderr 分别维护已写字节数。
2. 每个 data chunk 只把 `min(剩余容量, chunk bytes)` 写入对应文件。恰好累计 `10,485,760 bytes` 仍允许正常完成。
3. chunk 存在未被接受的第一个字节时，原子记录一次超限通道；后续两个通道均不再落盘。
4. 立即 kill 根进程并 destroy 两个读取 pipe。即使派生进程仍持有写端，关闭读取端也不能继续扩大 workspace 文件；本 change 不引入跨平台通用进程树 contract。
5. pipe 和 child 一并 `unref`，保持后台任务不阻塞宿主退出；close/error 统一关闭文件 descriptor。
6. 超限 completion 固定为 `exitCode=-1`、`status=FAILED`。同步文件写入异常在 data callback 内收敛为相同 completion，禁止逃逸为宿主异常；非超限且未发生写入失败时沿用实际 exit code。
7. resource-limit signal 固定使用 `event=sandbox.background.output_limit_exceeded`，只记录 `executableKind`、`outputChannel`、`limitBytes` 和 `failureStage="SANDBOX_BACKGROUND_OUTPUT"`；写入失败使用 `event=sandbox.background.output_write_failed`，省略不适用的 `limitBytes` 并通过 canonical `rawExceptionData` 保留受 operational diagnostic 边界约束的原始异常。

该路径不创建轮询器、临时文件、第二套 task 状态或可配置上限。前台 `executeProcess` 不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 性能/容量 | `Sandbox Failure And Resource Limits Are Explicit` | 写入路径按 byte 计数并截取 chunk 前缀 | stdout/stderr 各自硬上限、恰好边界 |
| 可靠性/恢复 | 同上 | 超限单次终止、统一 close/error completion | completion 不挂起、状态为 `FAILED` |
| 安全/可诊断性 | `Sandbox Availability And Execution Are Observable` | 只输出有界枚举和数值字段 | 不含 raw command、参数、内容、路径和 task id |

## `FN-5.5 执行命令和脚本`

### 目标与规范依据

Bash 对确定无法在非交互 sandbox stdin 中工作的零参数 Python REPL 调用，在提交前返回可纠正诊断。

#### 本 Function 的目标 Requirements

canonical spec：`command-script-tools`

- `ADDED`：`Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式`

来源 legacy spec：`bash-tool`

- `REMOVED`：`Bash Rejects Unsupported Python Invocation Modes Before Sandbox Submission`

### 当前实现

Bash 已在 `rejectUnsupportedPythonInvocationForModelCorrection` 中拒绝 `-c`、`-`、非法 `-m` 和 option-only 模式，并允许精确 `--version`。参数为空时当前直接返回并把解释器提交给 stdin 为 ignore 的 sandbox。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 零参数 Python 不启动 REPL | 空 args 被放行 | 非交互 stdin 下产生不可用进程 |
| Python/Python3 同形同策 | guard 已按 executable 分类复用 | 测试只覆盖 `python` 会留下证据缺口 |
| 返回可纠正错误 | 既有 helper 已提供 code、hint 和 retryable failure | 只缺少零参数 reason code |

### 修改方案

在现有 guard 的首个参数判定中，当参数不存在时抛出 `unsupportedPythonInvocation('BASH_PYTHON_REPL_UNSUPPORTED')`。继续复用 `CAPABILITY_INPUT_INVALID`、`retryable=true` 和现有 Python Tool/script/module hint。`python`、`python3` 使用同一实现，不增加 executable-specific 分支。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Bash 在 sandbox 提交前拒绝不支持的 Python 调用模式` | 不可用 REPL 不进入 side-effect boundary | sandbox dependency 未调用 |
| 可维护性 | 同上 | 复用既有 guard 和错误 helper | Python/Python3 同形测试 |

## 跨 Function 协作与端到端流程

`FN-5.5` 先处理已知不可用输入并向模型提供修复提示；任何通过入口或由其他 Capability 启动的后台进程仍由 `FN-6.3` 独立实施输出硬上限。两层防御不共享计数或错误状态，唯一协作边界仍是既有 sandbox gateway submission。

## 验证策略

- Bash：`python`、`python3` 无参数均在 sandbox 前返回 `BASH_PYTHON_REPL_UNSUPPORTED`；脚本、模块和精确 `--version` 保持可路由。
- Sandbox：stdout 和 stderr 分别用单个超限 chunk 验证最终文件精确不超过 `10,485,760 bytes`；恰好等于上限正常完成。
- Completion：超限固定 `FAILED/-1`，非超限保留实际 exit code。
- Observability：语义检视确认 resource-limit signal 不包含 command、args、output、path 或 task id。
- 整体验证：`npm run build`、`npm test`、`npm run test:contract`、`npm run lint:architecture`、`openspec validate --all --strict`。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：合并两个 MODIFIED Requirements。
- `openspec/specs/command-script-tools/spec.md`：加入迁入的 ADDED Requirement。
- `openspec/specs/bash-tool/spec.md`：移除 legacy Requirement，保留其他 Requirements。
- `openspec/designs/functions/D6-安全与治理/D6.2-执行与风险治理/FN-6.3-沙箱执行命令.md`：更新处理过程、失败结果和后台输出规格。
- `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.5-执行命令和脚本.md`：更新处理过程、结果、规格和 legacy 导航。
- `openspec/designs/features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md`：补充后台输出容量保证。
- `openspec/overview.md`：提炼后台执行资源必须有界的不变量。
- `openspec/designs/modules/agent-platform-gateway-local.md`：更新后台 pipe、文件写入和 completion owner。
- `openspec/designs/modules/agent-capability.md`：更新 Bash Python mode guard。
- `openspec/designs/architecture/`：无新增公共架构边界。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：删除来源 legacy Requirement 导航并更新验证入口。

## 风险与取舍（Risks / Trade-offs）

- 父进程转发 pipe 会增加有限的数据复制，但每个文件最多 10 MiB，且只有后台本地 sandbox 使用，换取严格磁盘容量保证。
- destroy pipe 保证文件不继续增长；通用派生进程生命周期治理仍保持非目标，避免把本次磁盘修复扩大为跨平台进程管理项目。

## 待确认问题（Open Questions）

无。
