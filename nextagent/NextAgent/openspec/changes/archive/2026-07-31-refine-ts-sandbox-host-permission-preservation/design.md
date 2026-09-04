## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-6.3 沙箱执行命令` | 执行不再修改原始宿主权限；权限不足时安全失败，只有直接脚本的 sandbox-owned 临时副本可获得执行权限 | `sandbox-runtime`、`skill-resource-access` | `FN-6.3 沙箱执行命令` |

## 存量 Requirement 迁移方案

| 来源 spec / Requirement | 目标 Function / canonical spec | 原子 delta | 其他行为与未触及 Requirements 处理 | 白盒落点 | stable spec 与导航影响 |
|---|---|---|---|---|---|
| `skill-resource-access` / `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement` | `FN-6.3` / `sandbox-runtime` | 来源 `REMOVED` + 目标 `ADDED` | root layout、LOCAL best-effort、REMOTE/PaaS enforcement、shared-data fail-closed 与 safe error 行为完整迁入；来源其他 Requirements 原位保留 | 本 design 的 `FN-6.3 沙箱执行命令` 修改方案 | 来源 spec 保留；FN-6.3 主规格明确为 `sandbox-runtime`，`skill-resource-access` 不再承载该 Requirement |

已扫描 active changes，没有其他未协调 change 修改上述来源 Requirement 或 `sandbox-runtime` 中同名目标 Requirement。

## `FN-6.3 沙箱执行命令`

### 目标与规范依据

本设计满足沙箱执行不破坏调用方宿主权限、权限不足可安全诊断、Python 解释器不依赖脚本 execute 位，以及直接脚本只提升 sandbox-owned 临时副本权限的黑盒目标。

#### 本 Function 的目标 Requirements

canonical spec：`sandbox-runtime`

- `ADDED`：`Dynamic execution SHALL use deployment-mode-specific sandbox enforcement`
- `ADDED`：`沙箱执行必须保持宿主权限元数据`

### 当前实现

- `agent-capability` 的 workspace-backed sandbox execution port 从 `WorkspaceFilePort.sandboxFilesystem` 获取同一运行的物理 root layout，并通过 `SandboxGatewayPort` 提交 Bash/Python 请求。
- `agent-platform-gateway-local` 的 `RestrictedLocalSandboxGateway.executeInternal` 在启动前调用 `protectReadonlyRoots`。POSIX 路径递归执行 `chmodSync(path, stats.mode & ~0o222)`；Windows 路径同时应用 `icacls /deny`。
- 保护逻辑记录遍历时看到的 mode，并在 `finally` 中 best-effort 恢复。准备过程部分失败、恢复中途失败、并发快照交错或进程未执行 `finally` 时，原始权限可能残留为临时值。
- `startBackground` 不经过 `protectReadonlyRoots`，前台与后台对同一 root layout 的权限处理不一致。
- Python 文件路径执行已经通过可信解释器启动，不依赖脚本自身 execute 位。
- POSIX 直接命令路径由本地 gateway 交给 `spawn(..., { shell: false })`；不可执行文件产生 `EACCES`，当前统一映射为 sandbox unavailable，且没有受控临时副本路径。
- sandbox request 已包含 `temp` readWrite 根；Python inline script 已使用该根创建执行期文件并在结束时清理。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 原始资源宿主权限元数据始终不变 | 前台本地执行递归修改只读根 mode/ACL 后再恢复 | 必须完全移除原始路径权限修改和恢复生命周期 |
| 权限不足返回安全且可诊断的权限失败 | `EACCES`/`EPERM` 通常收口为 unavailable | 必须识别宿主权限拒绝，并映射到既有安全路径拒绝结果且不暴露绝对路径 |
| Python 脚本不要求 execute 位 | 已由可信 Python 解释器读取脚本 | 需要 characterization test 固化现有行为，不新增第二条 Python 路径 |
| 直接脚本可读但不可执行时使用临时副本 | 当前 `spawn` 原路径并失败 | 需要在 POSIX direct-execution 准备阶段对授权脚本创建 run temp 副本，并管理前台/后台 cleanup |
| 并发及全部失败结果后权限不变 | chmod 快照/恢复存在并发竞态 | 删除共享原始权限写入后，以不发生权限 mutation 消除竞态 |

### 修改方案

主要 owner 保持 `agent-platform-gateway-local`；`agent-capability` 继续只负责 sandbox request 构造、risk policy 和 safe result 映射，不改变 public port 或 contract。

唯一实施路径如下：

1. 从 `RestrictedLocalSandboxGateway.executeInternal` 删除 `protectReadonlyRoots` 包裹，删除 POSIX mode 快照/恢复、Windows ACL deny/清理、SID/utility 调用及其专用遍历逻辑。前台和后台均直接消费既有 root layout，不写原始权限元数据。
2. 保留现有 Python submission 和可信解释器解析。Python 文件脚本继续以解释器参数执行；只验证实际读取/遍历是否成功，不检查或修改脚本 execute 位。
3. 在本地 gateway 的 direct-execution 准备阶段，仅对包含路径分隔符且能通过当前 `SandboxFilesystemLayout` 解析到授权 regular file 的 POSIX command path应用以下顺序：
   - 原文件可执行：直接使用解析后的物理路径；
   - 原文件可读但因 execute 位不可执行：要求当前 request 存在 `temp` readWrite 根；复制为唯一命名的 sandbox-owned 文件，关闭写入后将临时副本设为 owner `r-x`，再执行该副本；
   - 原文件不可读、父目录不可遍历、目标不是 regular file、temp 不可用或副本创建失败：返回安全权限/path failure，不修改原始资源。
