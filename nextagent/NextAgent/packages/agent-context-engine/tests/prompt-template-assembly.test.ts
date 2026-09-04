import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { compilePromptRoot } from '@nextagent/agent-context-engine';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('prompt template canonical model authoring', () => {
  it('compiles scalar model matching and all canonical optional inference fields without defaults', () => {
    const [template] = compile([
      'purpose: custom.prompt',
      'match:',
      '  model: model-a',
      'modelOptions:',
      '  temperature: 0.4',
      '  maxOutputTokens: 4096',
      '  topP: 0.9',
      '  topK: 40',
      '  presencePenalty: 0.2',
      '  frequencyPenalty: -0.1',
      '  thinking:',
      '    depth: HIGH',
      '  toolChoice: NONE',
      '  providerOptions:',
      '    serviceTier: priority',
      '    nested:',
      '      enabled: true',
      'content: Diagnose the network safely.',
    ]);

    expect(template?.match).toEqual({ model: 'model-a' });
    expect(template?.modelOptions).toEqual({
      temperature: 0.4,
      maxOutputTokens: 4096,
      topP: 0.9,
      topK: 40,
      presencePenalty: 0.2,
      frequencyPenalty: -0.1,
      thinking: { depth: 'HIGH' },
      toolChoice: 'NONE',
      providerOptions: {
        serviceTier: 'priority',
        nested: { enabled: true },
      },
    });

    const [minimal] = compile(['purpose: custom.prompt', 'match:', '  model: model-a', 'content: Minimal.']);
    expect(minimal?.modelOptions).toBeUndefined();
  });

  it.each([
    ['nested object', ['match:', '  model:', '    id: model-a'], 'PROMPT_MODEL_MATCH_SCALAR_REQUIRED'],
    ['array', ['match:', '  model: [model-a]'], 'PROMPT_MODEL_MATCH_SCALAR_REQUIRED'],
    ['null', ['match:', '  model: null'], 'PROMPT_MODEL_MATCH_SCALAR_REQUIRED'],
    ['number', ['match:', '  model: 123'], 'PROMPT_MODEL_MATCH_SCALAR_REQUIRED'],
    ['trimmed-empty string', ['match:', '  model: "   "'], 'PROMPT_MODEL_ID_INVALID'],
  ])('rejects %s as a model match', (_case, matchLines, code) => {
    expect(() => compile(['purpose: custom.prompt', ...matchLines, 'content: Invalid.'])).toThrowError(expect.objectContaining({ code }));
  });

  it.each([
    ['timeoutMs', '30000', 'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED'],
    ['maxRetries', '2', 'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED'],
    ['baseUrl', 'https://provider.invalid/v1', 'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED'],
    ['credentialRef', 'env:MODEL_TOKEN', 'PROMPT_MODEL_OPTIONS_FIELD_UNSUPPORTED'],
  ])('rejects non-inference option %s', (field, value, code) => {
    expect(() => compile(['purpose: custom.prompt', 'modelOptions:', `  ${field}: ${value}`, 'content: Invalid.'])).toThrowError(
      expect.objectContaining({ code }),
    );
  });

  it.each(['reasoning', 'thinking', 'reasoningEffort'])('rejects duplicate provider reasoning control %s', (field) => {
    expect(() =>
      compile([
        'purpose: custom.prompt',
        'modelOptions:',
        '  thinking:',
        '    depth: LOW',
        '  providerOptions:',
        `    ${field}: high`,
        'content: Invalid.',
      ]),
    ).toThrowError(expect.objectContaining({ code: 'PROMPT_PROVIDER_REASONING_DUPLICATE' }));
  });

  it('rejects null and non-object provider options', () => {
    expect(() => compile(['purpose: custom.prompt', 'modelOptions:', '  providerOptions: null', 'content: Invalid.'])).toThrowError(
      expect.objectContaining({ code: 'PROMPT_MODEL_OPTIONS_INVALID' }),
    );
    expect(() =>
      compile(['purpose: custom.prompt', 'modelOptions:', '  providerOptions:', '    serviceTier: null', 'content: Invalid.']),
    ).toThrowError(expect.objectContaining({ code: 'PROMPT_MODEL_OPTIONS_INVALID' }));
  });

  it.each(['AUTO', 'NONE', 'REQUIRED'])('accepts canonical toolChoice %s', (toolChoice) => {
    const [template] = compile(['purpose: custom.prompt', 'modelOptions:', `  toolChoice: ${toolChoice}`, 'content: Valid.']);
    expect(template?.modelOptions?.toolChoice).toBe(toolChoice);
  });

  it.each(['auto', 'Read', 'null', 'UNKNOWN'])('rejects non-canonical toolChoice %s', (toolChoice) => {
    expect(() => compile(['purpose: custom.prompt', 'modelOptions:', `  toolChoice: ${toolChoice}`, 'content: Invalid.'])).toThrowError(
      expect.objectContaining({ code: 'PROMPT_MODEL_OPTIONS_INVALID' }),
    );
  });
});

function compile(lines: readonly string[]) {
  const root = mkdtempSync(join(tmpdir(), 'nextagent-prompt-contract-'));
  roots.push(root);
  const templateDir = join(root, 'system');
  mkdirSync(templateDir, { recursive: true });
  writeFileSync(join(templateDir, 'template.yaml'), lines.join('\n'), 'utf8');
  return compilePromptRoot({ sourceLayer: 'builtin', rootPath: root });
}
