# `fix-memory-import-export-ui` 规格审查

## 审查结果

- Change：`fix-memory-import-export-ui`
- 检查日期：2026-08-09
- 状态：PASS

## Findings

| ID | 严重级别 | 领域 | 问题 | 处理结果 |
|---|---|---|---|---|
| SR-1 | BLOCKER | 可审查性 | proposal、design、tasks 和 delta spec 的大部分中文被替换为 `?`，结构校验虽通过但语义不可审查。 | 已按 stable spec、Function/Feature 设计和当前代码重写全部 artifact。 |
| SR-2 | HIGH | Function 归属 | 删除后保留页码被附加到 `FN-8.14`，但该行为属于 `FN-8.15` 的管理分页和当前 Tab 刷新语义。 | 作为既有 `add-ts-long-memory-manage` 契约的实现修复追踪，不建立平行 delta spec。 |
| SR-3 | HIGH | 归档一致性 | 工作区包含可从 `stash@{0}` 恢复的 `2026-08-03-add-user-query-memory-recall` 旧归档，而主分支已有 8 月 4 日最终归档；旧目录还采用不同 runtime 幂等方案且无对应代码。 | 已从本次工作区移除过期副本，保留 stash 恢复来源，不改写已归档历史。 |
| SR-4 | MEDIUM | 安全一致性 | `FN-8.15` 的只读路径脱敏规格和测试仍有效，但共享展示 helper 的绝对路径替换被单独删除。 | 按既有规格恢复原 matcher 和 `[REDACTED_PATH]` 投影，不新增行为契约。 |
| SR-5 | HIGH | 容量口径 | 导入容量反馈曾使用“我的记忆”和“已归档”的未过滤总数，使 `LEARNED` 等智能沉淀记录错误占用 50 条个人设定记忆限制。 | 规格与实现统一改为只合计 ACTIVE、ARCHIVED 的 `CONFIGURED` 总数，并增加包含非 `CONFIGURED` 记录的定向测试。 |

所有 findings 已在本次审查中关闭；无未解决的 BLOCKER、HIGH、MEDIUM 或 LOW finding。

## 需群内确认

None。未修改或隐含变更 `agent-contracts`、public Web DTO、Gateway contract、Owner Scope、Agent Scope、服务端容量门禁或持久化 owner。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | 浏览器只拥有文件选择批次、transient preview、列表页码和用户可见投影；服务端继续拥有容量、安全、幂等和持久化最终事实。 |
| core contracts | PASS | 继续消费既有长期记忆列表和批量新增 API；容量反馈仅增加既有列表查询的 `knowledgeSourceType = CONFIGURED` 过滤，无 frozen contract 变更。 |
| frontend/browser owner | PASS | 所有改动位于共享 `agent-web` 页面/helper/i18n；不拥有 request lifecycle、canonical history 或 trusted identity。 |
| multi-host consistency | PASS | local、immersive、collaborative 继续复用同一页面与 service，未建立宿主分支语义。 |
| current code | PASS | `PendingMemoryImport` 形成唯一批次生命周期；容量反馈分别读取 ACTIVE、ARCHIVED 的 `CONFIGURED` 总数，Tab 徽标仍保持未过滤展示。 |
| engineering principles | PASS | 无新增 DTO、API、配置或持久化状态；路径脱敏只恢复既有两行实现。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | `FN-8.14` 继续与 canonical `long-memory-import-export` 1:1；`FN-8.15` 仅落实既有 active change 目标。 |
| Delta/stable operation | PASS | 四个 `MODIFIED` 标题与 stable spec 精确匹配并完整表达目标状态。 |
| Requirement 元数据 | PASS | 四个 Requirements 均声明“功能性需求”并覆盖 normal、boundary、failure/degradation Scenarios。 |
| Function 变更汇总 | PASS | 按处理过程、结果和规格组织，四个 MODIFIED Requirements 均可反向追踪。 |
| proposal actor/边界 | PASS | 从长期记忆管理用户可观察问题描述目标；实现文件仅出现在影响范围。 |
| design 唯一路径 | PASS | 新文件选择生成批次 ID，同 pending 精确重试复用；不存在第二套 hash 或缓存路径。 |
| tasks 追踪 | PASS | 行为测试先于实现，分页与安全修复引用既有 `FN-8.15` Requirements，整体验证有实际结果。 |
| 失败与恢复 | PASS | 容量反馈读取失败、服务端 4xx、结果未知、导出分页失败和路径泄露均有收敛结果。 |
| 长期基线计划 | PASS | 只列归档前需要同步的 stable spec、Function、module 和 architecture 检查点。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| BCP 14 关键词 | PASS | 强制义务使用 `MUST`/`MUST NOT`，可选的再次新增使用 `MAY`。 |
| canonical terminology | PASS | “我的记忆”“已归档”“批次标识”“结果未知”在 proposal/spec/design/tasks 中一致。 |
| 数值边界 | PASS | 上限 50、`max(0, 50-X)`、批次内原文件序号和导出实际数量均可计算。 |
| 黑盒/白盒边界 | PASS | 用户可见提示、批次语义和导出范围位于 spec；React state、UUID、回调和 regex 位于 design。 |
| 端到端追踪 | PASS | `F-8.2 → FN-8.14 → 4 MODIFIED Requirements → Scenarios → tests/tasks` 可双向定位。 |

## 验证

- 本次容量口径修复（2026-08-09）：`npm exec vitest run tests/MemoryManagePage.test.tsx tests/i18n.test.ts --reporter=dot`，2 个文件、72/72 PASS。
- 本次容量口径修复（2026-08-09）：`openspec validate fix-memory-import-export-ui --strict`、前端 `npm run build`、`npm run build:vite:modes` 和 `git diff --check` 均 PASS。
- 本次容量口径修复（2026-08-09）：`openspec validate --all --strict` 为 310 PASS、3 个无本次文件交集的既有空 delta change 失败；architecture gate 的既有 `packages/agent-capability/src/builtins/api-call-tool.ts` 日志边界失败同样无本次文件交集。
- `openspec validate fix-memory-import-export-ui --strict`：PASS。
- `openspec validate --all --strict`：本 change PASS；307 项通过，3 个无文件交集的既有 active changes 因没有 delta 失败。
- 前端相关测试：5 文件、103 测试 PASS。
- `frontend/agent-web npm run build`、`npm run build:vite:modes`：PASS。
- 定向 memory Playwright：2/2 PASS；按用户要求不再运行 smoke。
- `git diff --check`：PASS。

## 建议下一步

提交实现并创建关联 #689 的 PR；完成合并与验证后，按 design“长期基线刷新计划”归档 change。
