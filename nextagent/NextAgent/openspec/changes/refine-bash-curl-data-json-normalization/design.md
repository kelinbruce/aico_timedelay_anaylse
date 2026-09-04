## 设计范围

| Function | 本次目标变化 | 涉及 delta specs | 设计章节 |
|---|---|---|---|
| `FN-5.5 执行命令和脚本` | Bash command-string tokenizer 按 POSIX 双引号转义语义处理 `\"`、`\\`、`\$`、`` \` `` 和行续接；curl 的 `-d`/`--data*` payload 在 sandbox 提交前做合法 JSON 校验与 best-effort 修复 | `command-script-tools` | `FN-5.5 执行命令和脚本` |

## `FN-5.5 执行命令和脚本`

### 目标与规范依据

本设计落实 proposal 中"Bash tokenizer 正确处理双引号转义、curl data payload 校验为合法 JSON 并 best-effort 修复单引号定界错误"的目标。实现只改变 Bash Tool 在 sandbox 提交前的 tokenizer 转义处理和 curl `-d` payload 校验，不改变 Bash 的沙箱策略、executable denylist、执行结果、超时或输出语义。

#### 本 Function 的目标 Requirements

canonical spec：`command-script-tools`

- `ADDED`：`Bash command-string tokenizer 正确处理双引号转义`
- `ADDED`：`Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复`

### 当前实现

- `packages/agent-capability/src/builtins/bash/bash-policy.ts` 的 `tokenize` 函数在双引号串内不处理任何转义字符：遇到 `\` 当普通字符追加，遇到 `"` 直接关闭字符串。因此 `"{\"k\":\"v\"}"` 在第一个 `\"` 处关闭字符串，后续内容变为裸 token，JSON payload 被拆碎。
- `packages/agent-capability/src/builtins/bash/bash-tool.ts` 的 `hasUnclosedQuote` 函数用于在 tokenizer 抛错时判断是否为 `balancedQuotes` 违规，但同样不认识转义，会把含 `\"` 转义的未闭合命令误判为已闭合。
- curl 在沙箱中以 `spawn(curl, args, { shell: false })` 直接 exec，`-d` payload 作为一个 argv entry 传递，不经过 shell 引号处理。payload 正确性完全取决于 tokenizer 是否把 `-d` 后的值切成一个完整 token。
- 当前 Bash Tool 对 curl args 在提交 sandbox 前注入 `--max-time`，但不校验 `-d` payload 是否为合法 JSON。

### GAP 分析

| 规范目标 | 当前事实 | GAP |
|---|---|---|
| 双引号串内 `\"` 消费反斜杠并保留引号字符且不关闭字符串 | tokenizer 不处理转义，`\"` 直接关闭字符串 | 需要在双引号串内按 POSIX 语义处理转义 |
| 双引号串内 `\n` 等 JSON 转义保留原样 | tokenizer 把 `\n` 中的 `\` 和 `n` 分别当普通字符处理（原样保留，无 bug） | 保持不变，确认不破坏 |
| `\`+换行作为行续接被丢弃 | 当前不处理行续接 | 需要丢弃反斜杠和换行 |
| 引号闭合检测与 tokenizer 一致 | `hasUnclosedQuote` 不认识转义 | 需要使其与 tokenizer 转义语义对齐 |
| curl `-d` 合法 JSON 原样透传 | 当前不校验 payload | 需要新增校验层，合法 JSON 不动 |
| curl `-d` 单引号定界 JSON 修复为合法 JSON | 当前不修复 | 需要 best-effort 修复（单引号换双引号→删单引号→失败原样返回） |
| 非 curl 命令不受影响 | 当前无 payload 校验 | 校验必须限定 `executable === 'curl'` |

### 修改方案

唯一实现路径分两部分：

**1. Tokenizer 转义修复（`bash-policy.ts`）**

在 `tokenize` 的双引号串分支中，按 POSIX 语义处理反斜杠转义：

1. 遇到 `\` 时检查下一个字符：
   - `"`、`\`、`$`、`` ` `` → 消费反斜杠，保留后一个字符
   - 换行符 → 两者都丢弃（行续接）
   - 其它字符 → 反斜杠原样保留（保护 JSON `\n`、`\t`）
2. 单引号串保持全字面量，不变。
3. `hasUnclosedQuote`（`bash-tool.ts`）做同样改动，使其与 tokenizer 一致。

**2. curl data payload JSON 校验（`bash-tool.ts`）**

在 `executeBash` 中、`resolveSkillRelativeScriptArgs` 之后、`--max-time` 注入之前，新增 `normalizeCurlDataArguments`：

1. 仅当 `parsed.executable === 'curl'` 时执行。
2. 扫描 `-d`、`--data`、`--data-raw`、`--data-binary`、`--data-ascii` flag（含 `-dvalue` 粘连和 `--data=value` 长形式）。
3. 对每个 data payload 调用 `normalizeCurlDataPayload`：
   - 合法 JSON → 原样返回
   - 不合法 → 把所有 `'` 换 `"` 再 parse；成功则 `JSON.stringify` 输出
   - 仍不合法 → 删所有 `'` 再 parse；成功则 `JSON.stringify` 输出
   - 都失败 → 原样返回
4. 非 JSON payload（表单数据、XML、`@file`、纯文本）在所有修复尝试后仍非法，原样返回。
5. 替换后的 args 继续走既有 `--max-time` 注入和 sandbox 提交路径。

#### 质量属性影响

| 质量属性 | 规范依据 | 本 Function 内实现机制 | 验证关注点 |
|---|---|---|---|
| 安全 | `Bash 为 curl data payload 做合法 JSON 校验与 best-effort 修复` | 修复只修改能通过 `JSON.parse` 的 payload；非 JSON payload 原样返回让 curl 自行报错 | 非 JSON 透传、无法修复原样返回、非 curl 不受影响 |
| 可测试性 | 两个 ADDED Requirements | tokenizer 和 normalizer 在 Bash Tool 内可由集成测试观察最终 sandbox argv | 转义透传、JSON 保留、单引号修复、argv mode |

## 验证策略（Verification Strategy）

- Tokenizer characterization：双引号转义 `\"`、`\\`、`\$`、`` \` ``、行续接；JSON `\n` 保留；单引号字面量；未闭合抛错。
- Integration：command-string mode 和 argv mode 下合法 JSON 透传、单引号定界 JSON 修复、非 JSON 透传。
- 既有 curl `--max-time` 注入测试不回归。
- `tsc --noEmit` 无错误。

## 长期基线刷新计划

归档前需要同步：
- stable spec `openspec/specs/command-script-tools/spec.md`：合并两个 ADDED Requirements。
- Function 文档 `openspec/designs/functions/D5-Capability能力体系/D5.2-内置工具/FN-5.5-执行命令和脚本.md`：处理过程增加 tokenizer 转义语义和 curl data payload 校验条目。
- spec-to-design-map `openspec/designs/spec-to-design-map.md`：无新增映射，确认 bash-tool 条目仍覆盖。
- architecture、modules、ADR、Feature、overview：无影响。
