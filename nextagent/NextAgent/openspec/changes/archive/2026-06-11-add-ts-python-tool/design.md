## 设计决策（Design Decisions）

### D1: Python Tool 是独立 builtin tool，不挂在 Bash 之下

`python` 的黑盒目标是“直接执行模型给出的 Python 代码片段”，而不是“运行一条允许列表里的 shell 命令”。因此：

- `python` 必须有独立 tool id、独立 descriptor、独立 handler。
- `python` 与 `bash` 平级，不通过 `bash` 解析、授权或转发。
- `bash` 继续负责命令执行语义；`python` 负责代码执行语义。

这里的“与 `bash` 平级”指模型可见和 tool identity 层面的独立性，不等价于本 change 需要删除 `bash` 中既有的受限 Python 脚本调用能力。二者当前承载的内容不同：

- `bash` 中的 Python 路径承载“trusted allowlist 脚本调用”语义。
- 本 change 的 `python` tool 承载“模型提交代码片段并执行”语义。

如果后续要收敛或移除 `bash` 的 Python 路径，必须由 `bash` owner 在独立收敛中定义，不能在本 change 中隐式替换。

### D2: Python Tool 输入输出契约

首版工具契约固定为：

```yaml
code: string               # 待执行的 Python 代码片段，必填
args?: string[]            # 传给脚本的参数，可选
timeout_ms?: integer > 0   # 超时，可选
```

成功输出固定为：

```yaml
exit_code: integer
stdout: string
stderr: string
timed_out: boolean
```

DFX 约束：

- `timeout_ms` 默认 `10000` ms，最大 `120000` ms。
- `args` 最多 `100` 个，总 UTF-8 字节数不超过 `8192`。
- `stdout`、`stderr` 各自最大 `65536` UTF-8 bytes，并在有效 UTF-8 边界截断。

### D3: Python Tool Executor Handler

Python tool handler 接收既有 `CapabilityInvocationRequest`，执行以下最小黑盒流程：

1. 使用 `python` tool input schema 校验 `code`、`args`、`timeout_ms`。
2. 拒绝空代码、非法 `args`、超预算 `args` 或非法超时。
3. 基于 trusted runtime context 形成 Python execution submission facts。
4. 调用 tool-facing Python sandbox dependency。
5. 把 sandbox result 映射为 `CapabilityInvocationResult`。

handler 只拥有 Python tool 语义，不拥有解释器安装、宿主路径发现、平台隔离或资源计量细节。

### D4: Sandbox Gateway 集成方式

Python 是 executable capability，必须只通过 sandbox gateway boundary 执行。

唯一允许的调用链是：

```text
CapabilityInvocationRequest (python)
  -> Python tool handler
  -> tool-facing Python sandbox dependency
  -> trusted submission mapping
  -> SandboxGatewayPort.execute(...)
  -> SandboxExecutionResult
  -> CapabilityInvocationResult
```

禁止路径：

- 直接调用宿主 `child_process`
- 直接调用宿主 Python runtime
- 借道 `bash` tool 执行 `python ...`
- sandbox unavailable 时回退到 unsandboxed host execution

这里的“不得借道 `bash` tool 执行 `python ...`”仅约束本 change 的独立 `python` tool 实施路径：它不能把自己的 code-snippet 执行实现偷懒成“先拼成 bash/python 命令再交给 bash tool”。这不等于本 change 要删除或修改 `bash` 已有的受限脚本调用语义。

### D5: Code snippet 到 sandbox request 的归属

Python tool 的输入是 `code: string`，不是现成的文件路径。首版 design 只冻结黑盒责任：

- handler 负责把代码片段交给 tool-facing Python sandbox dependency；
- tool-facing Python sandbox dependency 负责把 trusted runtime facts 映射为 sandbox submission；
- sandbox submission 可以通过“临时脚本文件”或等价受控机制承载；
- 代码片段如何在 sandbox 内被物化为现有 `SandboxExecutionRequest(command,args,executable,...)` 可消费的执行输入，属于 sandbox adapter / executable submission 内部实现；
- 该内部实现不得泄漏为 `python` tool 的 public contract。

