## 背景和现状（Context）

`bash` tool 的稳定 public contract 使用 canonical 字段 `timeout`，而 `python` tool 使用 `timeout_ms`。模型在连续工具调用中容易复用 Python 风格字段名，导致 `bash` 调用在 schema validation 阶段被拒绝，即使其余命令形态、策略校验和 sandbox 路径都合法。

当前仓库已经有稳定的 Bash timeout 语义：

- canonical public field 是 `timeout`
- 默认值是 `120000`
- 受 trusted invocation timeout 约束
- 最终上限是 `600000`

本 change 只解决字段名兼容性，不改变这些既有语义。

## 目标和非目标（Goals / Non-Goals）

**目标：**

- 接受模型常见兼容 alias `timeout_ms`
- 保持 `timeout` 作为唯一 canonical public 字段
- 当两个字段同时出现时，保持 `timeout` 优先
- 不改变 Bash timeout 的默认值、上限和 trusted invocation bound

**非目标：**

- 不把 canonical field 重命名为 `timeout_ms`
- 不改变 `python` tool contract
- 不扩展 Bash command policy、sandbox authority 或 background execution

## 设计决策（Decisions）

### D1. 在 Bash input schema 中显式接受 `timeout_ms`

兼容 alias 必须在 `bash` input schema 中显式声明，而不是依赖调用前的私有预处理。这样模型产生的输入仍然先通过 runtime schema validation，不会为这一个兼容问题引入 schema 外逃逸路径。

### D2. `timeout` 继续是 canonical field

兼容 alias 只是输入归一化入口，不是 public contract rename。所有长期规格、用户可见文档和后续 contract 讨论仍以 `timeout` 为 canonical 字段。

### D3. 归一化优先级固定为 `timeout` > `timeout_ms` > default

当两个字段同时存在时，系统固定选择 `timeout`。如果只提供 `timeout_ms`，则它按与 `timeout` 相同的正整数 shape 参与 timeout 归一化。两个字段都缺失时，继续使用默认 `120000`。

### D4. timeout 生效语义保持不变

alias 只影响输入归一化，不改变最终 timeout 计算公式。effective timeout 仍然是：

1. 选择 canonical `timeout`，否则选择 alias `timeout_ms`，否则默认 `120000`
2. 再与 trusted invocation timeout 和固定上限 `600000` 取最小值

## 质量属性设计（Quality Attributes）

| 质量属性 | 设计结论 | 验证入口 |
|---|---|---|
| 安全 | 不绕过 schema validation，不放宽 Bash command policy、sandbox boundary 或 host execution restrictions | bash capability tests |
| 兼容性 | 兼容模型常见别名输入，同时保持 canonical contract 稳定 | alias / precedence tests |
| 可维护性 | 只在 Bash 自身 schema 和 timeout normalization 处做最小改动，不引入跨 tool 通用兼容层 | code review |
| 可测试性 | 通过 canonical、alias、invalid alias 和 precedence 四类黑盒用例验证 | `packages/agent-capability/tests/bash-capability.test.ts` |

## 文档承载决策（Documentation Ownership）

- 行为契约：`openspec/specs/bash-tool/spec.md`
- 长期设计：当前 change 不新增需要进入长期 architecture/module 文档的稳定设计事实；现有 `bash-tool` 与 `agent-capability` 长期设计足以承载这次兼容修正
- 导航：不新增 `spec-to-design-map.md` 入口
