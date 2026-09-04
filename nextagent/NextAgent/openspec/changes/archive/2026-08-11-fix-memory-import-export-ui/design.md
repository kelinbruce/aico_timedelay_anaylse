## 设计范围

| Function | 目标变化 | Delta spec | 设计章节 |
|---|---|---|---|
| `FN-8.14 导入和导出长期记忆` | 简化容量反馈，区分新文件批次与未知结果重试，按个人 Tab 区分导出呈现。 | `long-memory-import-export` | [`FN-8.14 导入和导出长期记忆`](#fn-814-导入和导出长期记忆) |

删除后保持当前页和只读绝对路径脱敏是 `FN-8.15 管理长期记忆` 既有分页、当前 Tab 重载和内容保护契约的实现修复，不改变该 Function 的目标 Requirements。本设计只记录其与同一页面路径的实现协作，不建立第二个 spec owner。

## `FN-8.14 导入和导出长期记忆`

### 目标与规范依据

用户应能直接理解个人导入余量，主动再次选择相同文件时应形成新批次，未知结果的原样重试仍应安全幂等；个人与归档导出应准确表达当前操作对象。

#### 本 Function 的目标 Requirements

canonical spec：`long-memory-import-export`

- `MODIFIED`：`上传后必须预览、删除并确认导入`
- `MODIFIED`：`确认导入必须调用批量新增接口`
- `MODIFIED`：`导入结果必须准确报告部分成功和中断进度`
- `MODIFIED`：`筛选导出必须安全读取当前个人记忆结果`

### 当前实现

- 导入 helper 以完整文件 SHA-256 和元素序号生成幂等键，导致字节相同的文件跨用户选择复用同一批次身份。
- 页面当前使用“我的记忆”和“已归档”的未过滤总数计算已有数，使智能沉淀等非 `CONFIGURED` 记忆错误占用个人导入容量提示；同时容量提示曾混入待导入数量、超额数量和删除引导，客户端容量失败会阻止确认。
- 导出在两个个人 Tab 共用“导出筛选结果”和“已导出个人记忆”文案，共享 Tab 仍渲染一个禁用按钮。
- 删除成功调用通用刷新函数，该函数同步把页码重置为第一页。
- 共享展示 helper 的绝对路径匹配被后续提交删除，但对应安全规格和行为测试仍要求 Unix/Windows 宿主绝对路径投影为 `[REDACTED_PATH]`。

### GAP 分析

| 目标 | 当前事实 | GAP |
|---|---|---|
| 再次选择相同文件是新批次 | 文件 hash 是跨选择稳定身份 | 用户无法主动再次新增。 |
| 未知结果重试保持精确幂等 | 稳定文件 hash 可复用 | 需要把复用范围收窄到当前待处理批次。 |
| 容量提示只表达上限、已有和可导入数 | 提示包含待导入、超额和删除引导 | 描述与目标不一致。 |
| 导出说明当前 Tab | 两个 Tab 共用文案 | 已归档结果语义不明确。 |
| 删除后保留页码 | 通用刷新重置页码 | 后续页操作上下文丢失。 |
| 只读展示不暴露宿主绝对路径 | helper 不再执行路径替换 | 列表、详情和复制路径违反既有安全规格。 |

### 修改方案

1. `PendingMemoryImport` 在每次文件成功解析后保存由 `crypto.randomUUID()` 生成的 `importBatchId`。`toBatchCreateItem` 使用 schema 版本、批次 ID 和原文件 `sourceIndex` 生成幂等键。删除预览项不改变剩余条目的键；结果未知时保留整个 pending 对象，因此精确重试复用同一批次 ID；重新选择文件会生成新 ID。
2. 页面通过现有长期记忆列表接口分别读取 `state = ACTIVE` 与 `state = ARCHIVED`、`knowledgeSourceType = CONFIGURED` 的总数并相加；查询固定使用 `limit = 1`、`offset = 0`，不下载无关记录。可导入数固定为 `max(0, 50 - existing)`。`LEARNED` 等非个人设定记忆不计入该容量；容量读取只提供反馈，不替代或阻断服务端最终容量和安全准入。
3. 成功和部分成功提示只报告处理数量，不再承诺相同文件跨批次去重。未知结果提示继续明确记录可能已写入，并允许原样重试。
4. 个人 Tab 分别使用“导出我的记忆”和“导出归档的记忆”；成功提示分别说明实际导出的“我的记忆”或“已归档的记忆”数量。共享 Tab 不渲染个人导出操作。读取、分页、CSV 生成和注入防护保持不变。
5. 删除成功不调用会执行 `setPage(0)` 的通用刷新函数，而是调用当前闭包中的 `loadList()` 和 `loadCounts()`。若删除导致当前页为空，既有 `items.length === 0 && page > 0 && page * pageSize >= total` 校正会把页码收敛到最后一个有效页，并由依赖变化触发新请求。
6. 不修改 `memoryService` Web contract、服务端容量门禁、Owner Scope、Agent Scope、任何宿主入口或持久化边界；local、immersive、collaborative 继续复用同一 `MemoryManagePage`。
7. 在 Chat 与 Memory 共用的 `redactSensitiveDisplayText` 中恢复原有 `absolutePathPattern` 和 `[REDACTED_PATH]` 替换；URL、相对路径和 IP 地址的既有可见语义保持不变。

#### 质量属性影响

| 质量属性 | 规范依据 | 实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | `确认导入必须调用批量新增接口`、`导入结果必须准确报告部分成功和中断进度` | 批次 ID 的生命周期与 pending 预览一致，未知结果不替换 ID。 | 同批次重试键相同，新选择相同文件键不同。 |
| 可维护性 | 四个 MODIFIED Requirements | 容量计算和导出文案都由单一当前页面状态派生。 | 中英文 key 对齐，不保留未使用的旧文案和变量。 |
| 可测试性 | 四个 MODIFIED Requirements | 页面测试断言用户可见提示、请求键和分页 offset。 | 正常、边界和未知结果路径均可重复触发。 |

## 验证策略

- `memoryTransfer.test.ts` 验证批次内原序号稳定以及不同批次键不同。
- `MemoryManagePage.test.tsx` 验证容量提示、容量读取失败仍由服务端裁决、同文件新批次、未知结果精确重试、个人/归档/共享导出呈现和后续页删除。
- `i18n.test.ts` 验证中英文资源 key 对齐且不再包含相同文件去重承诺。
- `redactPathsInText.test.ts`、`redaction-presentation-consistency.test.tsx` 和 `MemoryManagePage.test.tsx` 验证宿主绝对路径脱敏且 URL、相对路径和 IP 保持可见。
- `frontend/agent-web` TypeScript/Vite build 验证共享页面在构建边界内可用；multi-host 构建验证三宿主复用不回归。
- `openspec validate --all --strict` 验证 delta 结构和仓库规格一致性；仓库范围既有失败必须与本 change 区分记录。

## 长期基线刷新计划

- stable spec：归档前把四个 MODIFIED Requirements 合并到 `openspec/specs/long-memory-import-export/spec.md`。
- Function：更新 `FN-8.14` 的处理过程、结果和幂等/容量规格描述。
- Feature：无。
- overview：无。
- architecture：检查 memory architecture 的导入恢复描述，仅在与新批次语义冲突时同步。
- modules：更新 `agent-web` module 中的导入批次和导出呈现说明。
- ADR：无。
- spec-to-design-map：路径不变，无新增映射。

## 风险与取舍

- 客户端容量反馈与服务端 `CONFIGURED` 容量口径保持一致，但两次读取与最终写入之间仍可能发生并发变化；服务端继续作为最终裁决。
- 新批次允许相同文件再次新增，这是明确产品目标；未知结果只在当前 pending 批次内复用键，避免网络结果不确定时重复写入。
