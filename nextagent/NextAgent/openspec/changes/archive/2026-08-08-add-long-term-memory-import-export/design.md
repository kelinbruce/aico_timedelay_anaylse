## 设计范围

- `FN-8.14 导入和导出长期记忆`：新增 JSON 模板导入、预览确认、容量提示、单批幂等提交和个人记忆筛选 CSV 导出；delta spec 为 `long-memory-import-export`，设计见“`FN-8.14 导入和导出长期记忆`”。

本变更不迁移 legacy Requirement，不修改长期记忆 API v2、Gateway contract、可信 scope 或服务端容量与持久化 owner。

## `FN-8.14 导入和导出长期记忆`

### 目标与规范依据

用户可以通过固定 JSON 模板批量准备记忆，在任何写入前检查、删除和确认，并在明确的容量与恢复语义下提交；用户还可以导出当前个人记忆 Tab 的完整筛选结果。

本 Function 的目标 Requirements 位于唯一 canonical spec `long-memory-import-export`：

- `ADDED`：`记忆导入必须使用固定 JSON 模板`
- `ADDED`：`批量导入必须在不可信 JSON 边界完成前置校验`
- `ADDED`：`上传后必须预览、删除并确认导入`
- `ADDED`：`确认导入必须调用批量新增接口`
- `ADDED`：`导入结果必须准确报告部分成功和中断进度`
- `ADDED`：`筛选导出必须安全读取当前个人记忆结果`

### 当前实现

- `frontend/agent-web` 的长期记忆页面和 `memoryService` 已消费长期记忆列表与批量新增 REST API；immersive 与 PIU 使用同一个页面实现。
- 文件转换集中在 `src/features/memory/memoryTransfer.ts`，页面拥有浏览器 transient view state，服务层只投影 REST request/response。
- 后端已经负责 runtime schema validation、可信 scope 注入、内容安全护栏、ACTIVE/ARCHIVED 合计 50 条 `CONFIGURED` 容量限制和持久化幂等。
- 现有导入接受 Excel/CSV 并在选取文件后提交；现有导出按 ACTIVE/ARCHIVED 分页生成 CSV。

### GAP 分析

- 现有文件契约不便于用户复制编辑，也不能携带批量 API 已支持的完整可选字段。
- 现有流程缺少写入前预览、逐项删除、容量可见性和清空后的重复选取入口。
- 结果提示未完整区分首次创建与幂等命中、明确 HTTP 拒绝与网络结果未知。
- 预览中的长摘要、正文、类型和标签缺少紧凑且可查看完整内容的投影。
- 现有 CSV 导出忽略当前 Tab 和筛选，表头与枚举固定为英文，缺少更新时间，并且公式保护只识别半角首字符，不能覆盖全角或前导控制字符绕过。

### 修改方案

1. `memoryTransfer.ts` 使用 fatal UTF-8 解码和严格 allowlist 解析不超过 5 MiB 的 `.json`。顶层接受纯数组或只含 `_instructions`、`memories` 的模板对象；完整校验通过后才产生可提交条目。
2. 模板固定下载为 `nextagent-memory-import-template.json`，按当前 locale 生成中英文说明和四类电信运维示例。locale 只影响说明与示例，不改变字段、枚举、默认值或请求契约。
3. `briefIndex`、`content` 直接映射；空 `memoryType`、`labels`、`confidence` 分别投影为 `USER_CHARACTERISTICS`、空数组、`1`。请求固定使用 `knowledgeSourceType = CONFIGURED`、`state = ACTIVE`。
4. 页面保存文件名、完整文件 SHA-256 和不可变 `sourceIndex`。幂等键为 `ltm-import-json-v2-<fileHash>-<sourceIndex>`；删除条目不改变其余条目的身份。
5. 合法文件打开 transient preview。标题行紧凑展示摘要、类型、标签和百分比置信度，正文两行省略；被省略文本通过 `title` 保留完整值。清空列表后复用同一隐藏 file input 重新选择文件，并在每次处理后清空 input value。
6. 打开预览和首次确认时分别查询 ACTIVE、ARCHIVED 的 `CONFIGURED` total。正常状态显示 `50 - existing - pending` 条仍可新增容量；超限或查询失败禁止首次确认。客户端检查只提供反馈，服务端继续最终裁决。
7. 确认后调用一次 `batchCreateLongTermMemory` 并保持原文件顺序。HTTP 4xx 作为明确拒绝；404 明确提示后端未同步 route；网络、5xx 或畸形成功响应保留原集合并进入结果未知精确重试。
8. 导出只读取当前个人记忆 Tab：`mine` 固定 `state=ACTIVE`，`expiring` 固定 `state=ARCHIVED`，并携带当前合法 `queryText`、`memoryType`、`knowledgeSourceType` 与 `isPinned`；从 offset 0、limit 100 读取完整筛选结果，忽略当前页码。共享 Tab 不导出。所有分页成功后才生成 UTF-8 BOM CSV。
9. CSV 表头、`memoryType`、`knowledgeSourceType` 和 `state` 使用点击导出时的当前 locale；列固定包含记忆类型、摘要、正文、置信度、记忆来源、状态、更新时间和 10 个标签列。更新时间按 locale 格式化。公式注入检测对单元格建立 NFKC 规范化视图，跳过前导空白、C0/C1 控制字符和字面 `/u0000`、`\\u0000` 标记后识别 `= - + @` 及其全角形式；命中时在原始值前增加文本前缀，不改变用户数据本身。
10. 页面使用单一文件操作锁。导入执行期间禁用确认、删除、取消及其它写操作；预览为空时只开放重新选择文件。

