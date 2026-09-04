## 背景和现状（Context）

仓库已有 Playwright browser journey 和少量真实 backend API smoke，但覆盖方式混合了 `page.route`、mock EventSource 和真实 backend，不能形成稳定的 release gate。产品旅程 gate 的唯一职责是验证用户从真实外部入口进入后，跨至少两个 owner 模块并经过真实网络边界的主链路。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 使用一个真实 local product process 和隔离临时数据目录执行产品旅程。
- 让 16 个产品旅程用例具有唯一 ID、唯一主要 spec 和可诊断失败证据。
- 以单一命令产出 machine-readable Playwright report 和 release smoke evidence ref。
- 维护唯一标准命令 `npm run test:e2e:product-journey`，写出 machine-readable release smoke `ReleaseCheckResult`；不定义 adapter API 或 release verdict 聚合。

**非目标：**
- 不在本 change 中实现缺失产品行为。
- 不用 E2E 替代 unit、contract、architecture 或 security/resilience negative tests。
- 不要求每个 provider 都访问公网；只有明确验证真实 provider 的用例使用配置的真实 endpoint。

## 设计决策（Decisions）

### D1. 唯一执行路径

`npm run test:e2e:product-journey` MUST 启动 `with-frontend` local product entrypoint，使用隔离配置、临时 SQLite/文件目录和受控测试身份，再由 Playwright 通过真实浏览器、HTTP、SSE 和 WebSocket 执行。测试结束 MUST 关闭 process 并清理临时状态。

### D2. 真实边界判定

本 gate 中不得使用 `page.route`、mock EventSource、fake WebSocket 或直接调用领域 service 来替代被验证链路。外部 model/provider 可以使用明确声明的 deterministic provider，仅当用例目标不是 provider 真实网络行为；e2e-P0-15 的完整 tool loop 必须经过产品 composition 和真实 capability executor。

### D3. 用例唯一归属

| 用例 | 主要验证目标 |
|---|---|
| e2e-P0-02 | 登录后创建 session、提交问题并读取 conversation |
| e2e-P0-03 | SSE canonical sequence 和终态 |
| e2e-P0-04 | SSE 与 WebSocket 生命周期/终态一致 |
| e2e-P0-06 | terminal commit 后 stream、history、刷新结果一致 |
| e2e-P0-07 | same-session latest-submit replacement 和串行 dispatch |
| e2e-P0-08 | cancel 终态和 partial answer |
| e2e-P0-09 | retry 新 run 与旧结果追溯 |
| e2e-P0-10 | edit-resubmit 新主线 |
| e2e-P0-11 | Markdown attachment intake 到 context consumption |
| e2e-P0-13 | 长会话 selection、summary/compaction 和降级提示 |
| e2e-P0-14 | 大内容引用按需加载 |
| e2e-P0-15 | model-tool-capability 完整 loop |
| e2e-P0-18 | capability source 配置禁用后的目录和调用结果 |
| e2e-P0-22 | feedback 不可更新/撤销和关联事实 |
| e2e-P0-23 | 自动标题与手动标题优先级 |
| e2e-P0-24 | 中英文输出和电信术语保真 |

### D4. Evidence 和失败语义

每个用例 MUST 保存 case id、开始/结束时间、结果、失败阶段和安全 artifact refs。任何必需用例 skipped、timeout 或 failed 时 gate MUST 失败。报告不得包含 raw credential、prompt、模型完整输出、附件内容或未脱敏路径。

### D5. 最小实现边界

本 gate 只允许抽取启动/停止真实产品进程、隔离临时目录、真实 transport client、case inventory 和 report 写入所需的最小 helper。不得新增通用 E2E DSL、独立 case 编排框架、产品 API、底层 capability/context/model 语义或可被产品路径依赖的测试机制。report 安全断言只覆盖本 gate 产生的 report/evidence，不复制 security gate 的全量 canary 扫描职责。

Release qualification 只能调用本 gate 的唯一标准命令 `npm run test:e2e:product-journey`，并读取该命令写出的 machine-readable `ReleaseCheckResult`；不得产生 release verdict。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 使用隔离测试身份和临时目录，本 gate report/evidence 执行脱敏 | report content negative assertion |
| 性能/容量 | 本 gate 只设有界 timeout，不定义容量 SLA | Playwright timeout report |
| 可靠性/恢复 | process 生命周期和清理必须确定性，终态用例必须等待 canonical terminal event | product journey gate |
| 可维护性 | 每个 case id 只有一个主要 spec，公共 setup 只抽取真实 process/network/report 最小 helper | case inventory check |
| 可测试性 | 不允许 mock 替代目标不可测节点 | forbidden mock scan + code review |
| 审计/可追溯性 | 产出 machine-readable report 和安全 evidence refs | report schema assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 真实 local product process 和真实 transport | 1.1、1.2 | `npm run test:e2e:product-journey` |
| 16 个产品旅程唯一主要归属 | 2.1-2.16 | case inventory + Playwright specs |
| 禁止 mock 替代目标节点 | 3.1 | negative source assertion |
| 安全、可诊断 evidence | 3.2 | report assertions |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-product-journey-gate/spec.md`
- E2E 分类和真实边界：`openspec/designs/architecture/e2e-quality-gates.md`
- 产品 composition 导航：`openspec/designs/modules/agent-app.md`
- 导航：`openspec/designs/spec-to-design-map.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 真实 process E2E 比 mocked journey 慢。 -> 只保留跨模块且包含真实不可测节点的 16 个主要用例。
- [风险] 用例依赖外部 provider 导致不稳定。 -> 默认使用受控 provider 配置；只有验证 provider 网络的独立 E2E 才访问真实 endpoint。
- [风险] 同一场景被多个 gate 重复实现。 -> case inventory 强制唯一主要 spec，其他 gate 只引用 evidence。

## 测试归属整合（Test Ownership Consolidation）

保留现有 mocked browser journey 作为 UI 回归；将满足真实边界条件的现有 backend E2E 迁入本 gate，并补齐缺失用例。迁移期间不得让同一 case id 在两个主要 spec 中同时存在。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/ts-e2e-product-journey-gate/spec.md`。
- 新增或更新 `openspec/designs/architecture/e2e-quality-gates.md`。
- 更新 `openspec/designs/modules/agent-app.md` 和 `openspec/designs/spec-to-design-map.md` 的验证导航。

## 待确认问题（Open Questions）

无。
