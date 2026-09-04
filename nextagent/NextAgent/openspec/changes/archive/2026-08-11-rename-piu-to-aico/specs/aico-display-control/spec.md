## Function

- **所属 Function**：`FN-3.5 AICO 显示控制`
- **Function 变更类型**：MODIFIED
- **spec 角色**：主规格

## MODIFIED Requirements

### Requirement: clearStorage controls session restoration

`clearStorage` SHALL control whether collaborative mode restores the previous session on load. When `clearStorage` is `true`, collaborative mode MUST NOT restore the previous session ID from `sessionStorage` and MUST start with a fresh welcome state. When `clearStorage` is `false` or absent, collaborative mode MUST restore the previous session as per the current behavior.

`clearStorage` MUST NOT affect local or immersive modes.

#### Scenario: clearStorage true starts fresh
- **GIVEN** collaborative mode with `clearStorage: true` and `sessionStorage["nextagent:AICOPIU:activeSessionId"]` contains "session-1"
- **WHEN** the panel loads
- **THEN** the panel MUST NOT restore "session-1"
- **AND** the panel MUST show the welcome state

#### Scenario: clearStorage false restores previous session
- **GIVEN** collaborative mode with `clearStorage: false` and `sessionStorage["nextagent:AICOPIU:activeSessionId"]` contains "session-1"
- **WHEN** the panel loads
- **THEN** the panel MUST restore "session-1" as the active session

## Function 变更汇总

### 处理过程

- **变更类型**：修改
- **目标内容**：sessionStorage key 中 PIU 名称部分从 `AIAgentPIU` 改为 `AICOPIU`。
- **依据 Requirements**：clearStorage controls session restoration

### 结果

- **变更类型**：修改
- **目标内容**：sessionStorage key 为 `nextagent:AICOPIU:activeSessionId`。
- **依据 Requirements**：同上
