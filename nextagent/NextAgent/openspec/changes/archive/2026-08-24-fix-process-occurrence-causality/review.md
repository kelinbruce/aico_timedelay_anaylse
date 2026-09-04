# OpenSpec 语义审查

- Change：`fix-process-occurrence-causality`
- 检查日期：2026-08-15
- 审查基线：`origin/main@9b68ae1fb`

## 审查结果

状态：PASS

## Findings

| ID | 严重级别 | 领域 | 位置 | 问题 | 处理结果 |
|---|---|---|---|---|---|
| S1 | LOW | Function 规格黑盒边界 | `ts-web-sse-ws-transports` Function 变更汇总 | 原目标规格值直接描述浏览器内部 accumulated lane 组装 | 已改为用户可观察的输入分段发生实例规则；规范 Requirement 继续唯一承载精确事件语义 |

## 需群内确认

None。本 change 不新增、删除、重命名、移动或重新定义 `agent-contracts` 内容，也不新增公共 DTO、enum、port、public export、runtime schema、Web API、stream event type 或 payload 字段。若实施改为修改 producer `stepId`、增加 server safe-result schema 或改变 Gateway contract，必须停止实施并重新升级确认。

## 约束对齐

| 约束来源 | 结果 | 备注 |
|---|---|---|
| architecture | PASS | `frontend/agent-web` 只修正既有 canonical stream/history 的浏览器投影和本地 view state |
| core contracts | PASS | event vocabulary、payload、runtime truth、Capability Result 和模型上下文保持不变 |
| roadmap owner boundaries | PASS | `FN-1.1` 与 `FN-10.6` 由同一 Web projection owner 做最小增量；无 Gateway/runtime owner 迁移 |
| roadmap change rules | PASS | 两个现象共享 occurrence causality 不变量，可由同一 issue fixture 独立验收 |
| current code | PASS | 基于现有 accumulated lane、process-content key、structured/lifecycle suppression 和 disclosure hook 修改 |
| engineering principles | PASS | 复用 `USER_INPUT_RECEIVED` 与 `toolCallId`；不新增 identity 字段、通用树、协议解析器或配置开关 |

## OpenSpec 完整性

| 必需项 | 结果 | 备注 |
|---|---|---|
| Function-spec 映射 | PASS | 两个既有 Function 各有 canonical spec；legacy structured Requirements 原子迁移，不新增多对多映射 |
| Delta/stable operation | PASS | 一个 ADDED 无同名 stable Requirement；三个 MODIFIED 和两个 REMOVED 均在同名 stable spec 恰好匹配一次 |
| Function 变更汇总 | PASS | 字段唯一，并与全部 ADDED/MODIFIED Requirements 双向追踪 |
| Function 规格 | PASS | 规格项已收敛为可观察发生实例、卡片聚合与 disclosure 规则 |
| Requirement 元数据 | PASS | 全部 ADDED/MODIFIED Requirements 声明功能性需求并包含 Scenario |
| 质量属性分层 | PASS | 无新增独立质量 Requirement；design 只说明局部和跨 Function 验证机制 |
| 触发机制 | PASS | 既有 canonical stream events、`USER_INPUT_RECEIVED` 和相同 `toolCallId` lifecycle |
| 输入和前置条件 | PASS | 输入分段、稳定关联、lifecycle 存在/缺失和终态条件均闭合 |
| 输出和副作用 | PASS | 可见顺序、卡片归属、结果 precedence 和 disclosure 可观察且可测试 |
| 核心决策逻辑 | PASS | occurrence 分段、started anchor、单卡片聚合和 stdout residue 规则唯一 |
| 存量代码基线 | PASS | design 列明现有对象、错误合并身份和最小修改点 |
| 增量实施路径 | PASS | 只增加共享输入分段 utility 和现有 ProcessEntry 私有 sections |
| 唯一实施路径 | PASS | 备选方案均明确拒绝且未进入 tasks |
| 状态或 artifact 契约 | PASS | 不持久化浏览器 view state，不改变 canonical event facts |
| flow 集成 | PASS | live、compaction、reconnect merge 和 cold history 复用同一投影规则 |
| 失败和降级 | PASS | 无可信边界不猜测；混合 stdout 不安全拆分时省略 preview 并保留终态/安全错误 |
| 验收示例 | PASS | normal、boundary、failure、legacy 和三宿主路径均有 Scenario/Task |

## 语言严谨性

| 检查项 | 结果 | 备注 |
|---|---|---|
| Feature/Function/Capability 术语 | PASS | OpenSpec Function 与 runtime Capability 用法可区分 |
| canonical terminology | PASS | occurrence、输入分段、structured sections、普通安全结果跨 artifact 一致 |
| BCP 14 规范关键词 | PASS | 规范义务只在 specs 使用大写关键词 |
| 语义闭合 | PASS | 条件、身份、排序锚点、结果和降级行为唯一 |
| 量词与可测量边界 | PASS | 恰好一张卡片、800 ms、稳定关联优先级均明确 |
| 形式化表示适配性 | PASS | 最小事件映射表足以表达条件，不需要新增状态机 |
| scenario-to-test 来源 | PASS | tasks 断言用户可见顺序、归属、内容和 disclosure，不锁死无关私有形状 |
| 黑盒/白盒边界 | PASS | specs 定义可观察结果，owner、utility、view model 和 reducer 只在 design |
| 端到端追踪 | PASS | Feature → 两个 Function → Requirements → Scenarios → tasks/tests 可定位 |

## Roadmap 规则覆盖

