## 背景和现状（Context）

Alpha（串行底座）三个 change 已归档，交付了最小问答内核：session create、submit、SSE stream、terminal commit、history、SafeError、scope 隔离和并发冲突拒绝。这些能力的正确性通过 contract/unit/architecture gate 验证，但缺少使用真实 product process、真实 HTTP/SSE 和真实 local persistence 的 E2E 证据。

P0 阶段新增的四个 E2E gate 均依赖 P0 能力（auth、WebSocket、tool、title、feedback 等），无法验证 Alpha 内核独立行为的完整性。需要一个面向 Alpha 能力边界的独立 E2E gate，作为串行底座核心路径的回归保护。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 使用一个真实 Alpha 级 local product process 和隔离临时数据目录执行 Alpha E2E 用例。
- 让 6 个 Alpha E2E 用例具有唯一 ID、唯一主要 spec 和可诊断失败证据。
- 以单一命令产出 machine-readable Playwright report 和 release evidence ref。
- 维护唯一标准命令 `npm run test:e2e:alpha`，写出 machine-readable `ReleaseCheckResult`；不定义 adapter API 或 release verdict 聚合。

**非目标：**
- 不在本 change 中实现缺失产品行为。
- 不用 E2E 替代 unit、contract、architecture 或 P0 security/resilience tests。
- 不依赖 P0 能力（local auth、WebSocket、cancel、retry、tool、attachment、title、feedback、context compression、packaging）。
- 不要求每个 provider 都访问公网；使用明确声明的 deterministic provider。

## 设计决策（Decisions）

### D1. 唯一执行路径

`npm run test:e2e:alpha` MUST 启动 Alpha 级 local product entrypoint，使用隔离配置、临时 SQLite/文件目录和受控测试身份，再由 Playwright 通过真实 HTTP 和 SSE 执行。Alpha 级 product composition MUST 不包含 local auth、WebSocket transport、P0 工具注册和 P0 context assembly 增强。测试结束 MUST 关闭 process 并清理临时状态。

### D2. 真实边界判定

本 gate 中不得使用 `page.route`、mock EventSource 或直接调用领域 service 来替代被验证链路。外部 model/provider 使用明确声明的 deterministic provider。

### D3. P0 能力隔离

本 gate 的 product process fixture MUST NOT 启动 local auth route、WebSocket upgrade、P0 tool registration 或 P0 context assembly 增强。用例 MUST NOT 在请求中携带 attachment、pending input、feedback 或 P0 tool call。任一 P0 行为出现在 Alpha E2E 用例中时 gate MUST 拒绝该用例。

### D4. 用例唯一归属

| 用例 | 主要验证目标 | Alpha 行为来源 |
|---|---|---|
| e2e-alpha-01 | 最小问答主流程：session create → submit → SSE → terminal → history 一致 | `ship-ts-minimal-agent-kernel` "最小问答主流程" |
| e2e-alpha-02 | SSE canonical sequence：事件类型、顺序、终态 | `ship-ts-minimal-agent-kernel` "Stream Web Channel" |
| e2e-alpha-03 | 同 session 并发冲突拒绝（简单 reject） | `ship-ts-minimal-agent-kernel` "同 session 并发 submit 不串写" |
| e2e-alpha-04 | SafeError 安全边界：非法输入 → safe error，无原始泄漏 | `ship-ts-minimal-agent-kernel` "Terminal Consistency And Safe Error" |
| e2e-alpha-05 | Idempotent session create：重复创建返回首次结果 | `ship-ts-minimal-agent-kernel` "创建或使用会话" |
| e2e-alpha-06 | Owner scope 隔离：跨 owner 访问返回 safe not-found | `ship-ts-minimal-agent-kernel` "Owner Scope And No-op Boundaries" |

### D5. Evidence 和失败语义

每个用例 MUST 保存 case id、开始/结束时间、结果、失败阶段和安全 artifact refs。任何必需用例 skipped、timeout 或 failed 时 gate MUST 失败。报告不得包含 raw credential、prompt、模型完整输出、附件内容或未脱敏路径。

### D6. 最小实现边界

本 gate 只允许抽取启动/停止 Alpha 级产品进程、隔离临时目录、真实 HTTP/SSE client、case inventory 和 report 写入所需的最小 helper。不得新增通用 E2E DSL、独立 case 编排框架、产品 API、底层 capability/context/model 语义或可被产品路径依赖的测试机制。report 安全断言只覆盖本 gate 产生的 report/evidence。

Release qualification 只能调用本 gate 的唯一标准命令 `npm run test:e2e:alpha`，并读取该命令写出的 machine-readable `ReleaseCheckResult`；不得产生 release verdict。

### D7. 与 P0 E2E gate 的关系

| 维度 | Alpha gate (`add-ts-e2e-alpha-kernel-gate`) | P0 product-journey gate (`add-ts-e2e-product-journey-gate`) |
|---|---|---|
| 依赖能力 | 仅 `ship-ts-minimal-agent-kernel` | local auth、WebSocket、cancel、retry、tool、attachment、title、feedback、context 等 |
| 用例 ID | e2e-alpha-xx | E2E-615-xx |
| 命令 | `npm run test:e2e:alpha` | `npm run test:e2e:product-journey` |
| product composition | Alpha 级（无 auth、无 WS、无 P0 工具） | P0 级 with-frontend |

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 使用隔离测试身份和临时目录，本 gate report/evidence 执行脱敏 | report content negative assertion |
| 性能/容量 | 本 gate 只设有界 timeout，不定义容量 SLA | Playwright timeout report |
| 可靠性/恢复 | process 生命周期和清理必须确定性，终态用例必须等待 canonical terminal event | Alpha gate fixture test |
| 可维护性 | 每个 case id 只有一个主要 spec，公共 setup 只抽取真实 process/network/report 最小 helper | case inventory check |
| 可测试性 | 不允许 mock 替代目标不可测节点；不允许 P0 能力污染 Alpha 用例 | forbidden mock/P0 scan + code review |
| 审计/可追溯性 | 产出 machine-readable report 和安全 evidence refs | report schema assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 真实 Alpha product process 和真实 transport | 1.1、1.2 | `npm run test:e2e:alpha` |
| 6 个 Alpha 用例唯一主要归属 | 2.1-2.6 | case inventory + Playwright specs |
| 禁止 mock 替代目标节点 | 3.1 | negative source assertion |
| 禁止 P0 能力污染 Alpha 用例 | 3.2 | negative P0 leakage assertion |
| 安全、可诊断 evidence | 3.3 | report assertions |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-alpha-kernel-gate/spec.md`
- 跨 gate 设计：`openspec/designs/architecture/e2e-quality-gates.md`（与 P0 gate 共享）
- 测试模块入口：`openspec/designs/modules/agent-app.md`（导航引用）
