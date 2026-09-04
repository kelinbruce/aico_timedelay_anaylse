# telecom-bilingual-output Specification

## Purpose
TBD - created by archiving change add-ts-bilingual-telecom-output. Update Purpose after archive.
## Requirements
### Requirement: Context Engine SHALL add bilingual telecom output rules to the SYSTEM_PROMPT

The Context Engine SHALL include a pair of language and terminology rules in the system prompt text to control the model's output language behavior and telecom term treatment. These rules SHALL be appended to the existing `communication-style.md` section file within the `SYSTEM_PROMPT` template directory (`prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md`). The rule text SHALL be part of the static markdown content of that section, not injected via template variables or separate code paths.

The rule text SHALL contain two distinct behavioral directives:
1. **Language following directive**: The model SHALL respond in the same natural language as the user's current input message. The model SHALL NOT rely on the `Locale/language hint` value in the system message as authority for output language; the user's actual input language observed in the conversation SHALL take precedence.
2. **Telecom term preservation directive**: The model SHALL preserve all telecom terms, NE names, interface names, counters, alarms, KPI names, protocol names, and English abbreviations in their original form without translation. This SHALL apply regardless of the output language chosen under directive 1.

设计入口：`prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md` 的末尾追加行。

#### Scenario: Bilingual telecom rules appear in system prompt
- **GIVEN** a context assembly request for any session
- **WHEN** `ContextEngine.render()` produces a `RenderedModelInput`
- **THEN** the rendered system message contains the bilingual telecom output rules
- **AND** the rule text includes both the "language following" directive and the "telecom term preservation" directive
- **AND** the rule text is part of the `communication-style.md` section content, not from a separate section or variable injection

#### Scenario: Rule text is maintained in communication-style.md
- **GIVEN** the `communication-style.md` file in `prompt-templates/builtin/SYSTEM_PROMPT/`
- **WHEN** the rule text is updated in that file
- **THEN** the system prompt content reflects the change without additional code modification
- **AND** no separate TypeScript export, variable registration, or section definition change is required

### Requirement: Language following directive overrides locale hint in system message

The language following directive in the bilingual telecom rules SHALL have higher behavioral priority than the `Locale/language hint` line appended by `ModelInputRenderer.renderSystemMessageText()`. The directive text SHALL explicitly instruct the model to use the user's actual input language instead of the declared locale when the two differ. The `Locale/language hint` line SHALL remain in the system message as informational metadata for diagnostics and debugging; it SHALL NOT be suppressed or removed.

The `RenderSystemMessageText()` implementation SHALL NOT modify the existing `localeHint` formatting or suppress the `Locale/language hint` line. The override effect SHALL be achieved entirely through the directive text within the `communication-style.md` section content.

设计入口：`prompt-templates/builtin/SYSTEM_PROMPT/communication-style.md` 的规则指令文本。

#### Scenario: User input language differs from locale hint
- **GIVEN** the system message contains both `Locale/language hint: zh-CN` and the bilingual telecom rules
- **WHEN** the user sends a message in English
- **THEN** the model SHALL respond in English
- **AND** this behavior SHALL be controlled by the language following directive text, not by suppressing the locale hint line

#### Scenario: Locale hint is preserved for diagnostics
- **GIVEN** the bilingual telecom rules are included in the system prompt
- **WHEN** the system message is rendered
- **THEN** the `Locale/language hint: <locale>` line SHALL still appear in the system message
- **AND** no code change SHALL remove or comment out the localeHint variable in `renderSystemMessageText()`

### Requirement: Telecom term preservation applies regardless of output language

The telecom term preservation directive SHALL instruct the model to keep a fixed set of telecom-domain vocabulary in its original English form, independent of the output language chosen for the rest of the response. The preserved vocabulary categories SHALL include: NE names, interface names, counters, alarms, KPI names, protocol names, IP addresses, port numbers, CLI command names, alarm identifiers, and English abbreviations commonly used in telecom operations.

This directive SHALL be expressed as part of the rule text appended to `communication-style.md` and SHALL be resolved through the normal section content reading path, without template variable injection.

设计入口：`communication-style.md` 中的规则文本内容设计。

#### Scenario: Telecom terms preserved in Chinese response
- **GIVEN** the system prompt includes the telecom term preservation directive
- **WHEN** the user sends a Chinese message containing "LTE RSRP dropped by 15dBm on eNodeB 12345"
- **THEN** the model SHALL respond in Chinese
- **AND** the terms "LTE", "RSRP", "dBm", and "eNodeB" SHALL appear in their original English form in the response (e.g., "LTE RSRP 下降 15dBm，eNodeB 12345 受影响" rather than "长期演进参考信号接收功率下降...")

#### Scenario: Telecom terms preserved in English response
- **GIVEN** the system prompt includes the telecom term preservation directive
- **WHEN** the user sends a message entirely in English
- **THEN** the model SHALL respond in English
- **AND** all telecom terms SHALL remain in their original form (this scenario verifies the directive does not interfere with normal English output)

### Requirement: Bilingual telecom rules are part of existing section content

The bilingual telecom output rule text SHALL be part of the existing `communication-style.md` static markdown file within the `SYSTEM_PROMPT` section directory. The rules SHALL NOT be defined in TypeScript code, injected via template variables, or loaded through a separate code path. This ensures the rules are maintained as prompt content rather than implementation code.

This approach treats the domain-specific language rules as content that belongs alongside the other communication style instructions, not as a separately governed template variable.

#### Scenario: Rules appended to existing section
- **GIVEN** the `communication-style.md` file in `prompt-templates/builtin/SYSTEM_PROMPT/`
- **WHEN** the file is read
- **THEN** its content ends with the bilingual telecom output rules
- **AND** no separate markdown file, template section definition, or TypeScript export contains the rule text as its primary source

#### Scenario: Rendering path unchanged
- **GIVEN** a rendering pipeline that reads `communication-style.md` as a static section
- **WHEN** the pipeline renders the system prompt
- **THEN** the bilingual telecom rules appear as the last lines of the `communication_style` section content
- **AND** the section is rendered through the normal static markdown path without any template variable resolution for the rules
- **AND** no changes to `renderSystemMessageText()`, `variable-resolver.ts`, `prompt-template-purpose-policy.ts`, or `template.yaml` are required to include the rules

