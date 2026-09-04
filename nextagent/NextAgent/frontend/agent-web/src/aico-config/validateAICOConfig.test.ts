import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { validateAICOConfig } from './validateAICOConfig.ts';
import type { AICOConfig } from './types.ts';

describe('validateAICOConfig', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  describe('invalid top-level inputs', () => {
    it('returns null for null', () => {
      expect(validateAICOConfig(null)).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns null for undefined', () => {
      expect(validateAICOConfig(undefined)).toBeNull();
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('returns null and warns for a string', () => {
      expect(validateAICOConfig('invalid')).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null and warns for a number', () => {
      expect(validateAICOConfig(42)).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });

    it('returns null and warns for an array', () => {
      expect(validateAICOConfig([1, 2, 3])).toBeNull();
      expect(warnSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('empty / partial objects', () => {
    it('returns a valid (empty) config for an empty object', () => {
      const result = validateAICOConfig({});
      expect(result).not.toBeNull();
      expect(result as AICOConfig).toEqual({});
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it('preserves valid string fields', () => {
      const result = validateAICOConfig({ name: '网络助手', welcome: '欢迎' });
      expect(result).toEqual({ name: '网络助手', welcome: '欢迎' });
    });

    it('treats empty strings as absent', () => {
      const result = validateAICOConfig({ name: '  ', welcome: '' });
      expect(result).toEqual({});
    });

    it('silently ignores unknown fields', () => {
      const result = validateAICOConfig({ name: 'A', unknownField: 'x' });
      expect(result).toEqual({ name: 'A' });
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('boolean fields', () => {
    it('preserves clearStorage, showAskTime, showThinkingChain', () => {
      const result = validateAICOConfig({ clearStorage: true, showAskTime: false, showThinkingChain: true });
      expect(result).toEqual({ clearStorage: true, showAskTime: false, showThinkingChain: true });
    });

    it('ignores non-boolean values', () => {
      const result = validateAICOConfig({ clearStorage: 'yes', showAskTime: 1 });
      expect(result).toEqual({});
    });
  });

  describe('declaration', () => {
    it('preserves boolean false', () => {
      expect(validateAICOConfig({ declaration: false })).toEqual({ declaration: false });
    });

    it('preserves boolean true', () => {
      expect(validateAICOConfig({ declaration: true })).toEqual({ declaration: true });
    });

    it('preserves object with title and tips', () => {
      expect(validateAICOConfig({ declaration: { title: 'T', tips: 'S' } })).toEqual({
        declaration: { title: 'T', tips: 'S' },
      });
    });

    it('returns undefined for non-boolean non-object', () => {
      expect(validateAICOConfig({ declaration: 'yes' })).toEqual({});
    });
  });

  describe('modalSize', () => {
    it('preserves valid dimensions', () => {
      expect(validateAICOConfig({ modalSize: { width: 600, height: '400px', minWidth: 500 } })).toEqual({
        modalSize: { width: 600, height: '400px', minWidth: 500 },
      });
    });

    it('returns undefined for non-object modalSize', () => {
      expect(validateAICOConfig({ modalSize: 'big' })).toEqual({});
    });
  });

  describe('operators', () => {
    const validOperator = {
      lightIcon: 'base64-light',
      darkIcon: 'base64-dark',
      enName: 'Action',
      zhName: '操作',
      position: 'OUTER',
      type: 'MODAL',
      data: { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' },
    };

    it('preserves valid operators', () => {
      const result = validateAICOConfig({ operators: [validOperator] });
      expect(result).toEqual({ operators: [validOperator] });
    });

    it('filters out operators with invalid position', () => {
      const result = validateAICOConfig({
        operators: [validOperator, { ...validOperator, position: 'INVALID' }],
      });
      expect(result?.operators).toHaveLength(1);
      expect(warnSpy).toHaveBeenCalled();
    });

    it('filters out operators with missing required fields', () => {
      const result = validateAICOConfig({
        operators: [{ ...validOperator, lightIcon: '' }],
      });
      expect(result?.operators).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('filters out operators with invalid data (PIUInfoItem)', () => {
      const result = validateAICOConfig({
        operators: [{ ...validOperator, data: { piuName: '' } }],
      });
      expect(result?.operators).toBeUndefined();
      expect(warnSpy).toHaveBeenCalled();
    });

    it('returns undefined for non-array operators', () => {
      expect(validateAICOConfig({ operators: 'not-array' })).toEqual({});
    });
  });

  describe('unknown Capability presentation fields', () => {
    it('silently ignores capabilityBusinessNames while preserving other valid AICOConfig fields', () => {
      const result = validateAICOConfig({
        name: '网络助手',
        welcome: '欢迎',
        capabilityBusinessNames: [
          {
            kind: 'SKILL',
            id: 'alarm-diagnosis',
            names: { 'zh-CN': '告警诊断', 'en-US': 'Alarm diagnosis' },
          },
        ],
      });

      expect(result).toEqual({ name: '网络助手', welcome: '欢迎' });
      expect(result).not.toHaveProperty('capabilityBusinessNames');
      expect(warnSpy).not.toHaveBeenCalled();
    });
  });
  describe('PIUInfoItem fields (answerOperator, inputOperator)', () => {
    const validPIU = { piuName: 'widget', piuVersion: '1.0.0', renderFunc: 'render' };

    it('preserves width as number and height as string', () => {
      const result = validateAICOConfig({
        answerOperator: { ...validPIU, width: 600, height: '400px' },
      });
      expect(result?.answerOperator?.width).toBe(600);
      expect(result?.answerOperator?.height).toBe('400px');
    });

    it('preserves width as string and height as number', () => {
      const result = validateAICOConfig({
        answerOperator: { ...validPIU, width: '100%', height: 300 },
      });
      expect(result?.answerOperator?.width).toBe('100%');
      expect(result?.answerOperator?.height).toBe(300);
    });

    it('preserves valid answerOperator', () => {
      expect(validateAICOConfig({ answerOperator: validPIU })).toEqual({ answerOperator: validPIU });
    });

    it('returns null for invalid answerOperator', () => {
      expect(validateAICOConfig({ answerOperator: { piuName: '' } })).toEqual({});
    });

    it('preserves valid inputOperator', () => {
      expect(validateAICOConfig({ inputOperator: validPIU })).toEqual({ inputOperator: validPIU });
    });
  });

  describe('quickInfo', () => {
    const validPIU = { piuName: 'quick', piuVersion: '1.0.0', renderFunc: 'render' };

    it('preserves SELF_DEFINE with valid data', () => {
      expect(validateAICOConfig({ quickInfo: { type: 'SELF_DEFINE', data: validPIU } })).toEqual({
        quickInfo: { type: 'SELF_DEFINE', data: validPIU },
      });
    });

    it('preserves SKILL_LIST without data', () => {
      expect(validateAICOConfig({ quickInfo: { type: 'SKILL_LIST' } })).toEqual({
        quickInfo: { type: 'SKILL_LIST' },
      });
    });

    it('returns undefined for invalid type', () => {
      expect(validateAICOConfig({ quickInfo: { type: 'INVALID' } })).toEqual({});
    });

    it('returns undefined for SELF_DEFINE with missing data', () => {
      expect(validateAICOConfig({ quickInfo: { type: 'SELF_DEFINE', data: { piuName: '' } } })).toEqual({});
    });
  });

  describe('guideInfo', () => {
    const validPIU = { piuName: 'guide', piuVersion: '1.0.0', renderFunc: 'render' };

    it('preserves SELF_DEFINE with valid data', () => {
      expect(validateAICOConfig({ guideInfo: { type: 'SELF_DEFINE', data: validPIU } })).toEqual({
        guideInfo: { type: 'SELF_DEFINE', data: validPIU },
      });
    });

    it('preserves HIGH_FREQUENCY_RECOMMEND', () => {
      expect(validateAICOConfig({ guideInfo: { type: 'HIGH_FREQUENCY_RECOMMEND' } })).toEqual({
        guideInfo: { type: 'HIGH_FREQUENCY_RECOMMEND' },
      });
    });
  });

  describe('layoutConfig', () => {
    it('preserves valid layout config', () => {
      expect(validateAICOConfig({ layoutConfig: { operatorPosition: 'RIGHT', expandPanelPosition: 'LEFT' } })).toEqual({
        layoutConfig: { operatorPosition: 'RIGHT', expandPanelPosition: 'LEFT' },
      });
    });

    it('filters out invalid enum values', () => {
      expect(validateAICOConfig({ layoutConfig: { operatorPosition: 'TOP' } })).toEqual({});
    });
  });

  describe('entranceStyle', () => {
    it('preserves valid string and number values', () => {
      expect(validateAICOConfig({ entranceStyle: { right: 16, bottom: '20px', borderRadius: 8 } })).toEqual({
        entranceStyle: { right: 16, bottom: '20px', borderRadius: 8 },
      });
    });

    it('filters out non-string non-number values', () => {
      expect(validateAICOConfig({ entranceStyle: { right: 16, invalid: true, alsoInvalid: null } })).toEqual({ entranceStyle: { right: 16 } });
    });

    it('returns undefined for non-object entranceStyle', () => {
      expect(validateAICOConfig({ entranceStyle: 'big' })).toEqual({});
    });

    it('returns undefined for an empty object', () => {
      expect(validateAICOConfig({ entranceStyle: {} })).toEqual({});
    });
  });

  describe('panelPosition', () => {
    it('preserves valid string and number values', () => {
      expect(validateAICOConfig({ panelPosition: { top: 0, bottom: 0, left: 56 } })).toEqual({
        panelPosition: { top: 0, bottom: 0, left: 56 },
      });
    });

    it('filters out non-string non-number values', () => {
      expect(validateAICOConfig({ panelPosition: { top: 0, invalid: true, alsoInvalid: null } })).toEqual({
        panelPosition: { top: 0 },
      });
    });

    it('returns undefined for non-object panelPosition', () => {
      expect(validateAICOConfig({ panelPosition: 'fixed' })).toEqual({});
    });

    it('returns undefined for an empty object', () => {
      expect(validateAICOConfig({ panelPosition: {} })).toEqual({});
    });
  });

  describe('closeBehavior', () => {
    it('preserves valid hide value', () => {
      expect(validateAICOConfig({ closeBehavior: 'hide' })).toEqual({ closeBehavior: 'hide' });
    });

    it('preserves valid minimize value', () => {
      expect(validateAICOConfig({ closeBehavior: 'minimize' })).toEqual({ closeBehavior: 'minimize' });
    });

    it('filters out invalid enum values', () => {
      expect(validateAICOConfig({ closeBehavior: 'close' })).toEqual({});
    });
  });

  describe('initialDisplayState', () => {
    it('preserves valid boolean values', () => {
      expect(validateAICOConfig({ initialDisplayState: { showEntrance: false, showPanel: true, minimized: true } })).toEqual({
        initialDisplayState: { showEntrance: false, showPanel: true, minimized: true },
      });
    });

    it('filters out non-boolean values', () => {
      expect(validateAICOConfig({ initialDisplayState: { showPanel: true, invalid: 'yes', alsoInvalid: 1 } })).toEqual({
        initialDisplayState: { showPanel: true },
      });
    });

    it('returns undefined for non-object initialDisplayState', () => {
      expect(validateAICOConfig({ initialDisplayState: 'auto' })).toEqual({});
    });

    it('returns undefined for an empty object', () => {
      expect(validateAICOConfig({ initialDisplayState: {} })).toEqual({});
    });
  });

  describe('controls', () => {
    it('preserves valid boolean values', () => {
      expect(validateAICOConfig({ controls: { close: false, maximize: false, dockFloat: false, drag: false, resize: false } })).toEqual({
        controls: { close: false, maximize: false, dockFloat: false, drag: false, resize: false },
      });
    });

    it('filters out non-boolean values', () => {
      expect(validateAICOConfig({ controls: { close: false, maximize: 'yes', resize: 1 } })).toEqual({
        controls: { close: false },
      });
    });

    it('returns undefined for non-object controls', () => {
      expect(validateAICOConfig({ controls: 'none' })).toEqual({});
    });

    it('returns undefined for an empty object', () => {
      expect(validateAICOConfig({ controls: {} })).toEqual({});
    });
  });

  describe('minimizedStyle', () => {
    it('preserves valid string and number values', () => {
      expect(validateAICOConfig({ minimizedStyle: { left: 56, right: 'auto', bottom: 16, width: 320, borderRadius: 8 } })).toEqual({
        minimizedStyle: { left: 56, right: 'auto', bottom: 16, width: 320, borderRadius: 8 },
      });
    });

    it('filters out non-string non-number values', () => {
      expect(validateAICOConfig({ minimizedStyle: { left: 56, invalid: true, alsoInvalid: null } })).toEqual({
        minimizedStyle: { left: 56 },
      });
    });

    it('returns undefined for non-object minimizedStyle', () => {
      expect(validateAICOConfig({ minimizedStyle: 'fixed' })).toEqual({});
    });

    it('returns undefined for an empty object', () => {
      expect(validateAICOConfig({ minimizedStyle: {} })).toEqual({});
    });
  });
});
