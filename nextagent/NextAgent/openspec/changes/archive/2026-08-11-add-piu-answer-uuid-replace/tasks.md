## 实现任务

### 1. answerContent.ts uuid 替换逻辑

- [x] 新增并导出 `readPiuContentUuid(content: unknown): string | null`，兼容对象和 JSON 字符串
- [x] 新增 `removeEarlierPiuSegmentByUuid(segments: AnswerSegment[], uuid: string): void`
- [x] `buildAnswerSegments` PIU push 分支调用 uuid 替换

验证: `AnswerSegments.test.tsx` uuid 替换测试通过

### 2. AnswerSegments.tsx uuid-based React key

- [x] 导入 `readPiuContentUuid`
- [x] PIU segment 携带 uuid 时使用 `structured-PIU-uuid-{uuid}` 作为 React key
- [x] uuid 缺失时保持 sequence-based key

验证: `npm run build` 通过；PiuMessage 保持挂载测试通过

### 3. PiuMessage 类型对齐

- [x] `PiuMessageProps['content']` 新增 `uuid?: string` 字段

验证: `npm run build` 通过

### 4. 测试覆盖

- [x] 同 uuid 替换只留最后一条
- [x] 同 uuid 替换时保留中间 text segment
- [x] 不同 uuid 各自保留
- [x] 无 uuid 各自保留
- [x] JSON 字符串形态 uuid 替换
- [x] PiuMessage 保持挂载，每条数据都 emit

验证: `npm test -- --run AnswerSegments.test.tsx` 全部通过

### 5. OpenSpec 验证

- [x] `openspec validate add-piu-answer-uuid-replace --strict` 通过
