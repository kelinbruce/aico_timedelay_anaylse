# `fix-memory-import-export-ui` 代码审查

## 审查结果

- 日期：2026-08-09
- 对比范围：`main...working-tree`
- 结论：PASS WITH FOLLOW-UP

## Findings

| ID | 严重级别 | 领域 | 问题 | 处理结果 |
|---|---|---|---|---|
| CR-1 | P1 | Security | 主分支删除绝对路径 matcher 后，记忆列表、详情和复制会显示宿主绝对路径，且 helper/page 安全测试失败。 | 恢复原有 matcher 与替换链；相关 5 个文件、103 测试全部通过。 |
| CR-2 | P1 | Runtime correctness | 初次清理容量变量时仍有 JSX 告警样式引用，导入弹框触发 `ReferenceError`。 | 恢复派生变量并重跑完整相关测试，运行时异常消除。 |
| CR-3 | P2 | Repository validation | 全量 OpenSpec 有 3 个空 delta active change；architecture 有 1 个 `agent-capability/api-call-tool.ts` runtime logging boundary 失败。 | 均无本次文件或语义交集，未在本 PR 扩大范围；在 PR 中透明披露并建议各 owner 独立修复。 |

CR-1、CR-2 已修复并复检。提交范围内无未解决 P0/P1/P2/P3 finding；结论中的 follow-up 仅针对主线既有验证失败。

## 强制维度

| 维度 | 结论 | 证据 |
|---|---|---|
| Frozen core contract | PASS | 未修改 Web API、stream event、runtime command、context/capability/gateway contract、identity 或 persistence。 |
| Architecture boundary | PASS | 前端只保存 pending import batch 和页码；服务端仍最终裁决容量、安全和幂等，Channel/Gateway 未改。 |
| Frontend/browser ownership | PASS | 修改共享 `MemoryManagePage`、纯转换 helper、presentation redaction 和 i18n；无 canonical truth 或 request lifecycle 下沉。 |
| Multi-host consistency | PASS | `npm run build:vite:modes` 通过；未添加 host-specific 分支或入口。 |
| Minimal kernel non-regression | PASS | request lifecycle、scheduler、stream/history、context、model、capability 和 terminal commit 均无改动。 |
| Security | PASS | Owner/Agent scope 不从文件或 UI 注入；导出安全逻辑保持；Unix/Windows 宿主绝对路径恢复 `[REDACTED_PATH]`，URL、相对路径、IPv4/IPv6 保留。 |
| Reliability/recovery | PASS | 未知结果重试复用同一批次和条目键；新文件选择生成新 UUID；删除重载当前页且空页由既有校正收敛。 |
| Capacity | PASS | 客户端只展示 `max(0, 50-existing)`；服务端容量门禁保持最终权威，读取失败不伪装成服务端拒绝。 |
| Clean Code / scope | PASS | 删除文件 hash helper 与旧 i18n key，没有平行接口、配置、dead code 或无使用测试 fixture。 |
| OpenSpec consistency | PASS | spec review 为 PASS，四个 MODIFIED Requirements 与 stable 标题精确匹配。 |
| Commit granularity | PASS | 所有改动围绕 #689 的记忆管理交互和同页安全回归；过期独立归档未进入提交。 |

## 验证证据

- 前端相关：5 个测试文件、103 个测试 PASS。
- 前端 TypeScript build：PASS。
- multi-host Vite build：PASS。
- 定向 memory Playwright：2/2 PASS；按用户要求不再运行 smoke。
- `openspec validate fix-memory-import-export-ui --strict`：PASS。
- `openspec validate --all --strict`：307 PASS、3 个无关空 delta change 失败。
- dependency-cruiser：1505 modules / 6835 dependencies，无 violation；package manifest policy PASS。
- architecture Vitest：46 文件、292 测试 PASS；1 个无关 runtime logging boundary 测试失败。
- `git diff --check`：PASS。
- 用户已从界面完成目标交互验证。

## 主线既有 Follow-up

- 为 `fix-conversation-preview-validation`、`fix-session-list-validation`、`fix-share-validation-error-messages` 补充有效 delta 或移除无效 change。
- 修复 `packages/agent-capability/src/builtins/api-call-tool.ts` 的 centralized runtime logging boundary 违规。

这些项不应由本次记忆管理 PR 顺手修改；它们不改变本提交范围的 PASS 判断，但保留为仓库全量门禁 follow-up。
