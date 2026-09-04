## 背景和现状（Context）

NextAgent TS 后端平台的架构测试门（Architecture Test Gate）涵盖功能（F）、兼容性（C）、可观测性（O）、UI 交互（UI）四个维度，共 17 个测试文件、98 个 Vitest 用例 + 16 个 Playwright 用例 = 114 个测试用例。

**当前状态**：
- 测试用例经过一轮修复，与真实 API 行为对齐
- 存在多处 ⚠️ 标注的真实 API 差异（HTTP 200 vs 202、SSE only vs SSE+WS、trusted identity 模式、idempotencyKey 可选、/capabilities 不存在、REQUEST_CANCEL_ALREADY_TERMINAL vs CONFLICT）
- 前端 data-testid 已映射到真实值（17 个映射）
- 存在已知系统 bug（SSE EventSource 超时）和前端功能缺失（sessionStorage key 不存在、无 theme-toggle-btn）

**约束**：
- Trusted identity 模式默认 localAuth.enabled=false，无需认证
- 跨 scope 测试仅在 localAuth.enabled=true 时有意义
- SSE only（无 WebSocket 支持）
- /capabilities 端点不存在
- /health 路径无 /api/v1 前缀

## 目标和非目标（Goals / Non-Goals）

**目标：**
1. 明确架构测试门各维度的行为契约，建立从 spec 约束到测试用例的追溯链
2. 记录真实 API 规则对齐决策，为后续维护和扩展提供参考
3. 明确双框架（Vitest + Playwright）执行架构和目录结构设计
4. 记录已知问题和测试经验库已验证状态

**非目标：**
1. 不修改系统实现代码或前端代码
2. 不修改已有 spec 假设值（真实 API 差异通过标注方式记录）
3. 不解决 SSE 超时、sessionStorage key 不存在、无 theme-toggle-btn 等系统 bug
4. 不重新设计测试用例编号体系

## 设计决策（Decisions）

### D1: 真实 API 规则对齐策略

**决策**：测试用例预期结果使用真实 API 行为值（HTTP 200、REQUEST_CANCEL_ALREADY_TERMINAL、SSE only），spec 假设值通过 ⚠️ 标注保留对照。

**理由**：测试用例的目标是验证系统真实行为是否满足需求。使用假设值会导致测试必然失败（如 HTTP 202 在真实 API 永远不会出现），降低测试可信度。标注对照关系便于 spec 修订时回溯。

**放弃的备选**：
- A: 修改前端/后端使 API 行为匹配 spec → 代价太高，且 spec 可能本身有误
- B: 保持 spec 假设值不变，测试一律标注 "预期 vs 真实" → 信息冗余，测试执行失败无法区分 bug vs spec 假设

### D2: 双框架执行架构

**决策**：后端 API 测试使用 Vitest (.test.ts)，E2E UI 测试使用 Playwright (.spec.ts)。

**理由**：
- Vitest 适合无浏览器依赖的 API 测试，速度快、debug 方便
- Playwright 适合需要浏览器环境的 UI 交互测试，支持 data-testid、SSE EventSource、JS collector

**放弃的备选**：
- A: 全部使用 Playwright → API 测试也需要浏览器启动，速度慢
- B: 全部使用 Vitest → UI 交互测试无法在 Vitest 中模拟浏览器环境

### D3: SSE stream 完成检测策略

**决策**：UI 交互测试使用 DOM waitFor（chat-stream-status-strip 可见性），SSE 事件序列验证使用 JS collector（page.waitForFunction() 轮询 window 变量）。

**理由**：DOM waitFor 与 UI 状态同步，适合验证渲染行为；JS collector 不依赖 DOM 渲染时序，适合验证 SSE 事件序列完整性。

**放弃的备选**：
- A: 全部使用 DOM waitFor → SSE 事件序列验证依赖 DOM 时序，不可靠
- B: 全部使用 JS collector → UI 交互测试需要手动收集事件，增加复杂度

### D4: Trusted identity 模式下的跨 scope 测试策略

**决策**：trusted identity 模式下将跨 scope 测试改为 nonexistent session 返回 404，标注 "需 localAuth.enabled=true 才可完整测试"。

**理由**：trusted 模式下所有请求共享固定身份，无法构造跨 tenant 场景。强行构造会导致测试无法执行或结果不可判定。

**放弃的备选**：
- A: 在 trusted 模式下强行构造跨 tenant 测试 → 无意义，测试必然通过（共享身份）
- B: 全部使用 localAuth 模式 → 需修改默认配置，影响其他测试

### D5: 已知问题标注策略