明确不修改：`agent-contracts`、Web API wire schema、`agent-memory` 准入、Gateway persistence、local 宿主入口及共享记忆 API。

失败路径：文件错误整体拒绝且零写入；容量读取失败禁止首次确认；明确服务端拒绝保留预览但不标记未知；结果未知保留原集合和幂等键；任一导出分页失败不下载文件。

#### 质量属性影响

无新增黑盒质量目标。安全、性能/容量、可靠性/恢复、可维护性和可测试性机制均由本 Function 的功能性 Requirements 派生：严格文件边界和权威字段 allowlist、5 MiB/50 条限制、稳定幂等重试、纯转换 helper、页面黑盒测试及多宿主构建分别验证这些机制。

## 验证策略

- 纯 helper 测试覆盖模板、UTF-8/JSON/字段边界、默认投影、稳定幂等、双语 CSV 投影和半角/全角/控制字符公式注入载荷。
- 页面测试覆盖确认前零写入、预览删除/清空/重新选择、容量 normal/boundary/failure、单 batch、HTTP 分类、结果未知重试、操作锁和中英文投影。
- service contract 测试覆盖 batch URL、请求体和响应结构校验。
- 前端 TypeScript build 与 multi-host Vite build 验证共享页面在 immersive/PIU 产物中一致。
- OpenSpec strict validate、architecture lint、diff check 和模型语义审查覆盖规范、架构、边界和禁止行为。

## 风险与取舍

- 预览到确认期间容量可能变化：确认时复检，服务端仍执行最终 50 条准入。
- 网络中断后可能已有部分写入：不自动重试；保留原集合与稳定键，由用户显式精确重试收敛。
- CSV 导出不能直接回导：页面提供 JSON 模板；导出只承担当前筛选结果的人工查看与备份。
- 浏览器内存需要保存不超过 5 MiB 的原文件和预览：上界明确且不持久化，刷新或取消即释放。

## 长期基线刷新计划

- stable spec：新增 `openspec/specs/long-memory-import-export/spec.md`，保留 `FN-8.14` 元数据。
- Function：新增 `FN-8.14 导入和导出长期记忆`，记录描述、前置条件、输入、输出、处理过程、结果、规格、接口、覆盖特性和主规格。
- Feature：更新 `F-8.2 长期记忆` 的 Function 组成和批量迁移/备份价值边界。
- overview：补充长期记忆迁移和备份能力范围。
- architecture：更新 `openspec/designs/architecture/memory.md` 的浏览器文件边界、可信 scope 和服务端最终准入流程。
- modules：更新 `openspec/designs/modules/agent-web.md`；`agent-channel-web.md` 仅补充既有 batch route 的被消费关系。
- ADR：无。
- spec-to-design-map：增加 `long-memory-import-export` 到上述设计与验证入口的导航。
