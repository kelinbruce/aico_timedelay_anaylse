# add-piu-history-flag

## Why

平台集成方的答案区 PIU 组件需要在同一渲染契约中区分“历史回显”和“实时问答”。当前 `PiuMessage` 只把结构化答案的 PIU 内容和扩展面板宿主字段发给外部 PIU，外部 PIU 无法可靠判断当前内容是历史加载还是实时流式输出，只能自行猜测，容易在两种场景重复初始化或使用错误的展示策略。

## 目标与非目标

**目标：**

- 答案区结构化 PIU 的 `piu.emit` payload 新增可信布尔字段 `isHistory`。
- `isHistory === true` 表示该结构化 PIU 内容来自历史回显；`isHistory === false` 表示该结构化 PIU 内容来自实时问答。
- 外部 PIU 可以依据 `isHistory` 选择展示或初始化策略。
- `isHistory` 与既有宿主字段一样由前端可信投影生成，并覆盖 content/data 中的同名字段。

**非目标：**

- 不修改后端 `TOOL_STRUCTURED_DELTA` 事件、持久化结构或模型输出。
- 不修改 `PiuRenderer` / AICOConfig 的 answerOperator 注入契约。
- 不改变 PIU 的加载、卸载、重复 emit 去重和扩展面板行为。
- 不为 Process Panel PIU、历史会话回放 PIU 或其他宿主注入 PIU 增加该字段。

## What Changes

- 修改答案区结构化 PIU 渲染契约：`PiuMessage` 在 whole-content 和 spread-data 两种 payload 形态中都附加 `isHistory`。
- 修改结构化答案投影到 PIU 的传参边界：`AnswerSegments` 从结构化 PIU segment 的 `content.data` 形状推导 `isHistory`，并传给 `PiuMessage`。
- 修改外部 PIU 可观察契约：`isHistory` 属于后置展开的宿主字段，MUST 覆盖不可信 stream content/data 中的同名字段；同一 PIU 内容的 trusted `isHistory` 变化时 MUST 重新 emit。
- `isHistory` 的判定来源是结构化 PIU segment 中 `content.data` 是否为数组；该判定不依赖 `uuid` 或整个 turn 的 live 状态，同一 turn 混有 live event 时，数组 `data` 的 PIU segment 仍 MUST 保持 `isHistory: true`。
- `PiuMessage` 的本地不可预览与等待宿主渲染提示 MUST 使用 active i18n locale 提供本地化文案。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

无。

### 修改的 Function

- `FN-10.6 前端定制` → `specs/agent-web-structured-message-rendering/spec.md`
  - 功能边界：答案区结构化 PIU 的外部 emit payload 新增 `isHistory` 字段，用于区分历史回显与实时问答。
  - 系统质量属性：可测试性、可维护性。
  - 映射说明：canonical spec。

## 影响范围（Impact）

- 平台集成方实现的答案区 PIU 组件会收到新增的 `isHistory` 字段；不读取该字段的既有 PIU 不受影响。
- 受影响代码：`frontend/agent-web` 的 `AnswerSegments`、`PiuMessage` 和 i18n 资源。
- 受影响测试：`AnswerSegments.test.tsx`、`TurnBlock.piuHistory.test.tsx`。
- 不影响后端 API、配置、持久化和运维面。
