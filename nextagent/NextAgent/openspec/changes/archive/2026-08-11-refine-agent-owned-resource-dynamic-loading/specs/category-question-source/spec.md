## MODIFIED Requirements

### Requirement: 内存 Catalog 与 Agent Scope 隔离

系统 SHALL 将解析后的分类问题目录存储在内存中，按 `agentId` + `locale` 维度组织。不同 agent 的分类问题数据 MUST 相互隔离。内存 Catalog MUST NOT 写入数据库或持久化存储。

Catalog 数据 MUST 支持运行时动态更新：当 JSONL 文件通过 fingerprint（`statSync` 的 `size + mtimeMs`）检测到变更时，系统 MUST 清除对应 `agentId + locale` 的缓存并重新加载。当 JSONL 文件不存在时，系统 MUST NOT 缓存空结果，下次请求 MUST 再次尝试加载。系统 MUST NOT 要求重启应用才能使文件变更生效。

#### Scenario: 不同 agent 的分类问题隔离
- **WHEN** agent A 和 agent B 各自有不同的 `resource/category-question-zh.jsonl` 文件
- **THEN** 系统 MUST 为 agent A 和 agent B 分别维护独立的内存 Catalog
- **AND** agent A 的查询 MUST NOT 返回 agent B 的分类问题数据

#### Scenario: 内存 Catalog 不持久化
- **WHEN** 系统加载分类问题目录到内存
- **THEN** 系统 MUST NOT 将分类问题数据写入 SQLite 或任何持久化存储
- **AND** 应用重启后 MUST 重新从 JSONL 文件加载

#### Scenario: 文件变更后缓存自动失效
- **WHEN** Catalog 已从 JSONL 文件加载并缓存
- **AND** 对应的 JSONL 文件被修改导致 fingerprint 变化
- **THEN** 下次请求 MUST 检测到 fingerprint 变化
- **AND** MUST 清除缓存并重新加载文件
- **AND** MUST NOT 返回修改前的缓存 Catalog

#### Scenario: 空结果不被永久缓存
- **WHEN** `resource/` 目录存在但 JSONL 文件尚未到位
- **THEN** 系统 MUST 返回空分类列表
- **AND** MUST NOT 将空结果缓存
- **AND** 文件到位后下次请求 MUST 能加载到有效 Catalog
