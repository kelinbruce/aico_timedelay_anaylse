## MODIFIED Requirements

### Requirement: Skill resources SHALL be projected into `.nextagent`

When the `Skill` Tool successfully loads a governed Skill body for the current request/run, its governed resources with safe relative paths SHALL be projected into `.nextagent/skills/<skillProjectionKey>/<skill-name>/...` before the hidden generated Skill load message is assembled. 首版 MUST NOT project path traversal entries, absolute paths, drive-qualified paths, URL-like paths, symlinks, hardlinks, special files, unsafe package cache paths or resources that exceed configured limits.

Projection MUST apply deterministic path normalization and filtering: use `/`, reject empty segment、`.`、`..`、absolute path、drive-qualified path、URL-like path、unsafe depth/length、symlinks、hardlinks、special files、`node_modules/` and package manager cache. Skill source discovery MUST include safe resources under the governed top-level resource directories `scripts/`、`references/`、`assets/` and `api/`. Projection MUST allow dot-prefixed directory segments such as `.hidden/skip.py`、`assets/.schemas/input.json`、`references/.vendor/guide.md` or `scripts/.helpers/tool.py` when all other projection safety checks pass. 首版每个 Skill projected resource count MUST be bounded by system/tool limits and MUST NOT exceed 200 files unless a later change defines a higher bound.

#### Scenario: Safe root-level Skill resources are projected
- **WHEN** a Skill source contains safe relative resources such as `README.md`, `scripts/tool.py`, `assets/schema.json` and `.hidden/skip.py`
- **THEN** projection MUST include each safe resource path
- **AND** each projected path MUST remain under `.nextagent/skills/<skillProjectionKey>/<skill-name>/...`

#### Scenario: Dot-prefixed directories are projected when otherwise safe
- **WHEN** an accepted run activates a governed Skill that contains `assets/.schemas/chatbi.yaml`
- **THEN** the run projection MUST make it available as `.nextagent/skills/<skillProjectionKey>/<skill-name>/assets/.schemas/chatbi.yaml`
- **AND** authorized file tools or sandboxed execution MUST be able to read that projected file through the authorized Skill projection subtree
- **AND** a safe root-level dot directory resource such as `.hidden/skip.py` MUST also be projected and readable through the same authorized subtree

#### Scenario: API resources are discovered and projected
- **WHEN** an accepted run activates a governed Skill that contains `api/a.yaml`
- **THEN** the run projection MUST make it available as `.nextagent/skills/<skillProjectionKey>/<skill-name>/api/a.yaml`
- **AND** authorized file tools or sandboxed execution MUST be able to read that projected file through the authorized Skill projection subtree

#### Scenario: Unsafe relative path segments remain rejected
- **WHEN** a Skill source lists resources with empty segments, `.`, `..`, absolute paths, drive-qualified paths, URL-like paths, symlink entries, hardlink entries or special files
- **THEN** those resources MUST NOT be projected
- **AND** no unauthorized `.nextagent/skills/.locks/`、`.nextagent/skills/.staging/` or projection marker path MUST become authorized for the run
