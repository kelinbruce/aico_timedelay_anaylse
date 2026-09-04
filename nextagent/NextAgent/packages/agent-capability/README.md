# agent-capability

职责: capability registry and execution boundary, including the generic Tool, Skill, and Agent capability types.

非职责: business-specific Tool, Skill, or Agent schemas; duplicate execution mechanisms for MCP tools, API-backed tools, or skills.

Public exports: `@nextagent/agent-capability`.

Allowed dependencies: `agent-common` and architecture-approved `agent-contracts/agent-assembly`, `agent-contracts/capability`, and `agent-contracts/gateway` subpaths.

Forbidden dependencies: Web channel, runtime private state, provider SDK leakage into contracts, PaaS sandbox SDK leakage, database drivers, `agent-memory`, memory DTOs, memory gateway ports, and memory provider code.

Memory tools boundary: `agent-capability` owns only the generic Tool SPI, catalog, discovery, and invocation path. App-composed tools may be registered as provider-scoped `ToolDefinition[]` inputs, but capability remains memory-agnostic.

Replacement boundary: yes; capability providers can be replaced as a package.
