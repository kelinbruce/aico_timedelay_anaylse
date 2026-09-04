## 验证结果

### test:unit

全部 14 个 Edit tool 测试通过。完整 workspace 测试套件以 `npm test` 通过。

### test:contract

Tool contract 已验证：
- Edit 以 PascalCase `Edit` 注册在 builtin tool 列表中
- `inputSchema` 要求 `["file_path", "old_string", "new_string"]` 且 `additionalProperties: false`
- `outputSchema` 要求 `["file_path", "type", "old_string", "new_string", "replaced_count"]`
- `replayPolicy: "NON_IDEMPOTENT"`
- `requiredDependencies: ["workspaceFiles"]`

### test:integration

基于 snapshot 的新鲜度 guard 已验证：
- Read → Edit 成功（snapshot 有效）
- 未 Read 直接 Edit 失败，返回 `EDIT_REQUIRES_FULL_READ`
- Read → 外部修改 → Edit 失败，返回 `EDIT_TARGET_CHANGED`
- 来自同一完整 Read snapshot 的并发 Edit 尝试只允许一个成功，过期替换以 `EDIT_TARGET_CHANGED` 失败
- Read → Edit 成功 → 不重新 Read 直接 Write 成功（snapshot 共享）
- Read → clearRun → Edit 失败，返回 `EDIT_REQUIRES_FULL_READ`

### test:security

安全边界已验证：
- 在 `writeDirectories` 之外 Edit 失败，返回 `CAPABILITY_PATH_REJECTED`
- 不存在的文件失败，返回 `EDIT_TARGET_MISSING`
- 非法输入被拒绝，返回 `CAPABILITY_INPUT_INVALID`
- 编辑后内容超过 `workspaceFiles.maxTextBytes` 失败，返回 `CAPABILITY_INPUT_INVALID`
- 内容和宿主路径不会泄漏到错误输出中

### lint:architecture

- Edit Tool 不直接 import `node:fs` 或宿主文件系统 API
- 所有文件系统访问都通过 `workspaceFiles` 依赖委派
- 未引入循环依赖