| 检查项 | 结果 | 备注 |
|---|---|---|
| 输入模板字段 | N/A | 本 change 由 issue 事实与 stable Function/spec 直接建立，不是 roadmap candidate 输入 |
| 创建前覆盖检查 | PASS | 不依赖核心契约修改，不改变最小内核 owner，不新增接口 |
| 生成后一致性确认 | PASS | proposal、design、specs 和 tasks 指向同一实施路径 |
| release scope / not-planned / candidate | PASS | 未混入后置能力或通用执行树 |
| 并行边界 | PASS | 最新 active-change 搜索无相同 Requirement overlap |
| 第一性原理/KISS/SOLID | PASS | 按真实事件身份呈现真实发生事实，单一 Web projection owner |
| 基于存量代码的增量设计 | PASS | 不重建 producer、persistence、Gateway 或模型上下文链路 |
| 唯一可实施路径 | PASS | 输入分段 occurrence 与单 capability-card reducer 是唯一目标路径 |

## 需求和设计清晰度

Requirements、design、tasks 和 acceptance 已足以进入 test-first 实施。最新 main 的 `suppress-nonstructured-residue-when-structured-exists` 只处理 non-agentic ApiCall terminal `LLM_CONTENT_DELTA`，不替代本 change 对 Bash command output、structured sections 和卡片 disclosure 的处理。

## 已运行校验

- `openspec list --json`
- active/stable Requirement `rg` overlap 检查
- `openspec validate fix-process-occurrence-causality --strict`
- `openspec validate --all --strict`：282 passed、0 failed
- `git diff --check`

## 建议下一步

提交审查通过的规格基线，然后按 tasks 1.1 和 2.1 分别建立 RED characterization，再写最小生产实现。

---

# 实施语义审查

- 审查日期：2026-08-15
- 审查范围：`7ddd64e38..working tree` 的 `frontend/agent-web`、测试和本 change task 证据
- 审查方式：`nextagent-code-review`

## 审查结果

状态：PASS WITH FOLLOW-UP

提交范围未发现 P0、P1、P2 或 P3 代码问题。审查中发现并在提交前修正了两个边界：移除 timeline projection 中未使用的 runtime set；将 runtime structured section 聚合条件收紧为“相同 `toolCallId` 同时存在非 Workflow Capability lifecycle”，避免无 lifecycle 的独立 `SUB_TITLE` 被吞掉。另把“独立结果已存在”限定为确实得到可展示 generic/safe result 的 `CAPABILITY_RESULT_DELTA`，不让未认证 raw interim result 抑制 completion terminal facts。

## Hard Gates

| Gate | 结果 | 证据 |
|---|---|---|
| Frozen core contract | PASS | diff 不含 `agent-contracts`、public exports、schema、DTO、event type 或 payload 字段 |
| Architecture | PASS（提交范围） | 只修改共享 browser projection/local disclosure；未增加 host 分支、runtime truth、persistence 或 transport owner |
| Minimal kernel | PASS（提交范围） | 不修改 backend kernel；root build 通过，stream/history characterization 覆盖 live、compaction、merge 和 history |
| Validation | PASS WITH FOLLOW-UP | 受影响测试、frontend build、三宿主 build、目标 e2e、contract 重跑和 OpenSpec 全量 strict 通过；root broad suites 仍有下述未改 baseline failures |
| OpenSpec authoring | PASS | 本文件前半部分的 `nextagent-skill-review` 对 `fix-process-occurrence-causality` 结论为 PASS |

## Architecture / Security / Context 结论

- 输入分段只从既有 canonical `USER_INPUT_RECEIVED` 和既有 scope 坐标派生，不创建第二套 server truth。
- structured section 仅由显式 `toolCallId` 与真实 Capability lifecycle 关联；浏览器不解析 raw stdout，不按正文、关键词或邻接关系猜测归属。
- section 继续复用既有 Markdown/PIU renderer；未新增 `dangerouslySetInnerHTML`、URL/style 注入面、Web Storage 或可信权限判断。
- UI section、800 ms disclosure 和 manual override 都是 transient browser view state，不持久化，也不进入模型上下文。
- canonical Capability Result 仍是唯一模型 tool-result；未改变 Message、Gateway、table、API 或 producer contract。

## Validation

通过：

- `frontend/agent-web`: 11 个相关文件、250 个测试；`npm run build`；`npm run build:vite:modes`
- Playwright：三宿主失败工具默认展开 3/3；process message/history projection 4/4
- root：`npm run build`
- context/persistence：release config 下 2 files、39 tests
- contract：full run 唯一 Cron 并发失败单独重跑 1/1 通过
- OpenSpec：`openspec validate --all --strict` 282/282
- `git diff --check`

未由本提交造成、但仍需基线 owner 跟进：

- `npm run lint:architecture` 的 2 个失败来自未改动的 `packages/agent-remote-deployment/src/index.ts` 对 `@nextagent/agent-app/testing` 的既有 import；同一内容已存在于 `origin/main@9b68ae1fb`。
- root `npm test` 沙箱外复跑为 2105 passed，剩余两个 `agent-remote-deployment` suite 被同一既有 default config import 阻断，另一个 `agent-log` 历史文件压缩断言在未改动代码上稳定失败。
- `process-history-modes` 的旧综合 journey 仍使用未认证 generic raw tool result 并期望其可见，与当前 safe-result 基线冲突；本 change 相关三宿主 failure disclosure journey 3/3 通过，未修改 producer 或放宽浏览器信任边界。

## Summary

PASS WITH FOLLOW-UP。本提交自身的 OpenSpec、架构边界、安全边界、三宿主一致性和受影响验证均满足要求；允许提交实现 commit，但在未修复上述 `origin/main` 基线门禁前不应把整仓 broad gates 描述为全绿，也不执行 push。
