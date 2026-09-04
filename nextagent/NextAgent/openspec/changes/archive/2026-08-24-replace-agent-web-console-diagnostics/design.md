# Design: 统一 Agent Web 前端诊断输出

## 设计范围（Design Scope）

| Function | 目标变化 | delta specs | Function 设计章节 |
|---|---|---|---|
| `FN-10.6 前端定制` | Agent Web 浏览器生产源码与本地 mock server 运行时源码分别统一诊断 reporter；既有 AICOConfig、Mock Prel 与 mock API 行为契约不变 | `agent-web-multi-host-modes` | [FN-10.6 前端定制](#fn-106-前端定制) |

## FN-10.6 前端定制

### 目标与规范依据

Agent Web 的浏览器生产实现需要把 warning、error、debug 诊断收敛到单一前端 owner；本地 mock server 也需要把 server、route 与 data stream 的进程输出收敛到 mock server 自己的 owner。两者保持原有业务结果和开发诊断可见性；浏览器诊断不进入产品 UI、网络、persistence、audit、metric 或 trace。

本 Function 的目标 Requirements：

- canonical spec：`agent-web-multi-host-modes`
  - `ADDED Agent Web diagnostics use runtime-owned reporters`

### 当前实现

- `frontend/agent-web/src` 中 AICOConfig、PIU、宿主 entry、Mermaid、stream defense 和 mock Prel 路径直接调用 `console.warn`、`console.error` 或 `console.debug`。
- `frontend/agent-web-mock-server` 的 server、routes 与 data stream 中存在 70 处直接 `console.log/warn/error` 调用。
- 直接调用分散在业务组件与 hook 中，测试只偶发依赖浏览器控制台，缺少统一级别分发和防扩散边界。
- 后端已有 `agent-observability` / `agent-log` owner，浏览器源码不能引入后端 logger 依赖。

### GAP 分析

- 缺少一个浏览器端诊断 owner，导致业务源码直接依赖 `console` 并继续扩散。
- 缺少级别分发测试，无法证明替换后 warning/error/debug 仍保持原级别。
- 缺少 source-level architecture assertion，无法阻止测试之外的浏览器生产源码重新直接调用 `console.*`。
- mock server 缺少独立输出 owner 与防回退断言；测试和 Node CLI 输出不应被误纳入该边界。

### 修改方案

- 在既有 `frontend/agent-web/src/utils` 中新增 `diagnostics.ts`，导出 `reportWarning`、`reportError`、`reportDebug` 三个同步函数；函数签名为 `(message: string, ...details: unknown[]) => void`。
- reporter 内部按级别把 `message` 与 `details` 原样传给浏览器开发控制台对应 `warn`、`error`、`debug` 方法，不格式化、不脱敏、不上报、不持久化、不渲染 UI、不改变调用方控制流。
- 迁移 `frontend/agent-web/src` 生产源码中的全部 `console.warn`、`console.error`、`console.debug` 调用到对应 reporter 函数；保留原 message、detail 参数和调用时机。
- `frontend/agent-web/src/utils/diagnostics.ts` 是唯一允许直接访问浏览器 console 的前端生产模块。
- 在既有 `frontend/agent-web-mock-server` 根目录新增 `diagnostics.js`，导出 `logInfo`、`logWarning`、`logError`；该文件是 mock server 唯一允许直接访问 console 的运行时模块，并保持参数与 stdout/stderr 级别不变。
- 测试、Node scripts 和 Playwright driver 不属于浏览器或 mock server 运行时源码边界，本次不改。
- 新增 reporter 级别分发测试，并新增 source-level architecture assertion：浏览器侧除 `src/utils/diagnostics.ts` 外，`src/**/*.{ts,tsx}` 不得匹配直接 `console.(log|debug|info|warn|error)(` 调用；mock server 侧除根目录 `diagnostics.js` 外，server/routes/data 运行时 JavaScript 不得匹配直接 `console.*` 调用。两个断言均对应上述 OpenSpec 边界，不作为通用代码风格扫描。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可维护性 | `Agent Web diagnostics use runtime-owned reporters` | 单一浏览器诊断 owner 与三类级别函数 | 生产源码无直接 `console.*` 调用 |
| 可测试性 | `Agent Web diagnostics use runtime-owned reporters` | reporter 保持同步、纯输出、无控制流副作用 | warning/error/debug 参数与级别原样分发 |

## 验证策略（Verification Strategy）

- unit：mock browser console，断言 `reportWarning`、`reportError`、`reportDebug` 分别调用对应级别并保留 message/details。
- architecture：扫描 `frontend/agent-web/src` 生产 TypeScript/TSX 文件，除唯一 reporter 文件外断言不存在直接 `console.*` 调用；扫描 `frontend/agent-web-mock-server` 的 server/routes/data JavaScript 文件，除 `diagnostics.js` 外断言不存在直接 `console.*` 调用。两个 source assertion 均直接对应 OpenSpec 边界。
- characterization：迁移 AICOConfig 非法输入、mock Prel emit、runtime bootstrap 失败、Mermaid 渲染失败和 stream invalid envelope 既有测试时，保持调用时机与业务结果不变；本次若既有测试已覆盖这些路径，优先运行相关既有测试，不新增重复 UI 测试。
- frontend gate：运行 `frontend/agent-web` 的 TypeScript build 与相关 Vitest tests；浏览器生产诊断替换不改变浏览器用户旅程，故不追加 Playwright e2e。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/agent-web-multi-host-modes/spec.md`：新增 `## Function` 元数据与 `Agent Web diagnostics use runtime-owned reporters`；既有 AICOConfig 与 Mock Prel Requirements 不迁移、不修改。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.2-集成与定制/FN-10.6-前端定制.md`：描述与规格表增加统一浏览器与本地 mock server 诊断输出。
- `openspec/designs/features/D10-二次开发与平台集成/D10.2-集成与定制/F-10.6-前端定制.md`：无。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/*`：无。
- `openspec/designs/modules/*`：无。
- `openspec/designs/adr/*`：无。
- `openspec/designs/spec-to-design-map.md`：无（canonical spec 已有映射）。

## 风险与取舍（Risks / Trade-offs）

- Reporter 仍最终使用浏览器开发控制台，这是为了保持现有开发可见性并避免功能损失；本次把直接依赖收敛到唯一 owner，而不是删除诊断事实。
- `...details: unknown[]` 保留对象与 Error 的原有输出形状。若未来需要结构化 event 或脱敏，必须另立 OpenSpec change，不在本次引入猜测性 schema。
- Source assertion 可能放过注释或间接访问形式的 console 调用；本 change 的直接目标和生产风险是现存直接调用模式，架构测试配合代码审查执行。

## 待确认问题（Open Questions）

无。