**决策**：已知系统 bug 和前端功能缺失通过 ⚠️ 标注记录在设计文档中，不修改测试脚本逻辑使其 pass。

**理由**：标注已知问题便于区分 "测试脚本 bug" vs "系统 bug"，避免通过修改测试脚本掩盖真实问题。

**放弃的备选**：
- A: 修改测试脚本使已知问题 pass → 掩盖真实 bug，降低测试可信度
- B: 删除已知问题测试 → 丢失测试覆盖点

### D6: data-testid 映射策略

**决策**：Playwright 脚本使用真实前端 data-testid（message-textarea、btn-send 等），不使用假设值（composer-input、composer-submit 等）。

**理由**：Playwright 定位器必须与前端实际值匹配，否则定位必然失败。假设值在测试中发现全部不匹配。

**放弃的备选**：
- A: 在前端添加假设值作为别名 → 前端团队未同意，代价不确定
- B: 使用 CSS class 定位 → 不稳定，前端样式可能变化

### D7: 目录结构设计

**决策**：测试用例按 gate 和子维度组织目录，helpers 通过 symlink 共享。

**目录结构**：
```
tests/add-ts-architecture-test-gate/
├── functional/
│   ├── TC-F-001-002.test.ts ~ TC-F-040-065.test.ts  ← Vitest
│   ├── functional-ui/
│   │   └── TC-F-005-012.spec.ts                      ← Playwright
│   ├── ui-interaction/
│   │   ├── TC-UI-001-003.spec.ts                     ← Playwright
│   │   └── TC-UI-004-006.spec.ts                     ← Playwright
│   └── helpers/
│       └── ui-helper.ts                              ← Playwright 共用
├── compatibility/
│   ├── TC-C-001-003.test.ts ~ TC-C-013-017.test.ts  ← Vitest
├── observability/
│   └── TC-O-001-003.test.ts                          ← Vitest
```

**理由**：gate 级目录便于选择性执行；子维度目录便于定位和追溯；helpers symlink 便于 api-client.ts 共享。

### D8: 测试经验库验证状态

**决策**：测试经验库 TE-01~TE-10 标注已验证状态（✅/⚠️），不机械套用所有经验。

| 经验 | 已验证状态 | 说明 |
|------|-----------|------|
| TE-01 双终态竞争 | ⚠️ | error.code = REQUEST_CANCEL_ALREADY_TERMINAL 非 CONFLICT |
| TE-02 跨 scope 拒举 | ✅ | nonexistent session 返回 404 |
| TE-03 斠连重连 | ⚠️ | SSE 可能超时，status-strip 时序不确定 |
| TE-04 降级不阻断 | ✅ | title 生成失败不阻塞主流程 |
| TE-05 输入验证 | ⚠️ | idempotencyKey 可选而非强制 |
| TE-06 白盒不绕过 | ✅ | *Record 不出现在 web response |
| TE-07 状态机路径 | ⚠️ | 部分状态转换不触发 |
| TE-08 重放不重复 | ⚠️ | Recovery 日志为 stub |
| TE-09 fail-closed | ✅ | model fallback fail-closed |
| TE-10 资源操作隔离 | ✅ | sandbox 拦截正常 |

## 质量属性设计（Quality Attributes）

| 贅量属性 | 设计结论 | 验证入口 | 不适用理由 |
|---|---|---|---|
| 安全 | trusted identity 默认无需认证；localAuth /api/v1/auth/local/login 仅特定配置；跨 scope 在 trusted 模式下仅验证 nonexistent 404 | TC-F-002B, TC-C-003 | trusted 模式无跨 tenant |
| 性能/容量 | 测试门不覆盖性能指标（性能由 performance-test-gate 专责） | — | 非本 gate 范围 |
| 可靠性/恢复 | Cancel CAS 竞争唯一终态；Retry 旧 attempt 不变；Stream Resume 不静默空白 | TC-F-001B, TC-F-004, TC-F-007E | — |
| 可维护性 | Vitest + Playwright 双框架；按 gate/子维度组织目录；helpers symlink 共享 | 目录结构检查 | — |
| 可测试性 | api-client.ts (Vitest) + ui-helper.ts (Playwright) 共用工具；JS collector SSE 检测；真实 data-testid | helper 函数可用性 | — |
| 审计/可追溯性 | conversation 消息含 requestId + timestamp；/metrics 不含高基数标签 | TC-O-002, TC-O-003 | — |

## 验证映射（Verification Map）

