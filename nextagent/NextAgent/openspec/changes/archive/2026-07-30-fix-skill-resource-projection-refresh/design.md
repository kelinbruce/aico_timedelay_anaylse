# Design

## 决策（Decision）

保持既有的 run-local 授权边界。多轮复用通过按 run 对已提交 Skill 投影重新授权实现，而不是把 Skill 资源升级为 session 作用域的读/写 roots。

## 流程（Flow）

1. Context assembly 为新 run 选择先前的 messages。
2. 对渲染后的模型输入扫描有界的 `.nextagent/skills/<key>/<skill>/` 逻辑路径，覆盖 text 部分、序列化 tool 结果和序列化 tool-call 参数。这覆盖了即使先前 Skill 结果未被选中、但被选中的先前 Bash/Python 调用。
3. 当前 run 可见的 `SKILL` descriptors 与旧 root 比对：
   - descriptor 的 `providerId + capabilityId + version` 必须推导出相同的投影 key；
   - descriptor 当前必须可见且能通过正常 catalog 治理获得。
4. `agent-core` 调用一个窄域的 capability 拥有的重授权 port。
5. `WorkspaceFilePort` 校验已提交的投影 marker，只有通过后才把该 root 加入当前 run 的 `authorizedSkillRoots`。
6. `agent-core` 注入一条简短的当前 run 重披露 message。文件工具和 sandbox 执行随后使用既有的当前 run 授权路径。

## 组合所有权（Composition Ownership）

`agent-capability` 拥有已提交 marker 的校验，并只通过 `CapabilitySubsystem` 暴露窄域的 `reauthorizeSkillResources` port。`agent-app` 作为 composition root，必须把该 port 注入 request-runtime 的 `DefaultAgent` 依赖。仅有 core 级 mock 不足以作为证据，因为缺失生产绑定会禁用重授权而不改变正常 Skill 调用路径。

## 非目标（Non-Goals）

- 不使 `.nextagent/skills/...` 可写。
- 不只基于模型文本授予授权。
- 不翻译或重授权宿主绝对路径、source root、install root，或缺少受治理逻辑投影身份的路径。
- 本 change 不新建持久化的 Skill 激活表。
- 不自动重新投影缺失的 Skill 资源；如果已提交投影缺失，模型必须再次调用 Skill tool。

## 失败行为（Failure Behavior）

如果没有当前可见的 Skill descriptor 匹配，旧路径保持未授权。如果已提交投影 marker 缺失、无效或过期，跳过重授权，模型仍可显式调用 Skill tool。宿主绝对路径和不符合逻辑投影语法的路径被忽略，不能选中任何投影。
