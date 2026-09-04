# Design

## Decision

`PROCEDURAL` long-term memory uses text as the retained procedure body:

```json
{
  "category": "PROCEDURAL",
  "procedureName": "切换失败排查流程",
  "procedureText": "先确认链路质量，再核对邻区配置，最后复测切换成功率。"
}
```

`procedureName` remains required so the system has a stable anchor for brief indexes, search, matching and fusion. `procedureText` is required because the retained business value is the reusable procedure itself.

## Storage

No SQLite table field changes are needed. The existing `long_term_memory.content_json` field stores the category-specific JSON payload. FTS uses `procedureName` and `procedureText` for `PROCEDURAL` content.

## Tool Normalization

`add_memory` accepts:

- structured object with `procedureName` and `procedureText`;
- structured object with `procedureName` and legacy `steps[]`, normalized by joining steps into text;
- JSON-string object that resolves to one of the above;
- plain procedural text when `category="PROCEDURAL"`, using `briefIndex` as the preferred `procedureName` and the input text as `procedureText`.

The gateway still receives only normalized core content.

## Non-goals

- No new `long_term_memory` column.
- No LLM-based procedure parsing.
- No complex step extraction rules.
- No support for arbitrary string content in core/gateway records.
