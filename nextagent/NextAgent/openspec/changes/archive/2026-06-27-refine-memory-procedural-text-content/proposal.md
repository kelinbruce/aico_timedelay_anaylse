# refine-memory-procedural-text-content

## 背景与问题（Why）

程序性长期记忆目前要求 `steps[]`。真实用户编写的程序性知识通常以简洁的文本流程表达，而不是可可靠拆分的步骤。要求结构化 steps 使 `add_memory` 变得脆弱，当模型传入文本或 JSON 字符串内容时会反复出现失败的 tool 调用。

## 变更范围（What Changes）

- 把 `PROCEDURAL` memory 内容从必填 `steps[]` 改为必填 `procedureText`。
- 保持 `procedureName` 作为持久身份和检索锚点。
- 允许 `add_memory` 把程序性字符串或 JSON 字符串输入归一化为 `{ category, procedureName, procedureText }`。
- 更新抽取和 gateway 校验以写入/搜索程序性文本。
- 不改变 SQLite 表字段；程序性文本仍存储在 `long_term_memory.content_json` 中。

## 影响范围（Impact）

- 受影响 package：`agent-contracts`、`agent-memory`、`agent-platform-gateway-local`
- 受影响 spec：`memory-core`、`memory-tools`、`memory-extraction`
- 不做数据库 schema 迁移、Web API 变更或 stream event 类型变更。
