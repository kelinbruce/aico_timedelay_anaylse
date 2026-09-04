## 背景

现有 `TOOL_STRUCTURED_DELTA` 结构化 delta 识别支持两种信封形状：

1. 直接三段式：`{eventType, messageType, content}`
2. status 信封：`{"status":"ok","data":{"raw":"<json-string>"}}`

电信运维场景中，部分后端 API 返回的响应体采用另一种信封格式：

```json
{"code":200,"msg":"success","data":"{\"eventType\":...,\"messageType\":...,\"content\":...}"}
```

该格式与 status 信封的区别在于：成功标识从 `status:"ok"` 变为 `code:200`，数据从 `data.raw`（嵌套对象中的字符串）变为 `data`（直接的字符串）。Bash 调用 `curl` 或 ApiCall 调用 HTTP API 返回此格式时，同样需要 emit `TOOL_STRUCTURED_DELTA` 驱动前端结构化展示。

本次 change 将信封识别范围从 status 信封扩展为支持 status 信封和 code 信封两种。

## 目标

- `unwrapStructuredEnvelope` 新增 code 信封形状识别：`{"code":200,"msg":"success","data":"<json-string>"}`，`data` 字段为直接的 JSON 字符串。
- 提取 `parseJsonObjectString` 辅助函数消除两处重复的 `JSON.parse + isJsonObject` 逻辑。
- Bash、ApiCall、CLIP 三条路径均通过共享 `identifyStructuredDelta` 自动获得新信封支持，无需在各路径单独添加。
- 单元测试和 emission 测试覆盖新信封的 positive/negative case。

## 非目标

- 不改 `structured-delta-safety.ts`。
- 不改持久化策略（`runTimelineEventPersistencePolicy`）。
- 不改前端。
- 不做历史回放。
- 不处理其他信封格式（如 `{result:..., data:...}`），后续如需要另开 change。
- 不清理 CLIP provider 整套代码。

## 变更范围

1. **`unwrapStructuredEnvelope` 扩展**：在 `structured-delta-identification.ts` 中，`unwrapStructuredEnvelope` 新增对 `{"code":200,"msg":"success","data":"<json-string>"}` 信封形状的识别。提取 `parseJsonObjectString` 辅助函数消除两处重复的 `JSON.parse + isJsonObject` 逻辑。
2. **共享识别不变**：`identifyStructuredDelta` 仍按"先试直接形状，再试信封解包"的统一流程。Bash、ApiCall、CLIP 三条路径均通过 `identifyStructuredDelta` 自动获得新信封支持。
3. **安全检查不变**：新信封解析后的内容仍走 `hasSensitiveStructuredContent` 安全检查。
4. **测试扩展**：单元测试和 emission 测试覆盖新信封的 positive/negative case。

## Function 影响（OpenSpec Capabilities）

### 新增 Function

- `FN-5.16 识别和投射结构化工具增量`
  - canonical spec：`tool-structured-delta`（既有 spec，本次作为 canonical target 主动修改）
  - 变化边界：`unwrapStructuredEnvelope` 新增 code 信封形状识别
  - 涉及系统质量属性：安全（复用 `hasSensitiveStructuredContent`）、可测试性（纯函数测试）

> `tool-structured-delta` 是既有 OpenSpec capability，但尚未在功能树中建立对应 Function 文档。本次 change 作为 canonical target 主动修改该 spec，按 config.yaml 规则声明唯一所属 Function，属于 legacy 收敛。

## 被动影响

- `packages/agent-core/src/tools/structured-delta-identification.ts`：`unwrapStructuredEnvelope` 重构为两形状分支，提取 `parseJsonObjectString`。
- `packages/agent-core/tests/structured-delta-identification.test.ts`：新增 code 信封 positive/negative case。
- `packages/agent-core/tests/tool-structured-delta-emission.test.ts`：新增 Bash code 信封 emission 测试。