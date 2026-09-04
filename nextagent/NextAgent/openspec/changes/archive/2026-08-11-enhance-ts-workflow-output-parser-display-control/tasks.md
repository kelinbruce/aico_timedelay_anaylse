# Tasks

## 1. 扩展 `resolveDisplayControl` 读取新字段

- [x] 1.1 读取 `output_parser.type`（字符串）并对照产品规格 display-type 集合（TEXT/CHART/CHART_PRO/HTML/TABLE/PIU/DSL）校验。作为 `displayType` 存入返回值。映射到 `ToolMessageType`：PIU->"PIU"，DSL->"DSL"，其余->"TEXT"。
  验证：unit test 断言每种 type 映射到正确的 ToolMessageType
  来源：design D2

- [x] 1.2 读取 `output_parser.data`（对象）。当为非空对象时作为 `displayData` 存入返回值；否则为 `undefined`。
  验证：unit test 断言返回 data 对象；非对象返回 undefined
  来源：design D3

- [x] 1.3 读取 `output_parser.message_level` / `messageLevel`（字符串）。对照 `TOOL_EVENT_TYPES` 校验。作为 `messageLevel`（类型为 `ToolEventType | undefined`）存入返回值。
  验证：unit test 断言有效 level 被返回；无效 level 返回 undefined
  来源：design D4

- [x] 1.4 读取 `output_parser.show_aigc` / `showAigc`（布尔值，默认 false）。作为 `showAigc` 存入返回值。
  验证：unit test 断言 true/false/默认行为
  来源：design D5

## 2. 在 `projectStructuredDelta` 中使用新字段

- [x] 2.1 当 `displayType` 已设置时，用映射后的 `ToolMessageType` 替代默认 "TEXT" 作为 structured delta 的类型。在 `attachWorkflowFields` payload 中把 `displayType` 作为 metadata 传入。
  验证：projector test 断言 payload 中的 ToolMessageType 和 displayType
  来源：design D2

- [x] 2.2 当 `displayData` 已设置时，用它替代 `serializeOutput` 作为 `TOOL_STRUCTURED_DELTA` 的 `content`。缺失时回退到既有序列化。
  验证：projector test：data 存在 -> content = data 对象；data 缺失 -> content = 序列化字符串
  来源：design D3

- [x] 2.3 当 `messageLevel` 已设置时，用它（经 `mapLevelToScope` 后）替代 answer-node 推导的 level 作为 `toolEventType`。缺失时保持既有的 answer/detail 推导。
  验证：projector test：message_level 已设置 -> 覆盖 level；缺失 -> answer-node 推导
  来源：design D4

- [x] 2.4 当 `showAigc` 为 true 时，通过 `attachWorkflowFields` 在 structured delta payload 中包含 `aigc: true`。为 false 时省略该字段。
  验证：projector test：show_aigc true -> payload 含 aigc；false -> 无 aigc 字段
  来源：design D5

- [x] 2.5 确保 `output_parser` 驱动的解析优先于 `tryOutputDrivenDelta`：若 `output_parser.data` 已设置，它覆盖 `output["content"]`；若 `output_parser.message_level` 已设置，它覆盖 `output["level"]`；若 `output_parser.type` 已设置（当路径由 data/message_level 触发时），它覆盖 `output["type"]`。
  验证：projector test：output_parser 和 output 同时有 data/level -> output_parser 胜出
  来源：design D7

- [x] 2.6 只有 `type` 而没有 `data` 或 `message_level` 时 MUST NOT 触发 output_parser 驱动路径。回退到正常路径。
  验证：projector test：type PIU 无 data -> output_parser 路径、PIU messageType、payload 含 displayType
  来源：design D8

- [x] 2.7 只有 `show_aigc` 而没有 `data` 或 `message_level` 时 MUST NOT 触发 output_parser 驱动路径。已知限制。
  验证：projector test：单独 show_aigc true -> payload 无 aigc
  来源：design D5, D8

## 3. 回归与验证

- [x] 3.1 既有 `show_title`/`show_content` 测试原样通过。
  验证：`npx vitest run --config vitest.config.ts packages/agent-core/tests/workflow-runtime-event-projector.test.ts`
  来源：design non-goals

- [x] 3.2 既有输出序列化测试原样通过。
  验证：同一测试套件
  来源：design non-goals

- [x] 3.3 TypeScript build 通过且无新错误。
  验证：`npx tsc -b packages/agent-core/tsconfig.json --pretty false`
  来源：AGENTS.md validation gates

- [x] 3.4 架构 lint 通过。
  验证：`npm run lint:architecture`
  来源：AGENTS.md validation gates

- [x] 3.5 完整 agent-core 测试套件通过。
  验证：`npx vitest run --config vitest.config.ts packages/agent-core/tests/`
  来源：AGENTS.md validation gates
