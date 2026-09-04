# `add-long-term-memory-import-export` 规格审查

## 审查结果

- Change：`add-long-term-memory-import-export`
- 检查日期：2026-08-08
- 状态：PASS

## Findings

| ID | 严重级别 | 领域 | 问题 | 处理结果 |
|---|---|---|---|---|
| SR-1 | MEDIUM | 证据一致性 | 旧审查报告仍描述忽略筛选的历史导出范围，并记录过期测试数量。 | 已按当前筛选导出、本地化、完整列和 CSV 注入防护目标重写本报告。 |
| SR-2 | LOW | 术语一致性 | proposal 背景残留“导出全部个人记忆”，design 刷新计划残留旧“量化指标”字段名。 | 已分别收敛为“按当前筛选导出个人记忆”和 Function“规格”。 |

无未解决的 BLOCKER、HIGH、MEDIUM 或 LOW finding。

## 需群内确认

None。未修改或隐含变更 `agent-contracts`、public Web DTO、Gateway contract、Owner Scope 或 Agent Scope。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | 浏览器只拥有文件解析、transient preview、筛选分页读取和 CSV 下载；服务端继续拥有准入、容量、幂等与持久化。 |
| core contracts | PASS | 继续消费既有长期记忆列表和批量新增 API，不改变冻结 contract。 |
| roadmap owner boundaries | PASS | 属于 V0 长期记忆管理收尾范围，未引入新的 runtime、channel 或 persistence owner。 |
| roadmap change rules | PASS | `FN-8.14` 可独立交付，主 owner 为 `frontend/agent-web`，目标和验收可观察。 |
| current code | PASS | `memoryTransfer.ts` 集中文件边界与 CSV 转换，`MemoryManagePage` 复用三宿主共享页面和既有 service。 |
| engineering principles | PASS | 单一 JSON 导入路径、单一筛选导出路径，无平行 DTO、配置或 speculative abstraction。 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 新增 `FN-8.14 导入和导出长期记忆` 与 `long-memory-import-export` 严格 1:1。 |
| Delta/stable operation | PASS | 目标 stable spec 尚不存在，delta 仅使用 `ADDED`。 |
| Function 变更汇总 | PASS | 按长期 Function 字段组织，字段唯一，并覆盖六个 Requirements。 |
| Function 规格 | PASS | 四项关键黑盒规格覆盖文件大小、条目数、用户设定记忆容量和筛选导出安全格式。 |
| Requirement 元数据 | PASS | 六个 ADDED Requirements 均声明“功能性需求”并至少包含一个 Scenario。 |
| 质量属性分层 | PASS | 不新增独立系统质量属性 Requirement；安全、容量和恢复为功能行为约束。 |
| 触发机制 | PASS | 用户下载模板、选择文件、确认导入或点击“导出筛选结果”均为可见触发。 |
| 输入和前置条件 | PASS | UTF-8 JSON、字段 allowlist、可信 scope、当前 Tab 与筛选条件均闭合。 |
| 输出和副作用 | PASS | transient preview、单批提交结果和安全 CSV 输出明确，确认前零写入。 |
| 核心决策逻辑 | PASS | 解析、容量、幂等、HTTP 分类、筛选分页和公式注入防护规则唯一。 |
| 存量代码基线 | PASS | design 描述现有页面、service、浏览器 helper 和服务端裁决边界。 |
| 增量实施路径 | PASS | 只修改共享前端页面、纯转换 helper、i18n 与测试。 |
| 唯一实施路径 | PASS | JSON 导入与当前个人记忆 Tab 筛选 CSV 导出各只有一条产品路径。 |
| flow 集成 | PASS | local、immersive、collaborative 复用同一页面与后端 bootstrap/transport contract。 |
| 失败和降级 | PASS | 文件整体拒绝、容量失败、4xx、结果未知和分页失败零下载均定义。 |
| 验收示例 | PASS | 覆盖 normal、边界、失败、分页、本地化与 CSV 注入 negative case。 |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec capability 只表示 Function，未与 runtime Capability 混用。 |
| canonical terminology | PASS | `USER_CHARACTERISTICS` 的中文用户可见名称统一为“个性化配置”，API 枚举保持不变。 |
| BCP 14 规范关键词 | PASS | 规范义务只在 Requirement 中使用全大写关键词。 |
| 语义闭合 | PASS | 主体、条件、输入、输出、副作用和失败证据均可唯一判断。 |
| 量词与可测量边界 | PASS | 5 MiB、1..50 条、10 个标签、limit 100 和 17 列均有边界。 |
| scenario-to-test 来源 | PASS | 页面测试断言可见 DOM/API 参数，helper 测试断言输出 CSV，无私有实现断言。 |
| 黑盒/白盒边界 | PASS | spec 不定义 owner 私有调用；design 承载浏览器 helper、分页和锁机制。 |
| 端到端追踪 | PASS | `F-8.2 → FN-8.14 → Requirements → Scenarios → tasks/tests` 可双向定位。 |

## 验证

- `openspec validate add-long-term-memory-import-export --strict`：PASS。
- `npx vitest run tests/memoryTransfer.test.ts tests/i18n.test.ts --reporter=dot`：30/30 PASS。
- `npx vitest run tests/MemoryManagePage.test.tsx -t "export|导出|lock" --reporter=dot`：相关测试 PASS。
- `frontend/agent-web npm run build`、`npm run build:vite:modes`：PASS。
- `npm run lint:architecture`：46 个文件、291 个测试 PASS。
- `git diff --check`：PASS。
- `openspec validate --all --strict`：本 change PASS；两个无文件交集的既有 active changes 因缺少 delta 失败。

## 建议下一步

按 design 的“长期基线刷新计划”同步 stable spec、`FN-8.14`、`F-8.2`、overview、memory architecture、agent-web/agent-channel-web module design 和 spec-to-design-map，随后归档。
