## MODIFIED Requirements

### Requirement: Skill 资源访问 SHALL 通过 execution roots 暴露已授权资源

Skill resource access SHALL 保持 `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` 的授权范围限定在当前 accepted run。后续 run SHALL NOT 仅凭先前模型可见的 Skill 资源路径本身将其视为授权依据。

当后续 run 组装的模型上下文在选定文本、选定 tool result 或选定 tool-call 参数中包含先前的逻辑 `.nextagent/skills/<skillProjectionKey>/<skill-name>/` 路径时，系统 MAY 仅在当前可见的受治理 `SKILL` descriptor 派生出相同 projection key 且已提交的 projection marker 校验出相同 provider id、Skill 名称、Skill 版本和投影格式时，为当前 run 重新授权该已提交 projection。成功时，系统 SHALL 只将该 Skill subtree 加入当前 run 的已授权 Skill roots，并 MAY 向模型重新披露当前 run 已授权的 root。

如果匹配的 descriptor 不可用、被禁用、被 owner/agent scope 过滤，或已提交 marker 缺失或无效，系统 SHALL 保持先前路径未授权，并要求显式的 Skill tool load 重新投影和授权资源。
Host 绝对路径、source 路径、install 路径以及不包含受治理逻辑投影身份的路径 SHALL NOT 选择或重新授权任何 Skill projection。

#### Scenario: 后续 run 重新授权既有已提交 Skill projection
- **GIVEN** run1 成功加载了 `skillA`
- **AND** run2 的选定上下文包含 `Skill resource root: .nextagent/skills/<skillProjectionKey>/skillA/`
- **AND** run2 中 `skillA` 的可见受治理 Skill descriptor 派生出相同 `skillProjectionKey`
- **AND** 已提交的 projection marker 通过校验
- **WHEN** run2 准备 model invocation
- **THEN** run2 SHALL 为当前 run 的 file tools 和 sandbox 执行授权 `.nextagent/skills/<skillProjectionKey>/skillA/`
- **AND** run2 MAY 将该 root 作为当前 run 已授权上下文重新披露

#### Scenario: 先前 Skill root 文本不构成授权依据
- **GIVEN** run2 的选定上下文包含 `Skill resource root: .nextagent/skills/<skillProjectionKey>/skillA/`
- **AND** 没有当前可见的受治理 Skill descriptor 匹配该 root
- **WHEN** run2 读取或执行先前路径
- **THEN** 该访问 SHALL 因当前 run 未授权而被拒绝

#### Scenario: 后续 run 从选定的先前 Bash tool call 重新授权
- **GIVEN** run1 成功加载了 `skillA`
- **AND** run2 的选定上下文包含先前的 Bash tool-call 参数 `python .nextagent/skills/<skillProjectionKey>/skillA/scripts/check.py`
- **AND** run2 中 `skillA` 的可见受治理 Skill descriptor 派生出相同 `skillProjectionKey`
- **AND** 已提交的 projection marker 通过校验
- **WHEN** run2 准备 model invocation
- **THEN** run2 SHALL 为当前 run 的 file tools 和 sandbox 执行授权 `.nextagent/skills/<skillProjectionKey>/skillA/`
- **AND** run2 SHALL NOT 要求先前的 Skill result message 保持被选中

#### Scenario: Host 绝对路径不重新授权 Skill projection
- **GIVEN** run2 的选定上下文包含带 Windows 或 POSIX host 绝对脚本路径的先前 Bash tool-call 参数
- **WHEN** run2 准备 model invocation
- **THEN** 该 host 路径 SHALL NOT 选择或重新授权任何 Skill projection
- **AND** 该路径的 sandbox 执行 SHALL 仍受当前 run 的文件系统授权约束，并在未授权时 fail closed

#### Scenario: 重新授权的 Skill 资源保持只读
- **GIVEN** run2 已重新授权 `.nextagent/skills/<skillProjectionKey>/skillA/`
- **WHEN** 一个 file tool 或 sandboxed script 在该 root 下写入
- **THEN** 写入 SHALL 被拒绝
