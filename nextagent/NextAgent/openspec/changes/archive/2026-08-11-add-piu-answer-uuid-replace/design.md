## 设计决策

### D1: uuid 替换在 buildAnswerSegments 层完成

uuid 替换放在 `buildAnswerSegments` pure function 层，而非 `AnswerSegments` 组件层或 `PiuMessage` 组件层。原因：

1. `buildAnswerSegments` 已经是所有 answer segment 的唯一构建入口，PIU 的 TEXT 合并逻辑也在这里完成，uuid 替换与 TEXT 合并是同层同类的"segment 级别替换/合并"操作。
2. 在组件层替换需要多个 `PiuMessage` 实例之间共享状态，违背 React 单向数据流和组件独立性原则。
3. pure function 层替换使行为可测试、可预测，不依赖组件挂载顺序。

### D2: uuid 提取兼容 JSON 字符串

`readPiuContentUuid` 同时处理对象和 JSON 字符串两种 content 形态。这是因为 `parsePiuContent` 在渲染层才做 JSON.parse，而 `buildAnswerSegments` 拿到的 `payload.content` 可能是任意 `JsonValue`。在替换层提前解析 uuid 不引入额外耦合，因为只读取一个字段，不做完整 schema 校验。

### D3: 替换只移除更早的同 uuid segment，不移除刚 push 的

`removeEarlierPiuSegmentByUuid` 遍历范围是 `segments[0..length-2]`，即排除刚 push 的最后一条。这保证：
- 新 segment 一定保留。
- 只有更早的同 uuid segment 被移除。
- 如果有多条更早的同 uuid segment（理论上不应出现但防御性处理），只移除第一条，因为每次 push 后都会立即替换，正常流程中最多只有一条旧的。

### D4: AnswerSegments 使用 uuid-based React key 保持 PiuMessage 挂载

当 PIU segment 携带非空 `uuid` 时，`AnswerSegments` 组件使用 `structured-PIU-uuid-{uuid}` 作为 React key，而非默认的 `structured-PIU-{sequence}`。这样当 `buildAnswerSegments` 移除旧 segment 并 push 新 segment 时，React 识别为同一个组件实例（key 不变），PiuMessage 不会卸载/重新挂载，而是接收新的 content prop。PiuMessage 的 `useEffect` 依赖 `contentDependency`（content 的 JSON 字符串），content 变化时 effect 重新执行，调用 `piu.emit` 发送新数据到宿主组件。这确保每条 PIU 数据都被 emit 执行，而不是只渲染最后一个。

`uuid` 缺失时仍使用 sequence-based key，每条 PIU 独立挂载，保持现有行为。

### D5: 不影响 EXPAND_PANEL 和 DETAIL 路径的 PIU

uuid 替换仅作用于 `toolEventType === 'ANSWER'` 的 PIU segment。`EXPAND_PANEL` 路径的 PIU 走 `useExpandPanelStreamWatcher`，有独立的 content 替换逻辑；`DETAIL` 路径的 PIU 走 `processDetails.ts` 的 `structuredSegments` 累积逻辑。两者不受本次改动影响。

### D6: uuid 不进入 PiuMessage emit payload

`uuid` 是前端替换标识，不参与 PIU 宿主渲染。`PiuMessage` 组件的 `buildPiuEmitPayload` 不读取 `uuid` 字段，emit payload 的 whole-content 和 spread-data 两种形态都不包含 `uuid`。这避免将前端替换标识泄漏到 PIU 宿主组件。但由于 uuid 在 content 中，whole-content 模式会原样传递 content（含 uuid），这是可接受的——宿主组件可以忽略未声明字段。

### D7: 不修改 tool-structured-delta spec

后端 `tool-structured-delta` spec 的 "Structured Event Shape Validation" requirement 定义了 `content` 字段为 `JsonValue`，不约束其内部结构。`uuid` 是 `content` 对象内的业务字段，由后端 CLIP/structuredPayload 决定，不需要修改后端 spec。前端只做存在性检查，不做 schema 校验，与现有 `piuName`/`piuVersion`/`data`/`method` 字段的处理方式一致。
