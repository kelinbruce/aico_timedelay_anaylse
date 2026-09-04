import {
  agentToolDefinition,
  builtinToolDefinitions,
  createBashToolDefinition,
  editToolDefinition,
  globToolDefinition,
  grepToolDefinition,
  pythonToolDefinition,
  ragToolDefinition,
  readToolDefinition,
  skillToolDefinition,
  toolSearchToolDefinition,
  writeToolDefinition,
} from '@nextagent/agent-capability';
import { Ajv } from 'ajv/dist/ajv.js';
import { describe, expect, it } from 'vitest';

describe('builtin model-visible tool guidance', () => {
  it('keeps file tool boundaries and path continuity explicit', () => {
    expect(readToolDefinition.metadata.description).toContain('known file path');
    expect(readToolDefinition.metadata.description).not.toContain('When unsure of the path, use Glob first');
    expect(writeToolDefinition.metadata.description).toContain('full Read snapshot');
    expect(editToolDefinition.metadata.description).toContain('exact path returned by Read');
    expect(globToolDefinition.metadata.description).toContain('does not sort by modification time');
    expect(globToolDefinition.metadata.description).toContain('`**/*.{yaml,yml}`');
    expect(globToolDefinition.metadata.description).toContain('character classes');
    const globPattern = (globToolDefinition.metadata.inputSchema['properties'] as Record<string, Record<string, unknown>>)['pattern'];
    expect(globPattern?.['description']).toContain('`**/*.{yaml,yml}`');
    expect(grepToolDefinition.metadata.description).toContain('ECMAScript regular expression');
  });

  it('routes existing scripts to Bash and direct source snippets to Python', () => {
    expect(createBashToolDefinition().metadata.description).toContain('existing script or module');
    expect(createBashToolDefinition().metadata.description).toContain('composed sandbox policy');
    expect(pythonToolDefinition.metadata.description).toContain('does not accept a `.py` file path');
    expect(pythonToolDefinition.metadata.description).toContain('code field');
    expect(pythonToolDefinition.metadata.description).toContain('A filename-like value in `args` is data');
    expect(pythonToolDefinition.metadata.description).toContain('does not discover or authorize that file');
  });

  it('keeps governed knowledge and capability discovery boundaries distinct', () => {
    expect(ragToolDefinition.metadata.description).toContain('governed knowledge sources');
    expect(ragToolDefinition.metadata.description).toContain('This event is triggered when the build-in RAG tool is specified');
    expect(ragToolDefinition.metadata.description).toContain('To read a known file, use Read');
    expect(skillToolDefinition.metadata.description).toContain('exact capability id');
    expect(toolSearchToolDefinition.metadata.description).toContain('does not search Agents, Workflows, files, knowledge content, or memory');
    expect(agentToolDefinition.metadata.description).toContain('Available agents');
    expect(agentToolDefinition.metadata.description).toContain('does not inherit parent conversation context');
  });

  it('keeps every builtin model-visible tool description within the 4096-character model contract gate', () => {
    for (const definition of builtinToolDefinitions) {
      expect(definition.metadata.description.length).toBeLessThanOrEqual(4096);
    }
    const bashDescription = createBashToolDefinition({ backgroundExecutionEnabled: true }).metadata.description;
    expect(bashDescription.length).toBeLessThanOrEqual(4096);
    expect(bashDescription).toContain(
      '`clipc --params`: when a Skill opts in via `api_header_params`, runtime injects the declared `X-Subject-Id`/`X-Display-Name`; never set them manually.',
    );
  });

  it('does not promise background completion notifications that runtime does not provide', () => {
    const definition = createBashToolDefinition({ backgroundExecutionEnabled: true });
    const runInBackground = (definition.metadata.inputSchema['properties'] as Record<string, Record<string, unknown>>)['run_in_background'];
    expect(runInBackground?.['description']).toContain('You will not be notified');
    expect(runInBackground?.['description']).not.toContain('You will be notified when');
  });

  it('requires AskUserQuestion for ordinary user questions and keeps its schema guidance concise', () => {
    const definition = builtinToolDefinitions.find((candidate) => candidate.metadata.name === 'AskUserQuestion');
    expect(definition).toBeDefined();
    expect(definition?.metadata.description).toContain(
      'You MUST call this tool whenever you need to ask the user any ordinary question—never use plain assistant text to ask questions.',
    );
    expect(definition?.metadata.description).toContain('follow-up, clarification, preference, implementation choice, or ordinary confirmation');
    expect(definition?.metadata.description).toContain('CRITICAL OPTION VALIDATION RULE');
    expect(definition?.metadata.description).toContain('protected-operation approval, high-risk confirmations');
    expect(definition?.metadata.description).not.toContain('Use only when missing user-provided information blocks safe progress');

    const inputSchema = definition?.metadata.inputSchema as Record<string, unknown>;
    const rootProperties = inputSchema['properties'] as Record<string, Record<string, unknown>>;
    const questions = rootProperties['questions']!;
    const questionItems = questions['items'] as Record<string, unknown>;
    const questionProperties = questionItems['properties'] as Record<string, Record<string, unknown>>;
    const options = questionProperties['options']!;
    const optionItems = options['items'] as Record<string, unknown>;
    const optionProperties = optionItems['properties'] as Record<string, Record<string, unknown>>;

    expect(inputSchema).toMatchObject({ type: 'object', additionalProperties: false, required: ['questions'] });
    expect(questions).toMatchObject({ type: 'array', minItems: 1, maxItems: 3 });
    expect(questionItems).toMatchObject({ type: 'object', additionalProperties: false, required: ['prompt'] });
    expect(options).toMatchObject({ type: 'array', minItems: 2, maxItems: 15 });
    expect(optionItems).toMatchObject({ type: 'object', additionalProperties: false, required: ['value', 'label'] });
    expect(questions['description']).toBe(
      'Clarification questions for the user. Omit options for free-text answers; include options for predefined choices.',
    );
    expect(questionProperties['prompt']?.['description']).toBe('The question text shown to the user.');
    expect(options['description']).toBe(
      'Provide two to fifteen concise predefined choices for the user. Omit for free-text questions. Each option needs a unique value. If selecting an option alone leaves any information required to continue missing, that option must set requiresTextInput=true.',
    );
    expect(questionProperties['multiple']?.['description']).toBe('Allow selecting multiple options. Only valid when options are present.');
    expect(questionProperties['custom']?.['description']).toBe('Allow a free-text answer alongside predefined options.');
    expect(optionProperties['value']?.['description']).toBe('Unique identifier for this option within the question. Used in the answer.');
    expect(optionProperties['label']?.['description']).toBe('Display text for this option.');
    expect(optionProperties['requiresTextInput']?.['description']).toBe(
      'Set true whenever selecting this option alone does not provide all information required to continue. This includes options that require a target, value, identifier, name, reason, description, correction, replacement, or other additional detail. Omitting this field asserts that the option is complete and immediately actionable as-is.',
    );
    expect(optionProperties['inputPlaceholder']?.['description']).toBe(
      'Placeholder text for the text input. Only valid when requiresTextInput=true.',
    );

    const validate = new Ajv({ strict: false }).compile(inputSchema);
    const choices = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ value: `severity-${index + 1}`, label: `Severity ${index + 1}` }));
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(8) }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(9) }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(10) }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(14) }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(15) }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which alarm severity?', options: choices(16) }] })).toBe(false);
  });

  it('allows requiresTextInput options with custom but rejects with multiple', () => {
    const definition = builtinToolDefinitions.find((candidate) => candidate.metadata.name === 'AskUserQuestion');
    const inputSchema = definition?.metadata.inputSchema as Record<string, unknown>;
    const ajv = new Ajv({ strict: false });
    const validate = ajv.compile(inputSchema);

    const requiresTextInputOptions = [
      { value: 'device-a', label: 'Device A', requiresTextInput: true, inputPlaceholder: 'Enter ID' },
      { value: 'device-b', label: 'Device B' },
    ];

    expect(validate({ questions: [{ prompt: 'Which device?', options: requiresTextInputOptions, custom: true }] })).toBe(true);
    expect(validate({ questions: [{ prompt: 'Which device?', options: requiresTextInputOptions, multiple: true }] })).toBe(false);
  });

  it('mentions user free-text possibility and omits custom mutex in tool guidance', () => {
    const definition = builtinToolDefinitions.find((candidate) => candidate.metadata.name === 'AskUserQuestion');
    const description = definition?.metadata.description ?? '';
    expect(description.length).toBeLessThanOrEqual(4096);
    expect(description).toContain('Users may provide free-text answers outside the predefined options');
    expect(description).toContain('Predefined options are suggestions, not an allowlist');
    expect(description).toContain('selections=[] means the user selected no predefined option');
    expect(description).toContain('never claim or infer that the user selected an option');
    expect(description).toContain('Never reject a free-text answer, describe it as invalid, or ask the user to select again');
    expect(description).toContain('Never coerce or map it to the closest predefined option');
    expect(description).toContain('follow the free-text intent instead of the options');
    expect(description).toContain('preserve that exact intent and ask only for the missing information');
    expect(description).toContain('Never ask the user to repeat, reselect, or reconfirm information already provided');
    expect(description).toContain('ANSWER CLASSIFICATION RULE');
    expect(description).toContain('if it answers the question, use it as the answer');
    expect(description).toContain('a new intent aimed at a different domain or target');
    expect(description).toContain('any clear topic shift, not only imperatives');
    expect(description).toContain('never force it into the answer slot');
    expect(description).toContain('treat the original question as closed');
    expect(description).toContain('Do not re-ask, restate, loop back to, or otherwise resume the original question');
    expect(description).not.toContain('do not combine such options with multiple=true or custom=true');
    expect(description).toContain('do not combine such options with multiple=true');
  });
});
