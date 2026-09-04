import { AgentError } from '@nextagent/agent-common';
import { normalizeCapabilityDirectiveInput, parseCapabilityDirective } from '../src/routing/capability-directive-parser.js';
import { describe, expect, it } from 'vitest';

describe('capability directive parser', () => {
  it('parses skill and workflow directives from accepted request text', () => {
    expect(parseCapabilityDirective('use $skill:alarm-diagnosis now')).toEqual({
      kind: 'skill',
      name: 'alarm-diagnosis',
    });
    expect(parseCapabilityDirective('$workflow:push-gate diagnose RAN alarms')).toEqual({
      kind: 'workflow',
      name: 'push-gate',
    });
  });

  it('does not treat slash commands as natural-language directives', () => {
    expect(parseCapabilityDirective('/skill alarm-diagnosis')).toEqual({ kind: 'none' });
    expect(parseCapabilityDirective('/workflow push-gate')).toEqual({ kind: 'none' });
  });

  it('rejects unsafe directive syntax', () => {
    expect(parseCapabilityDirective('$skill:alarm diagnosis')).toEqual({
      kind: 'skill',
      name: 'alarm',
    });
    expect(parseCapabilityDirective('$skill:../secret')).toEqual({
      kind: 'invalid',
      reasonCode: 'CAPABILITY_DIRECTIVE_INVALID',
    });
    expect(parseCapabilityDirective('$workflow:https://example.invalid/flow')).toEqual({
      kind: 'invalid',
      reasonCode: 'CAPABILITY_DIRECTIVE_INVALID',
    });
    expect(parseCapabilityDirective('$skill:$(rm')).toEqual({
      kind: 'invalid',
      reasonCode: 'CAPABILITY_DIRECTIVE_INVALID',
    });
  });

  it('normalizes repeated same target and rejects conflicting directives', () => {
    expect(parseCapabilityDirective('$skill:alarm-diagnosis and $skill:alarm-diagnosis')).toEqual({
      kind: 'skill',
      name: 'alarm-diagnosis',
    });
    expect(parseCapabilityDirective('$skill:alarm-diagnosis $skill:other-skill')).toEqual({
      kind: 'ambiguous',
      reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS',
    });
    expect(parseCapabilityDirective('$workflow:push-gate $workflow:release-gate')).toEqual({
      kind: 'ambiguous',
      reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS',
    });
    expect(parseCapabilityDirective('$skill:alarm-diagnosis $workflow:push-gate')).toEqual({
      kind: 'ambiguous',
      reasonCode: 'CAPABILITY_DIRECTIVE_AMBIGUOUS',
    });
  });

  it('projects workflow and skill directives into routing constraints and effective input text', () => {
    expect(normalizeCapabilityDirectiveInput('$workflow:ran-alarm-diagnosis diagnose RAN alarms', { allowSubagents: false })).toEqual({
      inputText: 'diagnose RAN alarms',
      routingConstraints: {
        targetRecipe: 'ran-alarm-diagnosis',
        allowSubagents: false,
      },
    });
    expect(normalizeCapabilityDirectiveInput('$skill:alarm-diagnosis diagnose alarms', { allowHumanInput: false })).toEqual({
      inputText: 'diagnose alarms',
      routingConstraints: {
        targetSkill: 'alarm-diagnosis',
        allowHumanInput: false,
      },
    });
  });

  it('removes every repeated directive token while preserving other text', () => {
    expect(normalizeCapabilityDirectiveInput('please use $skill:alarm-diagnosis to $skill:alarm-diagnosis diagnose alarms')).toEqual({
      inputText: 'please use  to  diagnose alarms',
      routingConstraints: { targetSkill: 'alarm-diagnosis' },
    });
  });

  it('keeps no-directive, invalid, and ambiguous input unchanged without derived targets', () => {
    expect(normalizeCapabilityDirectiveInput('diagnose alarms')).toEqual({
      inputText: 'diagnose alarms',
    });
    expect(normalizeCapabilityDirectiveInput('$skill:../secret diagnose alarms')).toEqual({
      inputText: '$skill:../secret diagnose alarms',
    });
    expect(normalizeCapabilityDirectiveInput('$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis diagnose alarms')).toEqual({
      inputText: '$skill:alarm-diagnosis $workflow:ran-alarm-diagnosis diagnose alarms',
    });
  });

  it('rejects a pure directive with no effective user question as empty', () => {
    const cases = ['$skill:bom-test-skill', '$workflow:push-gate', '$skill:alarm-diagnosis $skill:alarm-diagnosis', '   $skill:alarm-diagnosis   '];
    for (const input of cases) {
      let caught: unknown;
      try {
        normalizeCapabilityDirectiveInput(input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AgentError);
      const err = caught as AgentError;
      expect(err.code).toBe('CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY');
      expect(err.category).toBe('VALIDATION');
      expect(err.retryable).toBe(false);
      expect(err.safeDetails).toEqual({ reasonCode: 'CAPABILITY_DIRECTIVE_EFFECTIVE_QUESTION_EMPTY' });
    }
  });

  it('still projects a directive that carries an effective user question', () => {
    expect(normalizeCapabilityDirectiveInput('$skill:bom-test-skill 帮我分析掉话')).toEqual({
      inputText: '帮我分析掉话',
      routingConstraints: { targetSkill: 'bom-test-skill' },
    });
  });
});
