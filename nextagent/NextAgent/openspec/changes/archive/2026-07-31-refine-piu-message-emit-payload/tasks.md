## 1. PiuMessage payload 形状修正与受控白名单

- [x] 1.1 在 `PiuMessage.tsx` 新增编译期常量 `SPREAD_DATA_PIU_NAMES: ReadonlySet<string>`，初始包含 `"dte-bi-agent"`；新增纯函数 `buildPiuEmitPayload(content, hostFields)`：`content.piuName` 命中白名单时返回 `{ ...content.data ?? {}, ...hostFields }`，否则返回 `{ ...content, ...hostFields }`。effect 内 `piu.emit` 改为调用该函数，`hostFields` 固定为 `{ wrapperId, containerId, handleExpandPanelOpen, handleExpandPanelClose, expandPanelId }`。保留 `parsePiuContent` 和 fallback placeholder 逻辑不变。
  验证：`AnswerSegments.test.tsx` 新增断言——默认 piuName emit 第二参含 `piuName`/`piuVersion`/`method`/`data` 及全部 hostFields；`dte-bi-agent` emit 第二参含 `content.data` 业务字段且不含路由元；现有 `parsePiuContent` 与 dev mode placeholder 测试通过。
  来源：Requirement “PIU Message Rendering” Scenario “PIU normal rendering with whole content payload”、Scenario “PIU in spread-data allowlist emits flattened data”、Scenario “spread-data payload degrades to host fields when data is absent”、Scenario “PIU unavailable fallback”。

## 2. 契约测试与 negative verification

- [x] 2.1 新增 whole payload 默认契约测试：非白名单 piuName，断言 `piu.emit` 第二参包含 `piuName`/`piuVersion`/`method`/`data` 及全部 hostFields（`wrapperId`/`containerId`/`handleExpandPanelOpen`/`handleExpandPanelClose`/`expandPanelId`）。
  验证：测试通过。
  来源：Requirement “PIU Message Rendering” Scenario “PIU normal rendering with whole content payload”。
- [x] 2.2 新增 spread-data 白名单契约测试：piuName 为 `dte-bi-agent`，断言 emit 第二参包含 `content.data` 的业务字段、全部 hostFields，且不含 `piuName`/`piuVersion`/`method`。
  验证：测试通过。
  来源：Requirement “PIU Message Rendering” Scenario “PIU in spread-data allowlist emits flattened data”。
- [x] 2.3 negative verification：构造 `content.data` 含与 hostFields 同名的 key（如 `wrapperId: "evil"`），断言 whole 与 spread-data 两种模式下 payload 中 `wrapperId` 最终值为 hostFields 提供的 `useId()` 值，不被业务字段静默覆盖；spread-data 模式下 `content.data` 为 `null`/`undefined` 时 payload 仅含 hostFields。
  验证：测试通过，断言最终值等于 hostFields 提供的值。
  来源：Requirement “PIU Message Rendering” Scenario “host fields override same-named content keys”、Scenario “spread-data payload degrades to host fields when data is absent”。

## 3. 验证与收尾

- [x] 3.1 运行 `openspec validate refine-piu-message-emit-payload --strict` 通过。
  验证：命令输出 PASS。
  来源：AGENTS.md 验证门禁。
- [x] 3.2 在 `frontend/agent-web` 运行相关 Vitest（`AnswerSegments.test.tsx`）通过。
  验证：测试通过。
  来源：AGENTS.md 验证门禁。
- [x] 3.3 在 `frontend/agent-web` 运行 `npm run build` 通过。
  验证：build 成功。
  来源：AGENTS.md 验证门禁。

## 归档前更新基线（待实施后）

- 同步 `openspec/specs/agent-web-structured-message-rendering/spec.md`：将 MODIFIED “PIU Message Rendering” requirement（含 spread-data 受控例外规则与场景）同步到基线。
- 其余长期文档：无。
