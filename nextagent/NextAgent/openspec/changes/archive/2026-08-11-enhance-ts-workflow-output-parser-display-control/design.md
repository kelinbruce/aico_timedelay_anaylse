# Design: Enhance output_parser with display type, data, message_level and show_aigc

## Context

`WorkflowRuntimeEventProjector.resolveDisplayControl` currently returns only `{ showTitle, showContent }`. It reads `show_title`/`showTitle` and `show_content`/`showContent` from the resolved output parser (via `resolveOutputParser`), defaulting both to `true`.

The projector's `projectStructuredDelta` builds `TOOL_STRUCTURED_DELTA` events. For `NODE_COMPLETED`, it derives the event level from the answer-node reverse walk (ANSWER for answer node, DETAIL otherwise) and serializes the output via `serializeOutput`. It does not read `type`, `data`, `message_level`, or `show_aigc` from the output parser.

`tryOutputDrivenDelta` reads `type`/`level`/`content` from the node's **output** object (not from `output_parser`). This is a separate mechanism for nodes that embed display metadata in their output. The new `output_parser`-driven resolution must take precedence over this when configured.

`interaction-nodes.ts` has local `readDisplayOutputType` and `readDisplayLevel` functions, but these only affect the DISPLAY node's streaming channel, not the structured delta.

`ToolMessageType` enum: `["PIU", "DSL", "ACTION", "OPERATOR", "FILE", "TEXT"]`.
`ToolEventType` enum: `["TITLE", "DETAIL", "ANSWER", "SUB_TITLE", "SUB_DETAIL", "SUB_CONCLUSION", "EXPAND_PANEL"]`.

## Goals / Non-Goals

**Goals:**
- Read `type`, `data`, `message_level`, `show_aigc` from the resolved output parser in the projector.
- Use `data` as structured delta content when present; fall back to output serialization.
- Use `message_level` as the structured delta event level when present; fall back to answer-node derivation.
- Pass `type` and `show_aigc` as metadata in the structured delta payload.

**Non-Goals:**
- Do NOT add new `ToolMessageType` or `ToolEventType` enum values to `agent-common`.
- Do NOT implement HOFS/ZENITH storage routing (TS runtime uses unified timeline events).
- Do NOT modify `agent-contracts` schemas (`outputParser` is already `WorkflowOpaqueObjectSchema`).
- Do NOT change `interaction-nodes` local `readDisplayOutputType`/`readDisplayLevel` (serves streaming, not structured delta).
- Do NOT change `tryOutputDrivenDelta` (output-driven path remains as fallback).

## Decisions

### D1: Extend `resolveDisplayControl` return type

`resolveDisplayControl` currently returns `{ showTitle, showContent }`. Extend it to also return:

```typescript
{
  showTitle: boolean;
  showContent: boolean;
  displayType: string | undefined;      // raw type string from output_parser
  displayData: JsonObject | undefined;   // data object from output_parser
  messageLevel: ToolEventType | undefined; // validated message_level
  showAigc: boolean;                     // show_aigc flag, default false
}
```

All new fields are read from the same resolved output parser object (via existing `resolveOutputParser`). snake_case and camelCase variants are checked for each field, matching the existing `show_title`/`showTitle` pattern.

Source: existing `resolveDisplayControl` pattern + product spec field definitions.

### D2: `type` resolution and `ToolMessageType` mapping

