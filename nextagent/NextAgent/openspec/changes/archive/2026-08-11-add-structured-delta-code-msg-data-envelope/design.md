## 设计范围

本 change 影响唯一 Function：

| Function | 目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.16 识别和投射结构化工具增量` | 新增 code 信封形状识别 | `specs/tool-structured-delta/spec.md` MODIFIED `Structured Event Shape Validation` | 下文 FN-5.16 章节 |

## FN-5.16 识别和投射结构化工具增量

### 目标与规范依据

本 change 为 `tool-structured-delta` spec 新增 code 信封形状识别。spec 中 `Structured Event Shape Validation` requirement 从两种形状扩展为三种：直接三段式、status 信封和 code 信封。

**本 Function 的目标 Requirements**：

- canonical spec：`tool-structured-delta`
- MODIFIED `Structured Event Shape Validation`：完整重述，新增 code 信封形状描述和场景

### 当前实现

`unwrapStructuredEnvelope` 在 `structured-delta-identification.ts` 中，被 `identifyStructuredDelta` 调用。当前仅识别一种信封形状：

```json
{"status":"ok","data":{"raw":"<json-string>"}}
```

`identifyStructuredDelta` 按以下顺序尝试识别：
1. 直接形状：候选 JSON 顶层是 `{eventType, messageType, content}` 三元组。
2. status 信封解包：候选 JSON 是 `{"status":"ok","data":{"raw":"..."}}`，`raw` 字段是内层三元组的 JSON 字符串。

Bash、ApiCall 和 CLIP 三条路径均通过 `identifyStructuredDelta` 自动获得识别支持。

### GAP 分析

| 规范目标 | 当前事实 | 待闭合差距 |
|---|---|---|
| 支持 code 信封 `{"code":200,"msg":"success","data":"<json-string>"}` | `unwrapStructuredEnvelope` 仅识别 status 信封 | 新增 code 信封识别分支 |
| code 信封 `data` 字段为直接 JSON 字符串 | status 信封的 `data.raw` 是嵌套对象中的字符串 | code 信封直接取 `data` 字段 |
| code 信封以 `code === 200` 为成功标识 | status 信封以 `status === "ok"` 为成功标识 | 新增 `code === 200` 判断 |
| 两种信封共享 `parseJsonObjectString` 逻辑 | 两处重复 `JSON.parse + isJsonObject` | 提取共享辅助函数 |

### 修改方案

1. **提取 `parseJsonObjectString` 辅助函数**：将 `JSON.parse + isJsonObject` 逻辑提取为纯函数 `parseJsonObjectString`，消除两处重复。
2. **`unwrapStructuredEnvelope` 新增 code 信封分支**：在 status 信封识别之后，新增 code 信封识别：
   - 判断 `code === 200`（精确匹配，不做范围匹配）
   - 判断 `data` 为 `string` 类型
   - 调用 `parseJsonObjectString(data)` 解析
   - 解析结果通过 `isStructuredEvent` 校验
3. **识别顺序不变**：`identifyStructuredDelta` 仍按"先试直接形状，再试信封解包（先 status 后 code）"的统一流程。
4. **安全检查不变**：code 信封解析后的内容仍走 `hasSensitiveStructuredContent` 安全检查。
5. **owner**：`structured-delta-identification.ts` 属于 `agent-core`，owner 为 `agent-core` 模块。
6. **不修改的边界**：不改 `structured-delta-safety.ts`、持久化策略、前端、CLIP provider 代码。

#### 验证关注点

- code 信封 positive case：正确识别并 emit
- code 非 200 negative case：不 emit，回退
- code 信封 malformed data negative case：不 emit，回退
- Bash code 信封 emission 测试
- status 信封不回归

## 长期基线刷新计划

| 类别 | 目标 | 说明 |
|---|---|---|
| stable spec | `openspec/specs/tool-structured-delta/spec.md` | 在 "Structured Event Shape Validation" requirement 中新增 code 信封形状描述和场景；新增 `所属 Function` 元数据 |
| Function | `openspec/designs/functions/D5-Capability能力体系/D5.1-能力治理/FN-5.16-识别和投射结构化工具增量.md` | 新建 Function 文档，承载描述、前置条件、输入、输出、处理过程、结果、规格和状态 |
| Feature | 无 | 不涉及用户价值变化 |
| overview | 无 | 不涉及系统范围变化 |
| architecture | 无 | 不涉及架构设计变化 |
| modules | 无 | 不涉及模块职责变化 |
| ADR | 无 | 不涉及技术决策 |
| spec-to-design-map | `openspec/designs/spec-to-design-map.md` | `tool-structured-delta` 行新增 Function 映射 |