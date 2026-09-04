## ADDED Requirements

### Requirement: Write file extension authorization

Write SHALL 在检查目标存在性、full-Read snapshot 或写入内容之前，使用当前 accepted Agent/version 的写入 extension policy 按 deny-first 顺序检查已规范化目标文件名。比较和无后缀语义 MUST 与 Read 相同。未授权目标 MUST 以 `CAPABILITY_PATH_REJECTED` 安全失败，不得创建、覆盖或读取文件，也不得泄漏目标是否存在。该 extension-policy failure MUST 作为可恢复 Tool observation 返回模型，MUST NOT 直接终止 Agentic loop 或把 request/run 提交为 terminal failure。

#### Scenario: Rejected extension does not terminate the Agentic loop
- **WHEN** 模型先调用 Write 写入未授权后缀，随后根据安全错误调用允许后缀
- **THEN** 首次调用 SHALL 返回 `CAPABILITY_PATH_REJECTED`，同一 request/run SHALL 继续下一轮并允许后续合法 Tool call 完成

#### Scenario: Rejected extension is projected to the corresponding Tool Calling result
- **WHEN** Write rejects a target through the workspace extension policy
- **THEN** the stream SHALL include a `CAPABILITY_RESULT_DELTA` correlated by the same `toolCallId`, containing the safe failure status, code, category, and non-sensitive extension-policy summary so the browser can attach the error to that Tool Calling result
- **AND** the result projection SHALL NOT expose the target path, configured extension lists, file existence, or file content

#### Scenario: Allowed extension can be created or overwritten
- **WHEN** 写入 allowlist 为 `[".json"]`、denylist 缺省且目标最终后缀为 `.json`（大小写任意）
- **THEN** Write SHALL 在满足既有目录、大小和 full-Read 约束后执行既有 create/update 行为

#### Scenario: Disallowed extension is rejected before snapshot check
- **WHEN** 写入 allowlist 为 `[".json"]` 且目标为现有 `workspace/config.yaml`
- **THEN** Write SHALL 返回 `CAPABILITY_PATH_REJECTED`，不得通过 `WRITE_REQUIRES_FULL_READ` 暴露文件存在性且不得改变文件

#### Scenario: Empty write extension list disables Write targets
- **WHEN** 写入 allowlist 显式为空数组
- **THEN** Write SHALL 拒绝所有文件目标，即使 `writeDirectories` 授权该目录

#### Scenario: Write denylist overrides allowlist
- **WHEN** `.json` 同时位于写入 allowlist 和 denylist，且目标为 `workspace/config.json`
- **THEN** Write SHALL 返回 `CAPABILITY_PATH_REJECTED` 且不得创建或改变文件
