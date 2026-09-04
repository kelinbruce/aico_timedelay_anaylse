## ADDED Requirements

### Requirement: SkillHub 远程下载包完整性校验

Concrete remote gateway adapter 在下载 SkillHub skill 包后、解压或 materialize 之前，MUST 对下载字节计算 SHA-256 hash 并与声明的 `packageHash` 比对。当远端声明了 `packageHash` 时，adapter MUST 校验 `createHash("sha256").update(packageBytes).digest("hex")` 与 `packageHash` 一致；不匹配时 MUST 返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`，MUST NOT 执行解压或 materialize。

当远端未声明 `packageHash`（`packageHash === undefined`）时，adapter MAY 跳过完整性校验以保持向后兼容。完整性校验 MUST 在 `materializeZipPackage` 之前执行，防止恶意包在解压时触发 zip bomb 或路径穿越。

校验使用 `node:crypto` 的 `createHash`，MUST NOT 引入额外依赖。校验失败 MUST 通过既有 safe error 通道返回，MUST NOT 暴露 raw package bytes、远端 URL、credential 或内部存储路径。

#### Scenario: 下载包 hash 匹配时接受

- **WHEN** 远端 SkillHub 服务返回 package bytes 和声明 hash
- **AND** 下载字节的 SHA-256 hash 与声明的 `packageHash` 一致
- **THEN** adapter MUST 继续执行 `materializeZipPackage`
- **AND** 返回 `{ status: "ok" }` 结果

#### Scenario: 下载包 hash 不匹配时安全失败

- **WHEN** 远端 SkillHub 服务返回 package bytes 和声明 hash
- **AND** 下载字节的 SHA-256 hash 与声明的 `packageHash` 不一致
- **THEN** adapter MUST 返回 `{ status: "failed", reasonCode: "invalid-response", message: "SkillHub package integrity check failed." }`
- **AND** adapter MUST NOT 执行 `materializeZipPackage`
- **AND** 失败结果 MUST NOT 暴露 raw package bytes、远端 URL 或内部存储路径

#### Scenario: 远端未声明 hash 时跳过校验

- **WHEN** 远端 SkillHub 服务返回 package bytes 但未声明 `packageHash`
- **THEN** adapter MAY 跳过完整性校验
- **AND** adapter MUST 继续执行 `materializeZipPackage`
- **AND** 返回结果 MUST 包含远端提供的其他一致性 token

#### Scenario: 校验在解压前执行

- **WHEN** adapter 下载 package bytes 并声明了 `packageHash`
- **THEN** SHA-256 校验 MUST 在 `materializeZipPackage` 调用之前完成
- **AND** 校验失败时 MUST NOT 执行解压