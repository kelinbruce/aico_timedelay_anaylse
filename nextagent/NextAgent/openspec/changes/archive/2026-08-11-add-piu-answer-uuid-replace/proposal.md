## 背景与问题（Why）

答案区域的 `TOOL_STRUCTURED_DELTA` ANSWER + PIU 渲染当前对每条 PIU 事件独立生成一个 segment，不做替换。实际业务场景中，后端可能对同一个 PIU 卡片多次推送更新数据（例如诊断步骤状态从 pending 变为 success），每次都携带相同的 `uuid` 标识。当前行为会导致同一张 PIU 卡片在答案区域重复渲染多份，用户看到的是多张内容相近的卡片堆叠，而非最新数据覆盖旧数据。

## 变更范围（What Changes）

### PIU content 新增 uuid 字段

PIU ANSWER 事件的 `content` 数据结构新增可选字段 `uuid: string`。该字段由后端在 `structuredPayload.content` 中携带，前端不做 runtime schema 校验，仅做存在性和非空字符串检查。

### buildAnswerSegments uuid 替换

`buildAnswerSegments` 在 push PIU segment 后，如果该 segment 的 `content` 中存在非空 `uuid`，则移除 segments 数组中之前同 `uuid` 的 PIU segment。新 segment 保留在新事件的 `sequence` 位置，中间的 text/structured segment 不受影响。

行为规则：
- `uuid` 缺失时：保持现有行为，每条 PIU 独立渲染。
- `uuid` 存在时：同 `uuid` 的 PIU 只保留最后一条（按事件 sequence 顺序），位置跟随新事件。
- `uuid` 提取兼容对象和 JSON 字符串两种 content 形态。

### AnswerSegments uuid-based React key

`AnswerSegments` 组件对携带非空 `uuid` 的 PIU segment 使用 uuid 作为 React key（`structured-PIU-uuid-{uuid}`），而非默认的 sequence-based key。这样当同 uuid 的 PIU segment 被替换时，React 识别为同一个组件实例，PiuMessage 保持挂载不卸载，每次 content 变化触发 `useEffect` 重新执行 `piu.emit`，确保每条 PIU 数据都被发送到宿主组件执行。`uuid` 缺失时仍使用 sequence-based key（`structured-PIU-{sequence}`），每条 PIU 独立挂载。

## Capability 影响（Capabilities）

### 修改的 Capability
- `agent-web-structured-message-rendering`: 修改 "Answer Content Mixed Rendering" requirement，新增 PIU uuid 替换行为约束和 uuid-based React key 约束。

## 影响范围（Impact）

- `frontend/agent-web/src/features/chat/presentation/answerContent.ts`: 新增并导出 `readPiuContentUuid`；新增 `removeEarlierPiuSegmentByUuid` helper；`buildAnswerSegments` 的 PIU push 分支新增 uuid 替换逻辑。
- `frontend/agent-web/src/features/chat/components/structured/AnswerSegments.tsx`: 导入 `readPiuContentUuid`，PIU segment 携带 uuid 时使用 uuid-based React key。
- `frontend/agent-web/src/features/chat/components/structured/PiuMessage.tsx`: `PiuMessageProps['content']` 类型新增 `uuid?: string` 字段。
- `frontend/agent-web/src/features/chat/components/structured/AnswerSegments.test.tsx`: 新增 uuid 替换测试和 PiuMessage 保持挂载测试。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：
- `openspec/specs/agent-web-structured-message-rendering/spec.md`: 修改 "Answer Content Mixed Rendering" requirement，补充 PIU uuid 替换场景和 uuid-based key 场景。

长期场景：
- `openspec/overview.md`: 无。

设计视图：
- `openspec/designs/architecture/`: 无。
- `openspec/designs/modules/agent-web.md`: 归档时补充 PIU uuid 替换的模块职责说明。
- `openspec/designs/adr/`: 无。
- `openspec/designs/spec-to-design-map.md`: 无新增导览，修改现有 `agent-web-structured-message-rendering` 导览行。

验证入口：
- `frontend/agent-web` Vitest: `AnswerSegments.test.tsx`（uuid 替换、无 uuid 保留、JSON 字符串 uuid 替换、PiuMessage 保持挂载）。
- `frontend/agent-web` `npm run build`。
- `openspec validate add-piu-answer-uuid-replace --strict`。