Read `output_parser.type` (or `output_parser.type` camelCase — same key, case-insensitive check not needed since it's a single word).

Validate against the product spec display-type set (`docs/workflow/Recipe specification.md`): `TEXT`, `CHART`, `CHART_PRO`, `HTML`, `TABLE`, `PIU`, `DSL`. `OBJECT` is excluded (exists only in `interaction-nodes.ts` legacy code, not in the product spec).

Map to `ToolMessageType`:
- `PIU` -> `"PIU"`
- `DSL` -> `"DSL"`
- `TEXT`, `TABLE`, `CHART`, `CHART_PRO`, `HTML` -> `"TEXT"`

The raw type string is passed as `displayType` in the payload so the frontend can render appropriately (e.g., render a table when `displayType = "TABLE"`).

This mapping avoids adding new `ToolMessageType` enum values. `PIU` and `DSL` are the only types that need distinct transport-level handling; other types are carried as metadata.

Source: `TOOL_MESSAGE_TYPES` enum + product spec type list.

### D3: `data` content override

When `output_parser.data` is a non-empty object, use it as the `content` of `TOOL_STRUCTURED_DELTA` instead of `serializeOutput`.

This is the primary mechanism for PIU content delivery: `data: { piuName, piuVersion, data, method }` becomes the structured delta content directly.

When `data` is absent, null, or not an object, fall back to `serializeOutput(event)` (existing behavior).

`data` takes precedence over `tryOutputDrivenDelta`'s `output["content"]` path. The resolution order for content is:
1. `output_parser.data` (if present and non-empty object)
2. `tryOutputDrivenDelta` output-driven content (if output has `type`/`level`/`content` fields)
3. `serializeOutput(event)` (default)

Source: product spec "若 data 字段存在，则使用 data 作为消息内容；否则从节点输出变量中提取文本内容".

### D4: `message_level` overrides level derivation

When `output_parser.message_level` (or `messageLevel`) is a string, validate it against `TOOL_EVENT_TYPES`. If valid, use it as the `toolEventType` for the structured delta.

For sub-workflow scope, the level is mapped via `mapLevelToScope` (e.g., `TITLE` -> `SUB_TITLE`), matching existing behavior.

When `message_level` is absent or invalid, fall back to the existing answer-node-derived level (ANSWER for answer node, DETAIL otherwise).

`message_level` takes precedence over `tryOutputDrivenDelta`'s `output["level"]` path.

Source: product spec "message_level: TITLE/ANSWER/DETAIL" + existing `titleLevel`/`detailLevel`/`answerLevel` pattern.

### D5: `show_aigc` passthrough

When `output_parser.show_aigc` (or `showAigc`) is `true` AND the output_parser-driven path is triggered (by `data` or `message_level`), include `aigc: true` in the structured delta payload.

Default `false`. When `false`, the `aigc` field is omitted from the payload.

`show_aigc` alone does NOT trigger the output_parser-driven path (see D8). When `show_aigc: true` is used without `data` or `message_level`, the `aigc` flag is not emitted. This is a known limitation — global propagation of `showAigc` to all structured delta paths is deferred to a future change.

Source: product spec "show_aigc: 是否展示 AIGC 标签，默认 false".

### D6: HOFS/ZENITH not applicable to TS runtime

The product spec states: "当 type = PIU 时，数据存储到专用存储（HOFS）；其他类型存储到通用存储（ZENITH）。"

The TS runtime does not have HOFS/ZENITH storage routing. All workflow output is projected as `TOOL_STRUCTURED_DELTA` timeline events, persisted in the run timeline. PIU data (including `piuName`, `piuVersion`, `data`, `method`) is carried inline as the `content` field of the structured delta.

This is an explicit design exception from the legacy product spec. Rationale: the TS runtime uses a unified timeline event persistence model. The legacy dual-storage model (HOFS for PIU, ZENITH for others) was specific to the Java runtime architecture and is not applicable.

Source: AGENTS.md "不得把未被 OpenSpec 定义的行为直接写进实现" — this exception is documented here in the design.

### D7: `output_parser`-driven resolution precedence over output-driven delta

`tryOutputDrivenDelta` reads `type`, `level`, and `content` from the node's output object. This is a legacy mechanism for nodes that embed display metadata in their business output.

The `output_parser`-driven resolution takes precedence:
1. If `output_parser.data` is set, it overrides `output["content"]`.
2. If `output_parser.message_level` is set, it overrides `output["level"]`.
3. If `output_parser.type` is set, it overrides `output["type"]` for `toolMessageType` mapping.

When neither `data` nor `message_level` is set in `output_parser`, the output_parser-driven path is not entered, and `tryOutputDrivenDelta` continues to work as before. `type` and `show_aigc` alone do not trigger the path (see D8).
### D8: Trigger condition — `data` or `message_level` only

The output_parser-driven path is triggered only when `output_parser.data` (non-empty object) or `output_parser.message_level` (valid `ToolEventType`) is present. `type` and `show_aigc` alone do NOT trigger the path.

Rationale:
- `type` without `data` produces a PIU-typed message with serialized string content, which is a configuration error. Falling back to normal behavior (`tryOutputDrivenDelta` / `serializeOutput`) is safer.
- `show_aigc` is a metadata flag, not a content/level override. It should not alter the content resolution path. When `show_aigc: true` is used alone, the `aigc` flag is not emitted — this is a known limitation deferred to a future change that propagates `showAigc` to all structured delta paths.

When the path IS triggered (by `data` or `message_level`), `type` and `show_aigc` are read from the same resolved output parser and used for message type mapping and AIGC label passthrough respectively.

Source: design discussion — "回退" for type-only, "按照你说的办" for show_aigc, "先不做" for global propagation.
## Verification Map

| Constraint | Task | Verification |
|---|---|---|
| `type` resolution | 1.1, 2.1 | Projector test: type + data -> correct ToolMessageType + displayType metadata |
| `data` content override | 1.2, 2.2 | Projector test: data present -> content = data; data absent -> content = serialized output |
| `message_level` override | 1.3, 2.3 | Projector test: message_level set -> level override; absent -> answer-node derivation |
| `show_aigc` passthrough | 1.4, 2.4 | Projector test: show_aigc true + data -> aigc in payload; false -> no aigc field |
| `type` alone falls back | 2.5 | Projector test: type without data/message_level -> normal path, no displayType in payload |
| Precedence over output-driven | 2.6 | Projector test: both output_parser and output have data/level -> output_parser wins |
| Trigger condition | 2.7 | Projector test: show_aigc alone -> no aigc in payload (known limitation) |
| Regression: show_title/show_content | 3.1 | Existing projector tests pass unchanged |
| Regression: serialization | 3.2 | Existing serialization tests pass unchanged |
| No agent-common change | 3.3 | No new ToolMessageType/ToolEventType values; tsc -b passes |
| Architecture lint | 3.4 | `npm run lint:architecture` passes |
