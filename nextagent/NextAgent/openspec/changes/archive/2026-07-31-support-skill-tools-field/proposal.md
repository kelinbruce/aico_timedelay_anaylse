# 提案：支持 Skill 工具约束兼容

## 背景与问题（Why）

迁移来的电信 Skill 可能使用 YAML 列表语法或遗留的 `tools` 字段声明工具访问：

```yaml
tools: ["Bash", "Read", "Agent"]
```

当前 Skill manifest 解析器把 `tools` 当作不支持的顶层字段拒绝，而 `allowed-tools` 只接受空白分隔字符串。这使其他方面合法的本地 Skill 在发现阶段不可用。

## 变更范围（What Changes）

扩展 `agent-capability` 的 Skill manifest 解析器，使：

- `allowed-tools` 保持 canonical 字段。
- `allowed-tools` 接受空白分隔字符串或 YAML 字符串列表。
- `tools` 被接受为 `allowed-tools` 的兼容别名。
- 同时声明非空的 `allowed-tools` 和 `tools` 会被拒绝。
- 元数据 `denied-tools` 接受相同的字符串和 YAML 字符串列表形态。

## 非目标（Non-Goals）

- 不暴露新的公共元数据字段。
- 不在解析等价约束形态之外改变工具授权语义。
- 不接受任意不支持的顶层字段。
- 不改变 ToolSearch 或工具调用行为。

## 影响范围（Impact）

使用 `allowed-tools: Bash Read` 的既有 Skill 继续原样加载。使用 YAML 数组或 `tools` 的迁移 Skill 无需重写 manifest 即可加载，而冲突声明仍然非法。
