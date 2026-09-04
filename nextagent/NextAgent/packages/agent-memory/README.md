# agent-memory

职责: long-term memory, self-learning, knowledge lifecycle, long-term memory retrieval, and memory prompt profile boundaries.

非职责: request lifecycle, Web API, context window selection, terminal commit writes, concrete storage implementation, extraction algorithms, or ranking algorithms.

Public exports: `@nextagent/agent-memory`.

Allowed dependencies: `agent-common` and public `agent-contracts` subpaths used by memory core and memory tool contribution contracts. The `memory-tools` provider/factory returns standard tool definitions for app composition; it is not an internal memory service API.

Forbidden dependencies: Web channel, runtime implementation, context-engine private paths, model provider SDK, app composition, gateway-local private paths, capability catalog/discovery/executor/builtin tool implementations, and tracing/metrics SDK types.

Replacement boundary: no.