4. 执行准备结果内部增加一次性 `cleanup` callback。前台在进程结束或启动失败的 `finally` 调用；后台在 completion settle 后调用。普通 executable 和 Python 路径使用 no-op callback。cleanup 只删除本次创建的临时副本，不接触原始资源。
5. Node `EACCES`/`EPERM` 统一识别为内部 `permission-denied` rejection reason；capability 边界复用既有 `CAPABILITY_PATH_REJECTED` / `AUTHORIZATION` 安全结果，并通过 bounded `safeDetails.reason` 区分权限不足，不新增公共错误 schema。
6. workspace 写入权限由实际文件操作决定。创建后台输出、Python inline 临时文件或其他 sandbox-owned 文件遇到 `EACCES`/`EPERM` 时走同一安全权限失败；不增加 chmod、ACL、所有权或只读属性补偿。

shell composition 继续由可信 shell interpreter 路径执行；该路径不复制 command line 内部引用的脚本，也不修改其权限。直接脚本临时副本只适用于 `shell: false` 的单一 path command，避免解析 shell 文本形成第二个安全边界。

选择删除原地保护而不是增强恢复，是因为进程崩溃无法保证恢复，跨请求锁和引用计数会把共享宿主目录变成 sandbox 私有状态并扩大复杂度。真正的只读隔离继续由 REMOTE/PaaS 容器或 OS sandbox 提供。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `sandbox-runtime` / `沙箱执行必须保持宿主权限元数据` | 删除原始权限写入；临时副本具备单次 cleanup 生命周期 | 成功、非零退出、超时、取消、准备失败和并发后原始 mode/ACL 不变 |
| 安全 | `sandbox-runtime` / `Dynamic execution SHALL use deployment-mode-specific sandbox enforcement` | 继续使用可信 root layout；只复制已授权 regular file；安全错误不暴露宿主路径 | unauthorized path、不可读源、不可用 temp、symlink/special file negative cases |

## 验证策略（Verification Strategy）

- integration/characterization tests 验证前台沙箱成功、非零退出与失败准备后，Skill projection 和 shared-data 的原始 mode 不变。
- concurrency test 让多个执行并发引用同一只读根，断言执行期间和完成后的原始权限无变化。
- unit/integration tests 验证 Python 可读但不可执行脚本继续通过解释器成功，且原 mode 不变。
- POSIX integration tests 验证 direct path 脚本不可执行时使用 temp 副本成功；原脚本不变，副本仅位于授权 temp 且结束后清理。
- negative tests 实际触发 workspace/temp `EACCES` 或 `EPERM`，断言 bounded safe permission result，并确认没有原地权限提升。
- architecture/source assertion 仅用于禁止 sandbox product path 重新引入对原始 root 的 `chmod`/`icacls` 权限保护；行为正确性仍由黑盒测试承担。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/sandbox-runtime/spec.md`：迁入 deployment-specific enforcement Requirement，并增加宿主权限保持契约。
- `openspec/specs/skill-resource-access/spec.md`：移除迁出的 dynamic execution Requirement，其他 Requirements 保留。
- `openspec/designs/functions/D6-安全与治理/D6.2-执行与风险治理/FN-6.3-沙箱执行命令.md`：刷新描述、处理过程、结果和主/遗留规格导航。
- `openspec/designs/features/D6-安全与治理/D6.2-执行与风险治理/F-6.3-沙箱执行.md`：补充不修改原始宿主权限的用户可依赖保证。
- `openspec/overview.md`：补充本地 sandbox 不修改调用方权限的长期背景。
- `openspec/designs/architecture/runtime-boundaries.md`：明确 LOCAL best-effort 与平台强隔离边界。
- `openspec/designs/modules/agent-platform-gateway-local.md`：刷新本地执行准备、临时副本和权限失败映射。
- ADR：无；本 change 收敛既有 sandbox owner，不引入新的跨模块决策。
- `openspec/designs/spec-to-design-map.md`：刷新 `sandbox-runtime` 与 `skill-resource-access` 的职责和验证导航。

## 风险与取舍（Risks / Trade-offs）

- 删除 LOCAL chmod/ACL 后，普通本地进程可能写入其宿主身份本来可写的 read root。缓解方式是明确 LOCAL 仅 best-effort；强隔离部署必须使用 OS、容器或远端 sandbox。
- direct script 临时副本可能改变脚本基于自身路径定位相邻资源的行为。该 fallback 只处理单文件直接执行；依赖相邻资源的脚本应通过解释器或已有授权 Skill root 执行，失败时返回安全结果。
- cleanup 可能在进程崩溃后留下 sandbox-owned 临时副本，但不会改变原始资源；现有 run temp cleanup 生命周期负责后续清理。

## 待确认问题（Open Questions）

无。
