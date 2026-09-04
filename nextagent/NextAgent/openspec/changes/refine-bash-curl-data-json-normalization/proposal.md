## 背景与问题（Why）

模型在使用 Bash tool 通过 curl 发送 JSON body 时，经常生成形如 `curl -d "{\"query\":\"...\"}" ...` 的命令串。当前 tokenizer 不认识双引号串内的 `\"` 转义，把原本完整的一条 JSON 参数切成多个碎片 token，导致 curl 收到非法 JSON 或错误拼装的 payload，请求失败或语义错乱。同时，模型有时用单引号作为 JSON 定界符（`{'k':'v'}`），这也不是合法 JSON。

由于 curl 在沙箱中以 `shell:false` 直接 exec（argv 传递），payload 的正确性完全取决于 tokenizer 是否把 `-d` 后的值切成一个完整 token。tokenizer 的 `\"` 转义缺陷是一个实现 bug，但它导致了一个可观察的产品路径故障：curl `-d` JSON 发不出去。

## 变更范围（What Changes）

- 修正 `bash-policy.ts` tokenizer：双引号串内按 POSIX 语义处理 `\"`、`\\`、`\$`、`` \` `` 和行续接（`\`+换行）；其它反斜杠（如 JSON 自身的 `\n`）原样保留。单引号串仍为全字面量，行为不变。
- 修正 `bash-tool.ts` 的 `hasUnclosedQuote`：使其与 tokenizer 一致地感知转义，避免在 `\"` 未闭合场景下给出错误的泛化诊断。
- 新增 curl data payload JSON 校验与 best-effort 修复：对 curl 的 `-d`、`--data`、`--data-raw`、`--data-binary`、`--data-ascii`（含 `-dvalue` 粘连和 `--data=value` 长形式）参数做一次 `JSON.parse` 校验——已经是合法 JSON 就原样透传（包括值中的单引号）；不合法时先尝试把单引号替换为双引号，再尝试删除单引号；都失败则原样返回让 curl 自行报错。
- 该校验在 command-string mode 和 argv mode 下均生效。

## Non-Goals

- 不改变 Bash 的 sandbox 执行边界、executable policy、denylist 或 shell composition 处理。
- 不改变 `args` argv mode 的原样透传语义（argv entry 不做 shell tokenization）。
- 不为非 curl 命令添加 JSON 修复。
- 不自动闭合引号或修复其它非 JSON 类型的 `-d` payload（表单数据、XML、`@file` 等原样透传）。
- 不改变 timeout、background、streaming 等既有行为。

## Function 影响（OpenSpec Capabilities）

### 修改的 Function

- `FN-5.5 执行命令和脚本`：修改其主规格 `command-script-tools`，使 Bash 的 deterministic tokenization 显式覆盖双引号转义语义；新增 curl data payload JSON 校验需求。

## Feature 影响

- 无 Feature delta。不新增用户可见 Feature；本次修复模型已有 curl JSON body 发送路径的正确性。

## 影响范围（Impact）

- `agent-capability`：修正 `bash-policy.ts` tokenizer、`bash-tool.ts` 的 `hasUnclosedQuote`，新增 curl data payload normalization 函数。
- tests：新增 tokenizer 转义用例和 curl `-d` JSON 校验/修复集成测试。
- 不修改 `agent-contracts`、runtime lifecycle、sandbox gateway、persistence 或 security boundary。
- **BREAKING**：无。此前因 tokenizer bug 无法解析的命令现在可正确解析；此前合法 JSON 不受影响。
