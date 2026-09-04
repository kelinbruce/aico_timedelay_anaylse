## Why

Agent 开发者和运维人员执行 Bash、Python 或 Skill 脚本后，可能发现后续仍需使用的文件或目录无法写入。例如权限为 `0750` 的目录在执行期间变为 `0550`，异常退出、并发执行或权限恢复失败时还可能保留该结果，进而阻断 Skill 更新、workspace 写入或 shared-data 维护。沙箱执行不应通过改写调用方已有资源的权限来模拟隔离，因此需要建立不会破坏后续使用的稳定权限边界。

## 术语

- **宿主权限元数据**：调用前已存在文件或目录的 POSIX mode、Windows ACL、所有权和只读属性。
- **sandbox-owned 临时副本**：由当前沙箱执行在其授权临时根中新建、只服务于本次执行且不替代原始资源的副本。

## 目标与非目标（Goals / Non-Goals）

**目标：**

- Bash、Python、Skill 脚本和模型生成代码执行不得修改原始 Skill projection、workspace、shared-data 或其他调用方资源的宿主权限元数据。
- 权限已满足最小执行条件时直接使用原始资源；权限不足时返回安全且可诊断的权限失败。
- Python 脚本通过解释器读取时不要求脚本具有 execute 位；必须直接执行且原文件可读但不可执行时，系统使用 sandbox-owned 临时副本并只调整该副本的执行权限。
- 命令成功、非零退出、超时、取消、准备失败或并发执行后，原始资源的宿主权限元数据保持不变。

**非目标：**

- 不自动提高或降低原始 Skill projection、workspace、shared-data 或其他调用方资源的权限。
- 不新增请求字段、配置项、公共 API 或 `agent-contracts` 类型。
- 不把本地受限适配器声明为强恶意代码文件系统隔离边界；需要强只读隔离时仍由 OS、容器或远端沙箱平台提供。
- 不改变命令输出、退出码、超时、取消和后台任务生命周期契约。

## What Changes

- **修改**：沙箱执行必须保留全部调用前已存在资源的宿主权限元数据，不得对原始物理路径执行 chmod、ACL deny、所有权或只读属性变更。
- **修改**：workspace 写入缺少文件写权限或父目录写入/遍历权限时，系统返回安全权限失败，不修改目标或父目录权限。
- **修改**：Python 脚本只要求当前执行身份能够读取脚本并遍历其父目录；脚本自身缺少 execute 位不构成失败。
- **修改**：必须直接执行的脚本在原文件可读但不可执行时，系统在 sandbox-owned 临时根创建副本，只为该副本设置最小执行权限；无法安全创建或读取副本时返回安全权限失败。
- **移除**：移除 LOCAL 模式可直接对已授权只读根应用宿主 ACL/chmod 保护的行为许可。

## Feature 影响（Features）

### 修改的 Feature

- `F-6.3 沙箱执行`：用户可依赖沙箱命令执行不会改变后续运行仍需使用的宿主资源权限；Function 组成不变。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-6.3 沙箱执行命令` → `specs/sandbox-runtime/spec.md`
  - 功能边界：沙箱执行按最小权限使用原始资源，在权限不足时安全失败或执行 sandbox-owned 临时副本，并在全部结果下保持原始宿主权限元数据不变。
  - 系统质量属性：可靠性/恢复、安全、可测试性。
  - 映射说明：`sandbox-runtime` 是 canonical spec；本次触及 legacy spec `skill-resource-access` 中的 `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement` Requirement，并把其中属于沙箱执行的目标行为原子迁入 canonical spec。

## 影响范围（Impact）

- 运维侧不再出现由沙箱执行引起的 `0750` 变为 `0550`、Windows ACL deny 残留或后续资源更新与清理失败。
- 本地受限执行不再通过原地权限修改提供 best-effort 只读保护；真正的写隔离继续由部署平台的 OS、容器或远端沙箱能力承担。
- 受影响实现集中在本地 sandbox gateway 适配器、sandbox 执行准备和相关回归测试；公共 API、配置和跨 package contract 不变。
