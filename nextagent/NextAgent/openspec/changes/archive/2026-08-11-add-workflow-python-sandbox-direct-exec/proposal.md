# Workflow Python 节点直接通过 sandbox 执行

## Why

Workflow recipe 中的 Python 节点承载的是 recipe 作者预定义的脚本，不是 LLM 动态生成的代码。当前实现通过 `capabilityInvocation.invoke(capabilityId: 'Python')` 间接调用 sandbox，会触发 `python` capability 路径上的 nl2py guardrail 检查。当 guardrail 服务不可用时（fail-closed），预定义脚本的正常执行被阻断。

`guardrail-gateway` spec 明确规定 "nl2py 检查 MUST 只对 `python` capability 生效，MUST NOT 影响其他 capability"。Workflow Python 节点不是 `python` capability —— 它是 recipe 驱动的预定义脚本执行，不应受 nl2py 约束。

当前代码把 Python 节点和 `python` capability 绑在同一条调用路径上，导致 guardrail 对预定义脚本误生效，与 spec 意图冲突。

## Goals / Non-Goals

- 让 Workflow Python 节点通过 `agent-capability` 暴露的 sandbox 执行 port 直接执行 Python 脚本，不经过 `python` capability 路径、不触发 nl2py guardrail。
- 保持 `python` capability（Agent tool loop 中的 LLM 动态代码执行）的 guardrail 行为不变。
- 保持 sandbox gateway 对可执行文件授权、文件系统策略、进程创建、超时、取消和 safe error mapping 的所有权不变。
- 保持 risk policy 在 sandbox 执行路径上的行为不变。

**非目标：**

- 不修改 `guardrail-gateway` spec 的 nl2py fail-closed 行为。
- 不修改 `python` capability 的 guardrail 检查逻辑。
- 不让 Workflow 层直接持有或调用 `SandboxExecutionPort` 内部接口。
- 不新增 skip guardrail 标志或配置开关。

## What Changes

- `agent-capability` 暴露 `WorkflowSandboxExecutionPort` public export，封装 `runPython` 操作，由 `agent-app` 在 composition 时注入到 Workflow node catalog options。
- `executePythonNode` 优先使用 `WorkflowSandboxExecutionPort.runPython` 执行脚本；当 port 未注入时 fallback 到现有 `capabilityInvocation` 路径以保持兼容。
- `workflow-capability-nodes` spec 明确 Python 节点通过 sandbox 执行边界直接执行，不经 `python` capability 和 nl2py guardrail。

## Function 影响

- **所属 Function**: workflow-capability-nodes、python-tool、extension-registration
- **Function 变更类型**: MODIFIED
- **主要规格**: `openspec/specs/workflow-capability-nodes/spec.md`、`openspec/specs/python-tool/spec.md`、`openspec/specs/extension-registration/spec.md`
- **影响范围**: `agent-capability` public exports、`agent-workflow` Python 节点执行路径、`agent-app` composition 注入
