import { describe, expect, it } from 'vitest';
import { resolveCapabilityProcessTitle, type CapabilityPresentationResourceMap } from './capabilityProcessTitle.ts';

const zh = translation({
  'turn.process.capability.executeOperation': '执行操作',
  'turn.process.capability.invokeAgent': '调用子智能体',
  'turn.process.capability.invokeAgentNamed': '调用子智能体：{{name}}',
  'turn.process.capability.loadSkill': '加载技能',
  'turn.process.capability.loadSkillNamed': '加载技能：{{name}}',
  'turn.process.capability.runWorkflow': '执行预设流程',
  'turn.process.capability.runWorkflowNamed': '执行预设流程：{{name}}',
});

const en = translation({
  'turn.process.capability.executeOperation': 'Execute operation',
  'turn.process.capability.invokeAgent': 'Invoke sub-agent',
  'turn.process.capability.invokeAgentNamed': 'Invoke sub-agent: {{name}}',
  'turn.process.capability.loadSkill': 'Load skill',
  'turn.process.capability.loadSkillNamed': 'Load skill: {{name}}',
  'turn.process.capability.runWorkflow': 'Run preset workflow',
  'turn.process.capability.runWorkflowNamed': 'Run preset workflow: {{name}}',
});

const resources: CapabilityPresentationResourceMap = new Map([
  [
    'TOOL:Read',
    {
      capabilityKind: 'TOOL',
      capabilityId: 'Read',
      displayName: 'Read',
      locales: {
        language: {
          'zh-CN': { displayName: '读取文件' },
          'en-US': { displayName: 'Read file' },
        },
      },
    },
  ],
  [
    'TOOL:NetworkElementStatusLookup',
    {
      capabilityKind: 'TOOL',
      capabilityId: 'NetworkElementStatusLookup',
      displayName: 'Network element status lookup',
      locales: {
        language: {
          'zh-CN': { displayName: '查询网元状态' },
          'en-US': { displayName: 'Query network element status' },
        },
      },
    },
  ],
  [
    'SKILL:alarm-diagnosis',
    {
      capabilityKind: 'SKILL',
      capabilityId: 'alarm-diagnosis',
      displayName: 'Alarm diagnosis stable',
      locales: { language: { 'en-US': { displayName: 'Alarm diagnosis' } } },
    },
  ],
  [
    'AGENT:network-agent',
    {
      capabilityKind: 'AGENT',
      capabilityId: 'network-agent',
      displayName: 'Network agent',
    },
  ],
  [
    'WORKFLOW:alarm-recovery',
    {
      capabilityKind: 'WORKFLOW',
      capabilityId: 'alarm-recovery',
      displayName: 'Alarm recovery',
      locales: { language: { 'zh-CN': { displayName: '告警恢复' } } },
    },
  ],
]);

describe('resolveCapabilityProcessTitle', () => {
  it.each([
    ['zh-CN', '读取文件'],
    ['en-US', 'Read file'],
  ] as const)('uses the exact UI locale for an ordinary Tool (%s)', (locale, expected) => {
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'Read' }, zh, locale, resources)).toBe(expected);
  });

  it('falls back from the exact locale to en-US, stable displayName, then capabilityId', () => {
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'SKILL', capabilityId: 'alarm-diagnosis' }, zh, 'fr-FR', resources)).toBe(
      '加载技能：Alarm diagnosis',
    );
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'AGENT', capabilityId: 'network-agent' }, zh, 'fr-FR', resources)).toBe(
      '调用子智能体：Network agent',
    );
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'WORKFLOW', capabilityId: 'future-workflow' }, zh, 'fr-FR', resources)).toBe(
      '执行预设流程：future-workflow',
    );
  });

  it.each([
    ['Agent', 'network-agent', '调用子智能体：Network agent'],
    ['Skill', 'alarm-diagnosis', '加载技能：Alarm diagnosis'],
    ['Workflow', 'alarm-recovery', '执行预设流程：告警恢复'],
  ] as const)('resolves the %s wrapper through its target descriptor', (capabilityId, targetCapabilityId, expected) => {
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId, targetCapabilityId }, zh, 'zh-CN', resources)).toBe(expected);
  });

  it.each([
    ['AGENT', 'network-agent', '调用子智能体：Network agent'],
    ['SKILL', 'alarm-diagnosis', '加载技能：Alarm diagnosis'],
    ['WORKFLOW', 'alarm-recovery', '执行预设流程：告警恢复'],
  ] as const)('uses the same resource path for a direct %s event', (capabilityKind, capabilityId, expected) => {
    expect(resolveCapabilityProcessTitle({ capabilityKind, capabilityId }, zh, 'zh-CN', resources)).toBe(expected);
  });

  it('does not fall back to an arbitrary available language', () => {
    const frenchOnly: CapabilityPresentationResourceMap = new Map([
      [
        'TOOL:FrenchOnly',
        {
          capabilityKind: 'TOOL',
          capabilityId: 'FrenchOnly',
          displayName: 'Stable name',
          locales: { language: { 'fr-FR': { displayName: 'Nom français' } } },
        },
      ],
    ]);

    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'FrenchOnly' }, zh, 'de-DE', frenchOnly)).toBe('Stable name');
  });

  it('uses neutral action text for an invalid identity and never renders control characters', () => {
    expect(resolveCapabilityProcessTitle({}, zh, 'zh-CN', resources)).toBe('执行操作');
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'Read\u0000secret' }, zh, 'zh-CN', resources)).toBe('执行操作');
    expect(
      resolveCapabilityProcessTitle(
        { capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'alarm\u0000diagnosis' },
        zh,
        'zh-CN',
        resources,
      ),
    ).toBe('加载技能');
  });

  it('returns resource markup literally for React plain-text rendering', () => {
    const unsafeLookingName = '<img src=x onerror=alert(1)> **告警** [详情](javascript:alert(1))';
    const unsafeLookingResource: CapabilityPresentationResourceMap = new Map([
      [
        'TOOL:UnsafeLookingTool',
        {
          capabilityKind: 'TOOL',
          capabilityId: 'UnsafeLookingTool',
          displayName: unsafeLookingName,
        },
      ],
    ]);

    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'UnsafeLookingTool' }, zh, 'zh-CN', unsafeLookingResource)).toBe(
      unsafeLookingName,
    );
  });

  it('selects English resources while keeping English action templates', () => {
    expect(resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'NetworkElementStatusLookup' }, en, 'en-US', resources)).toBe(
      'Query network element status',
    );
    expect(
      resolveCapabilityProcessTitle({ capabilityKind: 'TOOL', capabilityId: 'Skill', targetCapabilityId: 'alarm-diagnosis' }, en, 'en-US', resources),
    ).toBe('Load skill: Alarm diagnosis');
  });
});

function translation(values: Readonly<Record<string, string>>) {
  return (key: string, options?: Readonly<Record<string, unknown>>): string => {
    const template = values[key] ?? key;
    return template.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
  };
}
