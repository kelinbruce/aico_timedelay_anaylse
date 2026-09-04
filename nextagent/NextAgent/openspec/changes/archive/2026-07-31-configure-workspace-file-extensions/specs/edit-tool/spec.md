## ADDED Requirements

### Requirement: Edit file extension authorization

Edit SHALL 在检查目标存在性、full-Read snapshot、字符串匹配或读取内容之前，使用当前 accepted Agent/version 的写入 extension policy 按 deny-first 顺序检查已规范化目标文件名。比较和无后缀语义 MUST 与 Read 相同。未授权目标 MUST 以 `CAPABILITY_PATH_REJECTED` 安全失败，不得读取或修改文件，也不得泄漏目标是否存在或字符串是否匹配。该 extension-policy failure MUST 作为可恢复 Tool observation 返回模型，MUST NOT 直接终止 Agentic loop 或把 request/run 提交为 terminal failure。

#### Scenario: Rejected extension can be corrected in the same loop
- **WHEN** 模型先调用 Edit 编辑未授权后缀，随后根据安全错误选择允许的文件操作
- **THEN** 首次调用 SHALL 返回 `CAPABILITY_PATH_REJECTED`，同一 request/run SHALL 保持可执行并继续处理后续 Tool call

#### Scenario: Rejected extension is projected to the corresponding Tool Calling result
- **WHEN** Edit rejects a target through the workspace extension policy
- **THEN** the stream SHALL include a `CAPABILITY_RESULT_DELTA` correlated by the same `toolCallId`, containing the safe failure status, code, category, and non-sensitive extension-policy summary so the browser can attach the error to that Tool Calling result
- **AND** the result projection SHALL NOT expose the target path, configured extension lists, file existence, matched text, or file content

#### Scenario: Allowed extension can be edited
- **WHEN** 写入 allowlist 为 `[".yaml"]` 且目标最终后缀为 `.yaml`
- **THEN** Edit SHALL 在满足既有目录、full-Read、唯一匹配和大小约束后执行替换

#### Scenario: Disallowed extension is rejected before edit preconditions
- **WHEN** 写入 allowlist 为 `[".yaml"]` 且目标为 `workspace/script.sh`
- **THEN** Edit SHALL 返回 `CAPABILITY_PATH_REJECTED`，不得通过 snapshot 或字符串匹配错误泄漏目标事实且不得改变文件

#### Scenario: Edit requires independent read and write authorization
- **WHEN** 写入 allowlist 允许 `.yaml`，但读取 allowlist 不允许 `.yaml`
- **THEN** Read SHALL 无法为 `workspace/config.yaml` 建立 full-Read snapshot，Edit SHALL 保持既有 `EDIT_REQUIRES_FULL_READ` 前置条件且不得修改文件

#### Scenario: Edit denylist overrides allowlist
- **WHEN** `.yaml` 同时位于写入 allowlist 和 denylist，且已存在历史 snapshot
- **THEN** Edit SHALL 返回 `CAPABILITY_PATH_REJECTED` 且不得读取或修改目标
