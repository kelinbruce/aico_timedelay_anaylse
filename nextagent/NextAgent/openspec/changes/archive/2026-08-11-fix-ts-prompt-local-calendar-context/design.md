## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-10.4 自定义工具和提示词` | 保证 Prompt Template 的时区与当前日期来自同一个进程本地日历 | `prompt-template-assembly` | `FN-10.4 自定义工具和提示词` |

## `FN-10.4 自定义工具和提示词`

### 目标与规范依据

Prompt Template 继续暴露既有受治理 `timezone` 与 `currentDate` 变量，但同一次渲染中的两个值必须表达同一个进程本地日历事实。

#### 本 Function 的目标 Requirements

canonical spec：`prompt-template-assembly`

- `ADDED`：`Prompt 日历变量使用同一进程本地语义`

### 当前实现

- `buildPromptTemplateRenderContext` 在一次调用中创建 `Date` 并构造 `environmentInfo`。
- `timezone` 使用 `Intl.DateTimeFormat().resolvedOptions().timeZone`，表示进程本地 IANA 时区；`currentDate` 使用 `now.toISOString().slice(0, 10)`，表示 UTC 日期。
- variable resolver 直接投影这两个值，不重新解释日期。
- 现有测试覆盖模板变量渲染，但没有非 UTC 跨日窗口的固定时钟测试。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 两个变量表达同一本地日历 | 时区取本地事实，日期取 UTC 字符串切片 | UTC 与本地跨日窗口内相差一天 |
| 正、负时区和 UTC 可重复验证 | 测试不控制进程时区和时钟组合 | 缺少跨日回归证据 |

### 修改方案

`agent-context-engine` 是本 change 的唯一主要 owner 和唯一生产行为写入模块。保留现有 `Date` 创建点、`timezone` 解析、render context shape 和 variable resolver，只将 `currentDate` 改为由同一个 `now` 的本地 `getFullYear()`、`getMonth()` 与 `getDate()` 组成固定 `YYYY-MM-DD` 字符串。

不新增 helper、clock port、calendar context、公共字段或依赖；逻辑只有一个调用点。失败语义和兼容边界不变，因此无需数据迁移或回滚路径。测试使用 `vi.useFakeTimers()`、固定 ISO instant 和受控 `process.env.TZ`，覆盖 `Asia/Shanghai`、`America/New_York` 与 `UTC`，并恢复 fake timers 和原 `TZ`。

`packages/agent-workflow/src/nodes/restful-time-param.ts` 仅把 “user's timezone” 注释改为 “process-local timezone”。这是必要的说明接入，不改变 `FN-9.4` 行为，也不使 `agent-workflow` 成为主 owner。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 可靠性/恢复 | 无新增黑盒质量目标；由功能性 Requirement 派生 | 时区和日期使用同一个 `now` 与本地日历 | 正负 offset 跨日时不得相差一天 |
| 可测试性 | 无新增黑盒质量目标；由 Requirement Scenarios 派生 | 受控 `TZ` 与 fake clock | 三个时区结果确定且无全局状态泄漏 |

## 验证策略（Verification Strategy）

- Unit：观察 rendered `timezone` 与 `currentDate`。
- Characterization：UTC 与现有 template selection/rendering 行为保持不变。
- Negative：正、负时区跨 UTC 日期边界时不得渲染 UTC 日期。
- Architecture/contract：确认不修改 public render context、`agent-contracts`、配置或依赖图。

## 长期基线刷新计划（Baseline Promotion Plan）

- `openspec/specs/prompt-template-assembly/spec.md`：增加受治理日期/时区变量一致性行为。
- `openspec/designs/functions/D10-二次开发与平台集成/D10.1-扩展与插件/FN-10.4-自定义工具和提示词.md`：刷新处理过程和结果摘要。
- `openspec/designs/features/D10-二次开发与平台集成/D10.1-扩展与插件/F-10.4-自定义工具与提示词.md`：补充日期/时区一致性质量保证摘要。
- `openspec/overview.md`：无。
- `openspec/designs/architecture/core-contracts.md`：无；本 change 落实现有日历规则。
- `openspec/designs/architecture/prompt-template-assembly.md`：补充 render context 的本地日期/时区同源决策。
- `openspec/designs/modules/agent-context-engine.md`：补充受治理日历变量行为与测试入口。
- `openspec/designs/adr/`：无。
- `openspec/designs/spec-to-design-map.md`：刷新 `prompt-template-assembly` 的设计与验证入口。

## 风险与取舍（Risks / Trade-offs）

- 测试中的 `process.env.TZ` 和 fake timers 是进程全局状态；必须保存并恢复，且不得并发执行同一文件内的时区用例。
- 显式用户时区与 UTC0 部署下的用户本地日历属于后续独立 change；本 change 不预埋 contract 或抽象。

## 待确认问题（Open Questions）

无。
