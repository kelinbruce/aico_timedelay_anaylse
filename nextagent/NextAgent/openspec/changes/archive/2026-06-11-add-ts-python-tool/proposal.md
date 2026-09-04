## 背景与问题（Why）

模型在开发阶段经常需要直接执行一段 Python 代码来完成结构化文本处理、轻量计算、数据转换或快速验证。当前仓库里只有 `bash` 工具下受限的 `python/python3` 子命令路径，这条路径本质上是“命令执行”，而不是“独立 Python 代码执行工具”。

这和目标态不一致：

- 模型需要的是独立的 `python` builtin tool，而不是通过 `bash` 间接运行 Python。
- 输入应该是待执行的代码片段，而不是 shell 风格的整条命令字符串。
- 执行必须通过 sandbox gateway boundary，不能直接落到宿主进程。
- `python` 与 `bash` 是平级 builtin tools，二者职责不同，不能互相承载。

首版要解决的黑盒问题是：当模型提交 Python 代码片段时，系统能够把它作为独立 tool 调用，在受控 sandbox 中执行，并返回结构化执行结果。

## 变更范围（What Changes）

- **新增** 独立 `python` builtin tool descriptor、schema 和固定 tool identity。
- **新增** Python tool executor handler，接收代码片段输入并路由到 sandbox boundary。
- **新增** Python tool 到 sandbox execution request/result 的映射。
- **新增** Python tool 的黑盒测试、负向测试和 sandbox boundary 验证。

## Capability 影响（Capabilities）

### 新增的 Capability

- 1 个独立 builtin TOOL capability：`python`

### 边界说明

- `python` 是独立 builtin tool，与 `bash` 平级，不通过 `bash` 解析或转发。
- `python` 是 executable capability，必须通过 sandbox boundary 执行。
- Tool 输入是代码片段，不是宿主命令行字符串。

## 主要 Owner

- Owner 9 Tool Capability

## 非目标（Non-Goals）

- 不定义沙箱机制、容器隔离、解释器安装策略或平台级资源治理细节；这些由 sandbox/gateway 侧 change 承载。
- 不提供绕过 sandbox 的执行路径，不允许直接调用宿主 `child_process`、Python runtime 或系统 shell。
- 不实现 notebook/kernel 风格的持久会话状态；首版每次调用相互隔离。
- 不让 `bash` 承载 Python 代码解释器职责，也不让 `python` 复用 `bash` 的命令字符串语义。
- 不在本 change 中删除 `bash` 里既有的受限 Python 脚本调用路径；该路径与本 change 的 code-snippet Python tool 不是同一能力，后续如需收敛由 `bash` owner 单独定义。
- 不扩展文件上传、产物浏览、包管理或网络访问等更重的 Code Interpreter 能力。
