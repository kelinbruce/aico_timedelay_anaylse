## 1. Tool 契约与目录

- [x] 1.1 通过 `defineTool` 定义 PascalCase 的 `Edit` 输入/输出 schema、`NON_IDEMPOTENT` 元数据和 `workspaceFiles` 必需依赖
- [x] 1.2 在自有 builtin Tool 列表中显式注册 `Edit`
- [x] 1.3 在 capability package index 中为 Edit schema 和 Tool 定义新增 barrel exports

## 2. Workspace File Port 扩展

- [x] 2.1 在 `tool-spi.ts` 的 `WorkspaceFilePort` 接口中新增 `editText` 方法
- [x] 2.2 在 `workspace-file-port.ts` 中实现 `editText`，包含输入校验、路径安全、snapshot guard、字符串匹配、替换、编码保持和原子写入
- [x] 2.3 新增辅助函数 `findAllMatches` 和 `replaceMatches`，用于精确字符串替换逻辑
- [x] 2.4 更新所有测试文件中的 mock/stub `WorkspaceFilePort` 实现，使其包含 `editText`

## 3. Edit 校验与执行

- [x] 3.1 校验必需输入字段：`file_path`、`old_string`（非空）、`new_string` 已定义、`old_string !== new_string`
- [x] 3.2 通过带 write 操作的 `resolveTarget` 和 `assertPathHasNoLinks` 实现路径安全
- [x] 3.3 对不存在的文件实现 `EDIT_TARGET_MISSING`
- [x] 3.4 实现 Read-before-Edit snapshot guard：`EDIT_REQUIRES_FULL_READ` 和 `EDIT_TARGET_CHANGED`
- [x] 3.5 实现 `findAllMatches` 用于精确检测 `old_string` 出现位置
- [x] 3.6 实现 `EDIT_STRING_NOT_FOUND`、`EDIT_STRING_NOT_UNIQUE` 和 replace_all 语义
- [x] 3.7 通过 `DecodedText` 实现编码保持（UTF-8/UTF-8 BOM/UTF-16 LE/UTF-16 BE）
- [x] 3.8 对编码后的编辑内容强制执行 `workspaceFiles.maxTextBytes`
- [x] 3.9 通过临时文件 + rename 实现原子替换
- [x] 3.10 在替换前立即重新检查目标状态，并以 `EDIT_TARGET_CHANGED` 使过期写入失败

## 4. Snapshot 生命周期

- [x] 4.1 在 Read、Write 和 Edit 之间共享 snapshot store
- [x] 4.2 Edit 成功后更新 snapshot
- [x] 4.3 支持 `clearRun` 在清除 Write snapshot 的同时清除 Edit snapshot

## 5. 验证

- [x] 5.1 新增 unit test：schema 规范性（PascalCase，file_path 而非 path/filePath）
- [x] 5.2 新增 unit test：文件不存在 → `EDIT_TARGET_MISSING`
- [x] 5.3 新增 unit test：必需字段校验 → `CAPABILITY_INPUT_INVALID`
- [x] 5.4 新增 unit test：唯一匹配替换 → 成功并返回 replaced_count
- [x] 5.5 新增 unit test：replace_all 全局替换 → 成功并返回 replaced_count
- [x] 5.6 新增 unit test：无 replace_all 且不唯一 → `EDIT_STRING_NOT_UNIQUE`
- [x] 5.7 新增 unit test：未找到 → `EDIT_STRING_NOT_FOUND`
- [x] 5.8 新增 unit test：缺少 Read snapshot → `EDIT_REQUIRES_FULL_READ`
- [x] 5.9 新增 unit test：Read snapshot 过期 → `EDIT_TARGET_CHANGED`
- [x] 5.10 新增 unit test：在 write 目录之外编辑 → `CAPABILITY_PATH_REJECTED`
- [x] 5.11 新增 unit test：编码保持
- [x] 5.12 新增 unit test：编辑结果超过 `workspaceFiles.maxTextBytes` → `CAPABILITY_INPUT_INVALID`
- [x] 5.13 新增 unit/concurrency test：来自同一完整 Read snapshot 的并发 Edit 只有一个成功
- [x] 5.14 新增 unit test：clearRun 清除 snapshot
- [x] 5.15 在 tool-framework 和 skill-tool 测试中新增 mock `editText` stub
- [x] 5.16 运行完整测试套件：`npm test` 通过
