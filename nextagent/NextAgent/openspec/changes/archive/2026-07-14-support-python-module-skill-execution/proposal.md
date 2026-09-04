## 背景与问题（Why）

已投影 Skill 的 `SKILL.md` 可以向模型说明 `python -m scripts.<module>` 的调用方式，但当前受限本地 sandbox 将所有 Python 请求的第一个参数都当作脚本路径。`-m` 因而被错误映射到 execution workspace 中的 `workspace/-m`，Python 在模块导入前即以“文件不存在”失败。

即使仅跳过该错误路径翻译，模块仍不能可靠导入：每次执行的 cwd 是 execution scope 根，而已授权 Skill 的 `scripts/` 位于该 Skill 的只读 projection 根下，默认不属于 Python import root。当前 `python <script-path>` 的受控路径执行不能表达该模块调用语义。

电信网络诊断 Skill 需要以模块形式复用本 Skill 内的受控 Python 脚本和包。系统必须在不泄漏宿主路径、不接受模型指定 import root、也不绕过 sandbox 的前提下，提供一个可验证的模块执行语义。

## 变更范围（What Changes）

- 为 Bash 经 `python` / `python3` 路由的请求定义两种受支持的 Python invocation mode：现有的受控脚本路径模式，以及 `-m <module>` 模式。
- local sandbox 只在脚本路径模式翻译首个 Python 参数；`-m` 和模块名必须保持解释器参数语义，不得被映射为文件路径。
- `WorkspaceFilePort` 继续把当前 run 已授权且已投影的 Skill roots 作为既有 sandbox filesystem facts 提供；local sandbox 在模块模式从这些 facts 唯一派生受控的 per-request Python import root，不能使用模型输入、客户端 metadata、任意 workspace 路径或宿主绝对路径覆盖。
- sandbox request 在不改变公开 gateway request/result vocabulary 的前提下传递该受控 import root，并继续使用 sanitized environment、adapter-owned cwd、`shell: false`、timeout、取消和输出限制。
- 本 change 不支持 `-c`、stdin (`-`)、任意 Python option 组合、跨 Skill import、依赖安装、或由 Skill/模型配置环境变量。现有 `python <script-path>` 语义保持不变。

## Capability 影响（Capabilities）

### 新增 Capability

- 无。

### 修改的 Capability

- `sandbox-runtime`: 修改 Python sandbox invocation mode、受控 import root 与安全执行语义。
- `bash-tool`: 修改 Bash 将 `python -m <module>` 作为受支持的、由 sandbox 决定执行语义的 token sequence。
- `skill-resource-access`: 修改已授权 Skill resource projection 对 Python 模块执行可消费的 root 事实。

## 影响范围（Impact）

- `packages/agent-platform-gateway-local/src/sandbox/restricted-local-sandbox.ts`：Python invocation 分类、受控环境构造与本地执行测试。
- `packages/agent-capability/src/builtins/sandbox/sandbox-execution-port.ts`、`packages/agent-capability/src/builtins/workspace-files/workspace-file-port.ts`：从当前 run 的授权 projection 组装 sandbox execution facts。
- `packages/agent-capability/src/builtins/bash/`：仅补充模块模式端到端转发测试，不新增 Bash 自己的解释器或 import 授权逻辑。
- 不新增 Web API、模型工具 schema、持久化表、配置项或 gateway public DTO；只影响已存在 Bash Python 调用的安全执行行为与 safe observability。

## 归档前更新基线（Baseline Promotion Plan）

行为契约：

- `openspec/specs/sandbox-runtime/spec.md`：修改 Python invocation mode、import root trust boundary 和执行控制契约。
- `openspec/specs/bash-tool/spec.md`：修改 Bash 对 Python module mode 的转发边界。
- `openspec/specs/skill-resource-access/spec.md`：修改投影 Skill root 对模块执行的授权事实。

长期背景：

- `openspec/overview.md`：无。

设计视图：

- `openspec/designs/architecture/core-contracts.md`：无；不改变 `SandboxExecutionRequest` / `SandboxExecutionResult` public contract。
- `openspec/designs/modules/agent-capability.md`：补充 `WorkspaceFilePort` 为当前 run 派生受控 Python module root、Bash 不拥有该授权的职责。
- `openspec/designs/modules/agent-platform-gateway-local.md`：补充 Python mode 分类、受控环境与 `shell: false` 本地执行职责。
- `openspec/designs/adr/<id>.md`：无；该选择是已有 sandbox 与 Skill projection 边界下的局部行为完善。
- `openspec/designs/spec-to-design-map.md`：如上述 module design 导航发生变化则更新。

验证入口：

- `npx vitest run packages/agent-platform-gateway-local/tests/restricted-local-sandbox.test.ts`
- `npx vitest run packages/agent-capability/tests/bash-capability.test.ts packages/agent-capability/tests/skill-resource-projection.test.ts`
- `npm run test:contract`、`npm run lint:architecture`、`openspec validate support-python-module-skill-execution --strict`