| 约束 | Task | 验证入口 |
|---|---|---|
| HTTP 200（真实值，非 spec 202） | TC-F-001 | vitest run TC-F-001-002.test.ts |
| SSE only（无 WS） | TC-F-005 | playwright test TC-F-005-012.spec.ts |
| Trusted identity 无需认证 | TC-F-002 | vitest run TC-F-001-002.test.ts |
| /capabilities 不存在 | TC-F-011 | playwright test TC-F-005-012.spec.ts |
| idempotencyKey 可选（非强制） | TC-F-001E | vitest run TC-F-001-002.test.ts |
| REQUEST_CANCEL_ALREADY_TERMINAL（非 CONFLICT） | TC-F-009E | vitest run TC-F-006-010.test.ts |
| 真实 data-testid 映射 | TC-UI-001 | playwright test TC-UI-001-003.spec.ts |
| SSE JS collector 检测 | TC-F-005 | playwright test TC-F-005-012.spec.ts |
| sessionStorage key 不存在 | TC-UI-004 | playwright test TC-UI-004-006.spec.ts（已知 FAIL） |
| 无 theme-toggle-btn | TC-UI-006 | playwright test TC-UI-004-006.spec.ts（已知 FAIL） |
| 跨平台语义一致 | TC-C-001 | vitest run TC-C-001-003.test.ts |
| 双模式 API 行为一致 | TC-C-002 | vitest run TC-C-001-003.test.ts |
| 日志四层结构化 | TC-O-001 | vitest run TC-O-001-003.test.ts |
| Audit event 追溯链 | TC-O-002 | vitest run TC-O-001-003.test.ts |
| Metric 低基数 | TC-O-003 | vitest run TC-O-001-003.test.ts |

## 文档承载决策（Documentation Ownership）

- 行为契约：`ts-architecture-test-gate/specs/spec.md`（本 change 的 spec delta）
- 真实 API 规则：`E2ETestcaseSKILL/SKILL.md`（真实 API 规则章节）— 主承载文档
- data-testid 映射：`E2ETestcaseSKILL/SKILL.md` + `templates/case-template.md` — 主承载文档
- 架构设计：`ts-architecture-test-gate/design/design.md`（本文档）
- 测试经验库：`E2ETestcaseSKILL/references/methodology.md` — 主承载文档
- 测试用例追溯：各 .test.ts/.spec.ts 文件头注释 — 主承载文档

## 风险与取舍（Risks / Trade-offs）

- [SSE EventSource 超时] → 已知系统 bug，使用 JS collector 降低 DOM 时序依赖；TC-F-005/005B 标注为已知问题
- [spec 假设 vs 真实 API] → 在 SKILL.md 和 design.md 中维护差异表，生成测试用例时对齐真实值
- [sessionStorage key 不一致] → 前端功能缺失，TC-UI-004/005 标注为已知 FAIL
- [无 theme-toggle-btn] → 前端功能缺失，TC-UI-006 标注为已知 FAIL
- [trusted 模式无跨 tenant] → 跨 scope 测试降级为 nonexistent 404，标注需 localAuth 才可完整测试
- [resolvePendingInput 端点未确认] → TC-F-006 通过 conversation 间接验证
- [Vitest include 范围] → vitest.config.ts 需修改为 `tests/suites/**/*.test.ts` 否则只跑 contract-test-gate

## 迁移计划（Migration Plan）

无。本 change 不涉及系统代码或配置迁移。

## 归档前更新基线（Baseline Promotion Plan）

- `openspec/specs/ts-architecture-test-gate-functional/spec.md`：新增功能维度行为契约（17 scenarios）
- `openspec/specs/ts-architecture-test-gate-compatibility/spec.md`：新增兼容性维度行为契约（5 scenarios）
- `openspec/specs/ts-architecture-test-gate-observability/spec.md`：新增可观测性维度行为契约（4 scenarios）
- `openspec/specs/ts-architecture-test-gate-ui-interaction/spec.md`：新增 UI 交互维度行为契约（6 scenarios）
- `openspec/designs/architecture/ts-architecture-test-gate.md`：新增架构设计（双框架、真实 API 规则、已知问题）

## 待确认问题（Open Questions）

1. SSE EventSource 超时根因未确定（CORS 配置? 服务端 SSE handler?）
2. resolvePendingInput 端点是否存在于真实 API（TC-F-006 通过 conversation 间接验证）
3. /metrics 端点是否存在（TC-O-003 验证时发现可能返回 404）
4. sessionStorage 前端实际使用什么机制管理会话列表偏好和 Composer 草稿
5. 深色模式切换入口在哪里（无 theme-toggle-btn）
6. TC-F-013~065 大量用例的真实 API 行为待进一步验证（子维度覆盖: Capability catalog、Context budget、Risk policy、Builtin tool 等）
