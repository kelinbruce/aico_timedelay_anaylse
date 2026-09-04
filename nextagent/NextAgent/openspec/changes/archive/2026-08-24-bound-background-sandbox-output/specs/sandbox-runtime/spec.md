## Function

- **所属 Function**：`FN-6.3 沙箱执行命令`（sandbox-runtime）
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: Sandbox Failure And Resource Limits Are Explicit

Sandbox 不可用、governance rejection、policy denial、timeout、cancellation、command failure、output too large 和 resource exceeded MUST 产生显式安全失败。系统 MUST 区分 sandbox governance rejection 与真正的 sandbox execution unavailable，MUST NOT 在 sandbox 失败时回退为 unsandboxed local execution。

本地后台 sandbox 进程写入 workspace 的 stdout 文件和 stderr 文件 MUST 分别使用固定 `10,485,760 bytes` 上限。文件累计写入恰好等于上限时 MUST 允许进程继续；任一通道收到第一个超过上限的字节时，系统 MUST 只把该 chunk 位于剩余容量内的顺序前缀写入文件，MUST NOT 把任何超限字节写入任一 workspace 输出文件，MUST 停止后续 stdout/stderr 落盘并终止根进程。该上限 MUST 由 local sandbox gateway 持有，MUST NOT 从请求、Capability 参数、模型输出或客户端 metadata 配置。

输出超限后的 background completion MUST 以 `exitCode=-1`、`status=FAILED` 结束。父进程向任一输出文件写入失败时，系统 MUST 同样停止两个通道的后续落盘、终止根进程并以 `exitCode=-1`、`status=FAILED` 结束，MUST NOT 让写入异常逃逸并终止宿主进程。运行期间和 completion 后，每个 stdout/stderr 文件的实际长度 MUST 均不超过 `10,485,760 bytes`。非超限且未发生写入失败的后台进程 MUST 保留实际 exit code，并按既有规则映射 `COMPLETED` 或 `FAILED`。前台 sandbox 输出语义不受本 Requirement 修改。

**需求类别**：系统质量属性
**质量属性**：性能/容量、安全、可靠性/恢复
**适用范围**：该 Function

#### Scenario: Stdout 第一个超限字节触发硬限制

- **GIVEN** 后台进程的 stdout 文件已写入不超过 `10,485,760 bytes`
- **WHEN** 下一个 stdout chunk 会使累计字节数超过该上限
- **THEN** 系统 MUST 只写入达到上限所需的顺序前缀
- **AND** stdout 和 stderr 文件 MUST NOT 再继续增长
- **AND** 根进程 MUST 被终止，completion MUST 为 `FAILED` 且 `exitCode=-1`

#### Scenario: Stderr 第一个超限字节触发相同硬限制

- **GIVEN** 后台进程的 stderr 文件已写入不超过 `10,485,760 bytes`
- **WHEN** 下一个 stderr chunk 会使累计字节数超过该上限
- **THEN** 系统 MUST 执行与 stdout 相同的停止落盘、终止和失败语义
- **AND** stdout 和 stderr 文件 MUST 均不超过 `10,485,760 bytes`

#### Scenario: 恰好达到上限不触发失败

- **WHEN** 后台进程的一个输出文件累计写入恰好 `10,485,760 bytes` 后以 exit code 0 结束
- **THEN** 系统 MUST 保留该文件的全部字节
- **AND** MUST NOT 仅因达到边界把 completion 标记为 `FAILED`

#### Scenario: 后台输出文件写入失败安全收敛

- **WHEN** 父进程向 stdout 或 stderr 文件写入 chunk 时发生异常
- **THEN** 系统 MUST 停止两个通道的后续落盘并终止根进程
- **AND** completion MUST 为 `FAILED` 且 `exitCode=-1`
- **AND** 写入异常 MUST NOT 从异步输出回调逃逸并终止宿主进程

#### Scenario: Sandbox governance rejection 保持可区分

- **WHEN** sandbox 因调用参数或治理策略拒绝执行
- **THEN** capability result MUST 使用 validation 或 governance safe failure
- **AND** MUST NOT 把该结果映射为真正的 sandbox unavailable

#### Scenario: Genuine sandbox startup failure 保持 unavailable

- **WHEN** sandbox 在没有 governance rejection reason 时无法启动
- **THEN** capability result MUST 继续使用 unavailable safe failure

### Requirement: Sandbox Availability And Execution Are Observable

系统 MUST 为 sandbox execution start、completion、failure、timeout 和 resource-limit 结果产生安全 observability signal。后台输出超限 signal 的 event MUST 为 `sandbox.background.output_limit_exceeded`，其 event payload 只允许包含有界 `executableKind`、`outputChannel="stdout"|"stderr"`、`limitBytes=10485760` 和 `failureStage="SANDBOX_BACKGROUND_OUTPUT"`。后台输出文件写入失败 signal 的 event MUST 为 `sandbox.background.output_write_failed`，其 event payload 只允许包含相同的 `executableKind`、`outputChannel`、`failureStage` 和 operational diagnostic 专用的 canonical `rawExceptionData`，不得包含 `limitBytes`。这两个 signal MUST NOT 包含 raw command、arguments、stdout、stderr、credential、task id 或其他高基数字段；host path 只允许由 `rawExceptionData` 按 canonical operational diagnostic 的有界与窄匹配脱敏规则承载，MUST NOT 进入其他字段或外部投影。

**需求类别**：系统质量属性
**质量属性**：可诊断性、安全、审计/可追溯性
**适用范围**：该 Function

#### Scenario: 后台输出超限产生安全诊断

- **WHEN** stdout 或 stderr 收到第一个超过固定上限的字节
- **THEN** 系统 MUST 产生恰好一次 `sandbox.background.output_limit_exceeded` signal
- **AND** `outputChannel` MUST 标识最先触发上限的通道
- **AND** `limitBytes` MUST 为 `10485760`
- **AND** signal MUST NOT 包含命令、参数、输出内容、宿主路径、credential 或 task id

#### Scenario: 一般 sandbox 失败继续可观察

- **WHEN** sandbox execution 失败、超时或被取消
- **THEN** 系统 MUST 继续产生符合既有 redaction 边界的安全 diagnostics 或 metrics

#### Scenario: 后台输出文件写入失败产生安全诊断

- **WHEN** 父进程向 stdout 或 stderr 文件写入 chunk 时发生异常
- **THEN** 系统 MUST 产生恰好一次 `sandbox.background.output_write_failed` signal
- **AND** signal MUST 只包含该 event 允许的有界分类字段和 canonical `rawExceptionData`

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：本地后台 sandbox 通过父进程受控写入分别限制 stdout/stderr 文件；第一个超限字节触发停止落盘、根进程终止、明确失败和单次安全观测。
- **依据 Requirements**：`Sandbox Failure And Resource Limits Are Explicit`、`Sandbox Availability And Execution Are Observable`

### 结果

- **变更类型**：修改
- **目标内容**：后台输出超限固定返回 `FAILED` 与 `exitCode=-1`，两个输出文件始终不超过各自上限。
- **依据 Requirements**：`Sandbox Failure And Resource Limits Are Explicit`

### 规格

| 规格项 | 变更类型 | 原规格值 | 目标规格值 | 依据 Requirements |
|---|---|---|---|---|
| 后台 stdout/stderr 文件上限 | 新增 | 未定义 | 每个文件分别 `10,485,760 bytes`；恰好达到允许，第一个超限字节触发失败 | `Sandbox Failure And Resource Limits Are Explicit` |
