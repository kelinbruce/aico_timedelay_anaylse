# ts-attachment-config Specification

## Purpose
Define file upload configuration loading from agent config directory, deployment-mode-separated ChatUploadConfigProvider, Cap + Warn validation strategy, and effective config exposure.

## Function

- **所属 Function**：`FN-8.5 上传和管理附件`
- **spec 角色**：主规格

## Requirements

### Requirement: File upload config is loaded from agent config directory
The system MUST load file upload configuration from `agents/{agentId}/config/config.json` under the `chat-upload-file-config` key. The default agent's config MUST be treated as the global system config. The loader MUST use `AgentPackageSourceLocator` to locate the agent package root, then read `config/config.json`.

Config loading MUST happen through a `ChatUploadConfigProvider` selected by deployment mode. The provider MUST use `ChatUploadConfigSourceLocator` and a file loading function to resolve config.

**LOCAL mode**: `LocalChatUploadConfigProvider` loads config once at startup and returns the cached static value on every `get()` call. When the config file does not exist, the provider MUST return `defaultChatUploadFileConfig()` (markdown-only), so file upload remains available in local mode. The provider MUST NOT do fingerprint detection.

**REMOTE mode**: `RemoteChatUploadConfigProvider` uses file fingerprint (`statSync` `size + mtimeMs`) to detect config file changes and reload when the fingerprint changes. When the config file does not exist, the provider MUST return `undefined`, signaling that file upload is not configured. The provider MUST NOT cache the `undefined` result, so that a subsequently created config file is detected on the next request.

When the config file exists but contains invalid or missing fields, the loader MUST apply the Cap + Warn strategy (cap to system limits, use defaults for missing/invalid fields) and return the effective config.

#### Scenario: Config is loaded from default agent directory
- **WHEN** the system receives a bootstrap or upload request
- **THEN** the loader MUST locate the default agent package root
- **AND** the loader MUST read `config/config.json`
- **AND** the loader MUST parse the `chat-upload-file-config` section

#### Scenario: LOCAL mode config file does not exist returns default
- **WHEN** LOCAL mode and `config/config.json` does not exist for the default agent
- **THEN** the provider MUST return `defaultChatUploadFileConfig()` (markdown-only)
- **AND** the bootstrap response MUST include `chatUploadFileConfig` with default values
- **AND** file upload MUST remain available

#### Scenario: REMOTE mode config file does not exist returns undefined
- **WHEN** REMOTE mode and `config/config.json` does not exist for the default agent
- **THEN** the provider MUST return `undefined`
- **AND** the bootstrap response MUST NOT include `chatUploadFileConfig`
- **AND** the provider MUST NOT cache the `undefined` result

#### Scenario: REMOTE mode config file is created after startup
- **WHEN** REMOTE mode and the application starts without `config/config.json`
- **AND** the file is created after startup (pub flow)
- **THEN** the next request MUST detect the file via fingerprint change
- **AND** MUST load the config and return effective values
- **AND** MUST NOT return `undefined`

#### Scenario: REMOTE mode config file content changes after initial load
- **WHEN** REMOTE mode and the config file has been loaded and cached
- **AND** the file content is modified (size or mtimeMs changes)
- **THEN** the next request MUST detect the fingerprint change
- **AND** MUST reload the config and update the cache
- **AND** MUST NOT return the stale cached config

#### Scenario: Config file exists with invalid fields uses Cap and Warn
- **WHEN** the config file exists but `chat-upload-max-file-number` exceeds the system limit
- **THEN** the provider MUST cap the value to the system limit
- **AND** MUST return the effective config (not `undefined`)

### Requirement: Config validation uses Cap and Warn strategy
Config field validation MUST silently cap values to system limits, use defaults for missing or invalid fields, and never fail system startup. The system MUST NOT return config validation notices to the frontend. The bootstrap API MUST return only the effective (post-validation) config values.

System hard limits:
- `chat-upload-max-file-number`: max 200
- `chat-upload-max-file-size`: max 500 (M)
- Total file size per user (all sessions): max 500 MB
- User tmp quota: 1024 MB

#### Scenario: Config value exceeds system limit is capped
- **WHEN** `chat-upload-max-file-number` is configured as 500
- **THEN** the effective value MUST be 200
- **AND** the system MUST start normally

#### Scenario: Config field is missing uses default
- **WHEN** `chat-upload-max-file-number` is not present in config
- **THEN** the effective value MUST be 10 (default)

#### Scenario: Config field has wrong type uses default
- **WHEN** `chat-upload-max-file-size` is configured as a string `"10"`
- **THEN** the effective value MUST be 10 (default)

#### Scenario: Empty hofs-bucket-name selects local storage only
- **WHEN** `hofs-bucket-name` is empty or whitespace
- **THEN** app composition MUST select local storage for staged attachment bytes
- **AND** the public upload API MUST remain the unified staged upload API
- **AND** the frontend MUST NOT switch to submit multipart because HOFS is absent

#### Scenario: Empty file-type array defaults to markdown
- **WHEN** `chat-upload-file-type` is an empty array
- **THEN** the effective value MUST be `["*.md"]`

#### Scenario: max-expire-time less than idle-expire-time is adjusted
- **WHEN** `upload-file-max-expire-time` is less than `upload-file-idle-expire-time`
- **THEN** `upload-file-max-expire-time` MUST be set equal to `upload-file-idle-expire-time`

### Requirement: Config exposes effective values through bootstrap API
The `/api/v1/runtime/bootstrap` endpoint MUST include effective upload limits and accepted file types when attachment upload is enabled. The response MUST contain only post-validation values. Storage backend selection is an app composition concern and MUST NOT require the frontend to choose a different upload protocol.

#### Scenario: Bootstrap returns effective config
- **WHEN** the frontend calls `/api/v1/runtime/bootstrap`
- **THEN** the response MUST include `chatUploadFileConfig` with effective values
- **AND** the values MUST reflect any capping or default substitution

#### Scenario: Bootstrap without HOFS config still uses unified upload
- **WHEN** HOFS is not configured (local mode)
- **THEN** local storage MUST back the same staged upload API
- **AND** the frontend MUST not receive instructions to use submit multipart as a fallback
