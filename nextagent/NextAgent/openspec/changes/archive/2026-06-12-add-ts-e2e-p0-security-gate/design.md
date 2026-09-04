## 背景和现状（Context）

安全失败往往发生在模块组合处：认证 middleware 未覆盖某条 route、sandbox capability 绕过 gateway、raw provider error 经 stream 泄漏，或日志/audit sink 在真实序列化时保留敏感值。本 change 只验证这些真实边界风险。

## 目标和非目标（Goals / Non-Goals）

**目标：**
- 使用真实 process/network/filesystem/sink 验证五个 security E2E case。
- 让恶意输入标记贯穿请求后可被统一扫描，证明 response、stream、log、audit 和 report 均未泄漏。
- 产出可被既有 security hard gate 消费的 evidence。

**非目标：**
- 不重新定义安全策略或产品行为。
- 不替代低层 security、contract 和 architecture tests。
- 不将 secret、prompt 或附件内容保存为调试 artifact。

## 设计决策（Decisions）

### D1. 唯一执行路径

`npm run test:e2e:security` 启动隔离 local product candidate，注入唯一敏感 canary，经真实外部入口执行攻击/失败场景，随后扫描 HTTP/stream 输出、结构化日志、audit sink 和 Playwright report。任何 canary 出现在禁止表面时 gate 失败。

### D2. 用例唯一归属

| 用例 | 主要验证目标 |
|---|---|
| e2e-P0-01 | 未认证 challenge 且不创建用户数据 |
| e2e-P0-12 | 非启用/超限附件返回 safe error 且不泄漏 |
| e2e-P0-16 | 动态执行不能绕过 sandbox gateway |
| e2e-P0-17 | provider/model failure 映射为 SafeError |
| e2e-P0-21 | audit/log 输出安全字段且不含禁止内容 |

### D3. 与低层 security gate 的边界

本 gate 只负责包含真实不可单测节点的链路。`add-ts-security-test-gate` 负责更细粒度的 secret grammar、redaction policy、依赖禁止和 source-level negative assertions。二者共享 evidence ref，不复制主要 case。

### D4. Fail-closed

必需 case 缺失、skipped、timeout、scan 失败或 sink 不可读均视为 gate failed；不得把无法检查解释为通过。

### D5. 最小实现边界

本 gate 的扫描面限定为本 change 明确列出的 HTTP response、stream 输出、safe error、结构化日志、audit sink 和 Playwright report。不得扩展为全盘文件扫描、secret grammar 检查、redaction policy source assertion、依赖禁止扫描或其他低层 security gate 职责。恶意 fixture 只用于触发五个真实边界 case，不新增安全策略、SafeError 字段、audit contract 或产品可见测试开关。

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | canary 跨明确列出的 response/stream/safe error/log/audit/report 扫描，任何泄漏阻断 | security E2E |
| 性能/容量 | 只执行最小攻击场景，不定义负载目标 | bounded timeout |
| 可靠性/恢复 | scan/sink 失败时 fail closed | negative gate tests |
| 可维护性 | 五个 case 唯一归属，攻击 fixture 集中管理 | inventory check |
| 可测试性 | 必须真实触发禁止行为，不接受仅扫描源码 | security E2E |
| 审计/可追溯性 | 保留安全 reason/evidence ref，不保留 canary 原值 | report assertion |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| 五个真实安全 case | 2.1-2.5 | `npm run test:e2e:security` |
| canary 不泄漏 | 1.2、3.1 | sink/report scan |
| 无法检查时 fail closed | 3.2 | negative fixture |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/ts-e2e-security-gate/spec.md`
- 跨门禁设计：`openspec/designs/architecture/e2e-quality-gates.md`
- Observability 导航：`openspec/designs/modules/agent-observability.md`

## 风险与取舍（Risks / Trade-offs）

- [风险] 敏感 canary 被测试 artifact 自身记录。 -> reporter 在持久化前只保存 canary hash 和安全 reason。
- [风险] 安全 E2E 与低层 security tests 重叠。 -> 按真实不可测节点划分主要归属。

## 测试归属整合（Test Ownership Consolidation）

复用既有 auth/safe error/audit 测试数据，但将真实边界场景迁入 security E2E project；低层断言继续保留在原 owner。

## 归档前更新基线（Baseline Promotion Plan）

- 新增 `openspec/specs/ts-e2e-security-gate/spec.md`。
- 更新 `openspec/designs/architecture/e2e-quality-gates.md`、`openspec/designs/modules/agent-observability.md` 和 `openspec/designs/spec-to-design-map.md`。

## 待确认问题（Open Questions）

无。
