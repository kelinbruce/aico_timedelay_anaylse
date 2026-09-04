## Function

- **所属 Function**：`FN-10.32 管理插件开发诊断产物`
- **Function 变更类型**：`MODIFIED`
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: 产物写入具有有界容量和生命周期

系统 MUST 对 developer diagnostic artifact 文件族应用固定 daily boundary 或 active segment 达到 `30 MiB` 时轮转，以先发生者为准。closed segment MUST 通过 `.gz.tmp` 后原子提交 `.gz`，并只在 committed archive 存在后删除 closed source。系统 MUST 从 `closedAt` 起保留 closed source 或 archive `3` 个 elapsed days，并 MUST 最多保留 `10` 个 committed gzip archive；elapsed retention 与 archive count MUST 作为独立删除条件生效，数量超限时 MUST 按 `mtime`、文件名最旧优先删除该文件族精确拥有的 archive。startup reconciliation 和周期 maintenance MUST 只处理该文件族精确拥有的 regular files。单条包含换行分隔符的 serialized record MUST 不超过 `4 MiB`；超过上限的记录 MUST 以 `RECORD_TOO_LARGE` 丢弃，MUST NOT 部分写入或任意截断。

**需求类别**：系统质量属性
**质量属性**：性能/容量
**适用范围**：该 Function

#### Scenario: 30 MiB 大小边界触发轮转与压缩

- **WHEN** active segment 接受下一条完整记录后达到或超过 `30 MiB`
- **THEN** 系统 MUST 关闭该 segment 并为后续记录选择新的 active segment
- **AND** closed segment MUST 最终形成可恢复的 committed gzip archive

#### Scenario: 压缩归档数量超过十个

- **WHEN** 该文件族提交第十一个仍未达到 3 elapsed days 的 gzip archive
- **THEN** maintenance MUST 删除该文件族精确拥有的最旧 archive
- **AND** 成功 maintenance 后 committed gzip archive 数量 MUST 不超过 `10`

#### Scenario: 单条记录超过上限

- **WHEN** 一条记录的 UTF-8 serialized bytes 加换行超过 `4 MiB`
- **THEN** 系统 MUST 返回 `DROPPED`
- **AND** reason code MUST 为 `RECORD_TOO_LARGE`
- **AND** active segment MUST 不包含该记录的部分内容

## Function 变更汇总

### 规格

- **规格项**：文件生命周期容量
- **变更类型**：修改
- **原规格值**：active segment 达到 100 MiB 或 daily boundary 时轮转；closed source/archive 保留 3 elapsed days
- **目标规格值**：active segment 达到 30 MiB 或 daily boundary 时轮转；closed source/archive 按 3 elapsed days 与最多 10 个 committed gzip archive 两个独立条件清理
- **依据 Requirements**：`产物写入具有有界容量和生命周期`