这样可以保持 `python` tool 的模型可见契约稳定，同时不把 sandbox adapter 私有细节提升到 capability contract。

### D6: Trusted submission facts 必须来自既有 capability/runtime/gateway contract

Python tool 不新增并行 public contract。它复用既有 capability invocation 和 sandbox gateway contract，提交前至少需要这些 trusted facts：

- 来自 `CapabilityInvocationRequest` / trusted runtime context 的 `runId`、`identityContext.tenantId`、`identityContext.subjectId`
- runtime-owned cancellation signal
- effective `timeout_ms`
- bounded `stdoutLimitBytes` / `stderrLimitBytes`
- sandbox adapter 需要的安全 `environment` 和等价 working-directory facts

这些 facts 必须由 handler / tool-facing dependency 从 trusted request/runtime context 生成；不得从模型输入 `code`、`args` 或客户端 metadata 中读取 owner、run identity、workspace 或宿主执行配置。

### D7: 调用隔离与状态边界

首版 `python` tool 不提供 notebook/kernel 风格的持久状态：

- 每次 invocation 独立执行。
- 不保证前一次运行定义的变量、文件句柄、进程或内存状态可被后一次复用。
- 若后续需要 REPL / notebook / artifact 生命周期语义，必须由独立 change 定义。

### D8: 失败映射

Python tool 需要把以下失败类统一映射为安全结果：

- schema validation failure
- args budget exceeded
- timeout
- abort / canceled
- sandbox unavailable / deny-by-default
- execution boundary failure

非零退出码在首版必须作为结构化执行结果返回，不能仅因为 `exit_code != 0` 就提升为 capability-level failed result；但返回内容仍必须经过 safe output budget 约束。

### D9: 可观测性与安全边界

- 日志、metric、trace、audit 只记录 tool id、duration、exit class、truncated flags 和 safe reason code。
- 不记录 raw `code`、raw `stdout`、raw `stderr`、宿主路径、secret、token 或高基数字段。
- Python 执行不得突破 `ts-backend-architecture` 的 sandbox execution boundary。

## 验证映射（Verification Map）

| 验证点 | Task | 验证入口 |
|--------|------|---------|
| 独立 python descriptor 注册 | T1 | `packages/agent-capability/tests/*python*.test.ts` |
| `code`/`args`/`timeout_ms` schema 校验 | T2 | Unit / contract tests |
| args 数量和字节预算限制 | T3 | Unit tests |
| sandbox 执行与结果映射 | T4 | Capability tests |
| timeout / abort / unavailable safe result | T5 | Capability + gateway tests |
| 不经 `bash` 转发、不直连宿主进程 | T6 | Architecture / source assertion |

## 质量属性（Quality Attributes）

| 属性 | 需求 | 验证入口 |
|------|------|---------|
| 安全性 | 强制 sandbox，禁止 host fallback | Negative tests + architecture assertions |
| 可靠性 | timeout、abort、non-zero exit 可预测映射 | Capability tests |
| 容量 | stdout/stderr、args、timeout 受预算限制 | Boundary tests |
| 可观测性 | 不泄漏 raw code/output | Safe error / logging checks |

## 风险与取舍（Risks / Trade-offs）

- **风险**：代码片段执行比 allowlist 脚本更接近通用解释器，安全风险更高
  **缓解**：唯一执行路径是 sandbox gateway，且不允许 host fallback

- **风险**：用户可能期望 notebook 一样的持久状态
  **缓解**：首版明确每次调用独立，后续需要持久内核时单独建 change

- **取舍**：首版不承载完整 Code Interpreter 文件产物和包管理
  **理由**：先把“独立代码执行工具 + sandbox 边界”落稳，再扩展更重能力
