# FN-5.5 执行命令和脚本

> 能力域 D5 Capability 能力体系 · 子域 [D5.2 内置工具](.) · 返回 [功能树](../../index.md)

| 项 | 值 |
|---|---|
| 当前状态 | 稳定 |
| 覆盖特性 | [F-5.3](../../../features/D5-Capability能力体系/D5.2-内置工具/F-5.3-命令执行工具.md) |
| 主规格 | `command-script-tools` |
| 遗留规格 | `bash-tool`、`python-tool`、`cross-platform-executable-semantics` |
| 接口 | 能力调用端口（工具）+ 沙箱网关 |

## 描述

提供命令和脚本执行工具，通过沙箱隔离执行，跨平台适配；命令与脚本经同一沙箱网关，仅可执行内容与解释器不同。

## 前置条件

- 沙箱网关可用。

## 输入

| 参数 | 必填 | 说明 |
|---|---|---|
| 可执行内容 | 是 | 命令或脚本 |
| 解释器 | 否 | 命令或脚本语言（如 Python） |
| `stream_format` | 否 | Bash 可选字段，枚举 `'sse'` 或 `'ndjson'`，声明命令输出为流式结构化数据。未设置时 Bash 根据命令内容自动检测 SSE 流式特征（`text/event-stream`、`/sse/`、`--no-buffer`、` -N `） |

## 输出

执行结果（标准输出、标准错误、退出码）。

## 处理过程

1. Bash 在 sandbox 前完成 deterministic tokenization，并一次返回全部可独立判断的格式违规；Python guard 以 `/code` 的 `codeSafetyPolicy` violation 表达可纠正拒绝。
2. Bash 支持两种互斥输入模式：command-string mode 仅提供 `command` 整条命令字符串并走既有 tokenization 路径；argv mode 提供 `command` 单可执行文件 token 加可选 `args` 字符串数组，每项原样作为独立 argv 提交，不做 shell tokenization、拼接或转义，以稳定承载 JSON、Gremlin、SQL、regex 等含引号/空格/括号/反斜杠的参数。提供 `args` 时 `command` 必须只解析为单个可执行 token，否则在 sandbox 前以可重试 `CAPABILITY_INPUT_INVALID` + `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY` 拒绝并给出二选一修复提示。
3. 格式合法后的许可只由沙箱策略决定；命令与脚本都通过沙箱网关执行。
4. Bash 在直接解释器执行的窄边界内补全当前 scope 唯一匹配的 Skill 相对脚本路径：解析结果表示直接解释器执行时，只对首个脚本参数应用兼容规则，再进入既有 sandbox 授权与执行；唯一匹配返回既有进程结果，无匹配保持既有执行结果，多个匹配以 `SKILL_RESOURCE_PATH_AMBIGUOUS` 在执行前失败。
4. Bash 正常完成的零/非零退出均返回同形 `SUCCEEDED` 进程结果，不依据 stdout/stderr 是否为空推导状态。
5. Python 正常与非零执行保持结构化结果；缺失边界、无效 sandbox response、timeout 和取消按统一安全语义表达，`NON_IDEMPOTENT` timeout 不自动同参重试。
6. Bash 流式执行路径：当 `stream_format` 为 `'sse'` 或 `'ndjson'`（显式设置或命令特征自动检测）且 sandbox 执行端口提供 `runShellStreaming` 时，创建 `BashStreamDeltaEmitter` 调用 `runShellStreaming` 逐块回调 stdout，复用 `drainClipOutputFrames` 做帧分割，每帧提取结构化 payload 后通过 `emitResultDelta` 逐帧推送 tool-loop；`emitBashOutputFrame` 直接传递提取的 payload 不自行包裹 `structuredPayload`，执行完成后调用 `emitter.flush()` 处理残余 buffer。sandbox 不支持 `runShellStreaming` 或未设置 `stream_format` 且不匹配流式特征时回退到现有 `runShell`/`runShellBackgroundable`/`runPython` 路径，行为与未引入 `stream_format` 字段时完全一致。流式路径 terminal 结果处理（`exitCode`、`stdoutTruncated`、`stderrTruncated`、degraded、timeout 判定）与非流式路径一致，不改变 `bashExecutionOutputSchema` 结果形状。

## 结果

- 正常：返回执行结果。
- 被拒绝：安全失败。
- 执行超时：安全失败。

## 规格

| 规格项 | 规格值 | 权威来源 |
|---|---|---|
| Skill 相对脚本路径兼容 | 仅支持 `python`/`python3` 执行 `.py` 与 `bash`/`sh` 执行 `.sh`；只补全 `scripts/<file>` 或 `<skill-name>/scripts/<file>` 的当前 scope 唯一 verified projection 匹配，歧义以 `SKILL_RESOURCE_PATH_AMBIGUOUS` 拒绝 | `command-script-tools`：`Bash 补全唯一匹配的 Skill 相对脚本路径` |
| Bash 可纠正格式错误 | `COMMAND_NOT_ALLOWED + VALIDATION + retryable=false`，并返回当前阶段全部安全 violations | `command-script-tools`：`Bash 对可纠正命令格式错误返回完整诊断` |
| 正常进程完成 | Bash 的零/非零退出均为有界 `SUCCEEDED`；Python 保持结构化进程结果 | `command-script-tools`：`Bash 结果有界且忠实表达进程完成事实`、`Python guard 和执行失败使用统一安全语义` |
| Bash 结构化 argv 输入 | 提供 `args` 时 `command` 必须为单个可执行 token，`args` 各项原样作为独立 argv 提交不做 shell 转义；`command` 与 `args` 混用以可重试 `CAPABILITY_INPUT_INVALID` + `BASH_STRUCTURED_ARGS_COMMAND_NOT_EXECUTABLE_ONLY` 拒绝 | `bash-tool`：`Bash Accepts Structured Argv Input` |
| Python preamble 与 code 分离 | Python input 可选 `preamble` 承载可信变量声明，guardrail 只检查 `code` 不检查 `preamble`；sandbox 执行时把 `preamble` 拼接到 `code` 前（`preamble + "\n" + code`），空 `preamble` 视为未传 | `python-tool`：`Python tool accepts code snippet input` |
| nl2py guardrail 适用范围 | nl2py guardrail 只对 `python` capability（capability invocation 路径上的 LLM 动态代码）生效；Workflow Python 节点经 `WorkflowSandboxExecutionPort` 执行的不是 `python` capability，MUST NOT 触发 nl2py guardrail | `python-tool`：`Nl2py guardrail scope does not include workflow python nodes` |
| Bash 流式执行路径 | `stream_format` 枚举 `'sse'`/`'ndjson'`，显式或命令特征自动检测激活；sandbox 提供 `runShellStreaming` 时逐块回调 stdout 做帧分割逐帧推送 `emitResultDelta`，不支持时回退到非流式路径，terminal 结果形状不变 | `bash-tool`：`Bash Streaming Execution Path` |
