## 设计概述

### 决策 1：`sandbox.enabled=false` 进入 trusted shell mode

`RestrictedLocalSandboxGateway` 在 `enabled=false` 时继续视为 execution-ready。对于：

- `executable="bash"`：不再把 `request.command` 当作必须可直接解析的 host executable，而是把 `command + args` 重建为受控 shell command line，并交给平台 shell 解释器。
- `executable="python"`：继续沿用现有直接 interpreter 解析路径。

### 决策 2：shell mode 只放宽命令解释，不放宽执行边界

trusted shell mode 仍保留以下 adapter-owned 控制：

- `cwd` 固定为 trusted workspace / execution scope
- `env` 使用 `sanitizedEnvironment()`
- `shell: false` 调起受控解释器二进制，而不是让 Node `spawn({ shell: true })`
- timeout、AbortSignal、stdout/stderr 截断逻辑保持不变

### 决策 3：shell command line 来自 token 重建

不新增 public request 字段。Bash tool 关闭策略时仍只提供 `command` + `args`。restricted local sandbox 在 trusted shell mode 下按平台规则将 token 重建为 command line：

- Windows：使用 `cmd.exe /d /s /c <command-line>`
- Linux：使用 `/bin/bash -lc <command-line>`，若不可用则回退 `/bin/sh -lc <command-line>`

重建时保留常见 shell operator token（如 `&&`, `||`, `|`, `&`, `(`, `)`），普通 token 按平台做最小必要 quoting。

### 决策 4：默认严格模式保持不变

当 `enabled!==false` 时：

- 继续走 `validateRequest()`
- 继续要求 builtin executable allowlist / path validation
- 继续把不支持命令映射为 `unsupported-executable`

## 验证映射

- trusted shell mode 可执行 `cd ... && <real-executable> ...`：`restricted-local-sandbox.test.ts`
- Bash `enabled=false` 仍只做 tokenization 并保留 shell operator token：`bash-capability.test.ts`
- default strict mode 不回退：现有 negative tests 保持通过
