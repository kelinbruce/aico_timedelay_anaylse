import {
  type AICOConfig,
  type ExpandPanelPosition,
  type GuideAreaType,
  type ModalSize,
  type Operator,
  type OperatorPosition,
  type OperatorType,
  type CloseBehavior,
  type PanelPosition,
  type PIUInfoItem,
  type QuickType,
  type ToolBarPosition,
} from './types.ts';
import { reportWarning } from '../utils/diagnostics.ts';

const VALID_QUICK_TYPES: readonly QuickType[] = ['SKILL_LIST', 'SELF_DEFINE', 'CATEGORY_RECOMMEND'];
const VALID_OPERATOR_POSITIONS: readonly OperatorPosition[] = ['OUTER', 'INNER'];
const VALID_OPERATOR_TYPES: readonly OperatorType[] = ['PANEL', 'MODAL'];
const VALID_EXPAND_PANEL_POSITIONS: readonly ExpandPanelPosition[] = ['LEFT', 'RIGHT'];
const VALID_TOOLBAR_POSITIONS: readonly ToolBarPosition[] = ['LEFT', 'RIGHT'];
const VALID_GUIDE_AREA_TYPES: readonly GuideAreaType[] = ['HIGH_FREQUENCY_RECOMMEND', 'SELF_DEFINE'];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateModalSize(raw: unknown): ModalSize | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const result: { width?: number | string; height?: number | string; minWidth?: number | string } = {};
  for (const key of ['width', 'height', 'minWidth'] as const) {
    const val = raw[key];
    if (typeof val === 'number' || typeof val === 'string') {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateEntranceStyle(raw: unknown): Readonly<Record<string, string | number>> | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const result: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'string' || typeof val === 'number') {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validatePIUInfoItem(raw: unknown): PIUInfoItem | null {
  if (!isObject(raw)) {
    return null;
  }
  const piuName = typeof raw.piuName === 'string' ? raw.piuName.trim() : '';
  const piuVersion = typeof raw.piuVersion === 'string' ? raw.piuVersion.trim() : '';
  const renderFunc = typeof raw.renderFunc === 'string' ? raw.renderFunc.trim() : '';
  if (piuName.length === 0 || piuVersion.length === 0 || renderFunc.length === 0) {
    return null;
  }
  const result: PIUInfoItem = {
    piuName,
    piuVersion,
    renderFunc,
    ...(typeof raw.data === 'object' && raw.data !== null && !Array.isArray(raw.data) ? { data: raw.data as Record<string, unknown> } : {}),
    ...validateOptionalDimension('width', raw.width),
    ...validateOptionalDimension('height', raw.height),
  };
  return result;
}

function validateOptionalDimension(
  key: 'width' | 'height',
  val: unknown,
): { width?: number | string } | { height?: number | string } | Record<string, never> {
  if (typeof val === 'number' || typeof val === 'string') {
    return { [key]: val } as { width?: number | string } | { height?: number | string };
  }
  return {};
}

function validateEnum<T extends string>(value: unknown, validValues: readonly T[]): T | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return (validValues as readonly string[]).includes(value) ? (value as T) : undefined;
}

function validateOperator(raw: unknown): Operator | null {
  if (!isObject(raw)) {
    return null;
  }
  const lightIcon = typeof raw.lightIcon === 'string' ? raw.lightIcon.trim() : '';
  const darkIcon = typeof raw.darkIcon === 'string' ? raw.darkIcon.trim() : '';
  const enName = typeof raw.enName === 'string' ? raw.enName.trim() : '';
  const zhName = typeof raw.zhName === 'string' ? raw.zhName.trim() : '';
  if (lightIcon.length === 0 || darkIcon.length === 0 || enName.length === 0 || zhName.length === 0) {
    reportWarning('[AICOConfig] Operator filtered: missing required string fields.');
    return null;
  }
  const position = validateEnum(raw.position, VALID_OPERATOR_POSITIONS);
  const type = validateEnum(raw.type, VALID_OPERATOR_TYPES);
  if (position === undefined || type === undefined) {
    reportWarning('[AICOConfig] Operator filtered: invalid position or type enum.');
    return null;
  }
  const data = validatePIUInfoItem(raw.data);
  if (data === null) {
    reportWarning('[AICOConfig] Operator filtered: invalid data (PIUInfoItem).');
    return null;
  }
  return { lightIcon, darkIcon, enName, zhName, position, type, data, ...(isBoolean(raw.isCenter) ? { isCenter: raw.isCenter } : {}) };
}

function validateOperators(raw: unknown): readonly Operator[] | undefined {
  if (!Array.isArray(raw)) {
    return undefined;
  }
  const validOperators: Operator[] = [];
  for (const item of raw) {
    const operator = validateOperator(item);
    if (operator) {
      validOperators.push(operator);
    }
  }
  return validOperators;
}

function validateDeclaration(raw: unknown): AICOConfig['declaration'] {
  if (isBoolean(raw)) {
    return raw;
  }
  if (isObject(raw)) {
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const tips = typeof raw.tips === 'string' ? raw.tips.trim() : '';
    if (title.length > 0 || tips.length > 0) {
      return { title: title.length > 0 ? title : '', tips: tips.length > 0 ? tips : '' };
    }
  }
  return undefined;
}

function validateQuickInfo(raw: unknown): AICOConfig['quickInfo'] {
  if (!isObject(raw)) {
    return undefined;
  }
  const type = validateEnum(raw.type, VALID_QUICK_TYPES);
  if (type === undefined) {
    return undefined;
  }
  const data = type === 'SELF_DEFINE' ? validatePIUInfoItem(raw.data) : undefined;
  if (type === 'SELF_DEFINE' && data === null) {
    return undefined;
  }
  return data ? { type, data } : { type };
}

function validateGuideInfo(raw: unknown): AICOConfig['guideInfo'] {
  if (!isObject(raw)) {
    return undefined;
  }
  const type = validateEnum(raw.type, VALID_GUIDE_AREA_TYPES);
  if (type === undefined) {
    return undefined;
  }
  const data = type === 'SELF_DEFINE' ? validatePIUInfoItem(raw.data) : undefined;
  if (type === 'SELF_DEFINE' && data === null) {
    return undefined;
  }
  return data ? { type, data } : { type };
}

const VALID_CLOSE_BEHAVIORS: readonly CloseBehavior[] = ['hide', 'minimize'];

function validatePanelPosition(raw: unknown): PanelPosition | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const result: { top?: number | string; bottom?: number | string; left?: number | string; right?: number | string } = {};
  for (const key of ['top', 'bottom', 'left', 'right'] as const) {
    const val = raw[key];
    if (typeof val === 'number' || typeof val === 'string') {
      result[key] = val;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateCloseBehavior(raw: unknown): CloseBehavior | undefined {
  return validateEnum(raw, VALID_CLOSE_BEHAVIORS);
}

function validateInitialDisplayState(raw: unknown): { showEntrance?: boolean; showPanel?: boolean; minimized?: boolean } | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const result: { showEntrance?: boolean; showPanel?: boolean; minimized?: boolean } = {};
  for (const key of ['showEntrance', 'showPanel', 'minimized'] as const) {
    if (isBoolean(raw[key])) {
      result[key] = raw[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateControls(raw: unknown): NonNullable<AICOConfig['controls']> | undefined {
  if (!isObject(raw)) {
    return undefined;
  }
  const result: { close?: boolean; maximize?: boolean; dockFloat?: boolean; drag?: boolean; resize?: boolean } = {};
  for (const key of ['close', 'maximize', 'dockFloat', 'drag', 'resize'] as const) {
    if (isBoolean(raw[key])) {
      result[key] = raw[key];
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function validateMinimizedStyle(raw: unknown): Readonly<Record<string, string | number>> | undefined {
  return validateEntranceStyle(raw);
}

function validateLayoutConfig(raw: unknown): AICOConfig['layoutConfig'] {
  if (!isObject(raw)) {
    return undefined;
  }
  const expandPanelPosition = validateEnum(raw.expandPanelPosition, VALID_EXPAND_PANEL_POSITIONS);
  const operatorPosition = validateEnum(raw.operatorPosition, VALID_TOOLBAR_POSITIONS);
  const result: NonNullable<AICOConfig['layoutConfig']> = {};
  if (expandPanelPosition !== undefined) {
    (result as { expandPanelPosition?: ExpandPanelPosition }).expandPanelPosition = expandPanelPosition;
  }
  if (operatorPosition !== undefined) {
    (result as { operatorPosition?: ToolBarPosition }).operatorPosition = operatorPosition;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

export function validateAICOConfig(raw: unknown): AICOConfig | null {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (!isObject(raw)) {
    reportWarning(`[AICOConfig] Invalid AICOConfig: expected an object, got ${typeof raw}.`);
    return null;
  }

  const config: {
    containerId?: string;
    icon?: string;
    activeIcon?: string;
    entranceIcon?: string;
    entranceStyle?: Readonly<Record<string, string | number>>;
    guideIcon?: string;
    name?: string;
    welcome?: string;
    modalSize?: ModalSize;
    clearStorage?: boolean;
    declaration?: boolean | { title: string; tips: string };
    showAskTime?: boolean;
    showThinkingChain?: boolean;
    operators?: readonly Operator[];
    answerOperator?: PIUInfoItem;
    quickInfo?: { type: QuickType; data?: PIUInfoItem };
    inputOperator?: PIUInfoItem;
    layoutConfig?: { expandPanelPosition?: ExpandPanelPosition; operatorPosition?: ToolBarPosition };
    guideInfo?: { type: GuideAreaType; data?: PIUInfoItem };
    panelPosition?: PanelPosition;
    closeBehavior?: CloseBehavior;
    initialDisplayState?: { showEntrance?: boolean; showPanel?: boolean; minimized?: boolean };
    controls?: { close?: boolean; maximize?: boolean; dockFloat?: boolean; drag?: boolean; resize?: boolean };
    minimizedStyle?: Readonly<Record<string, string | number>>;
  } = {};

  if (isNonEmptyString(raw.containerId)) {
    config.containerId = raw.containerId.trim();
  }
  for (const iconField of ['icon', 'activeIcon', 'entranceIcon', 'guideIcon', 'name', 'welcome'] as const) {
    if (isNonEmptyString(raw[iconField])) {
      config[iconField] = (raw[iconField] as string).trim();
    }
  }
  const entranceStyle = validateEntranceStyle(raw.entranceStyle);
  if (entranceStyle !== undefined) {
    config.entranceStyle = entranceStyle;
  }
  const modalSize = validateModalSize(raw.modalSize);
  if (modalSize !== undefined) {
    config.modalSize = modalSize;
  }
  if (isBoolean(raw.clearStorage)) {
    config.clearStorage = raw.clearStorage;
  }
  const declaration = validateDeclaration(raw.declaration);
  if (declaration !== undefined) {
    config.declaration = declaration;
  }
  if (isBoolean(raw.showAskTime)) {
    config.showAskTime = raw.showAskTime;
  }
  if (isBoolean(raw.showThinkingChain)) {
    config.showThinkingChain = raw.showThinkingChain;
  }
  const operators = validateOperators(raw.operators);
  if (operators !== undefined && operators.length > 0) {
    config.operators = operators;
  }
  const answerOperator = validatePIUInfoItem(raw.answerOperator);
  if (answerOperator !== null) {
    config.answerOperator = answerOperator;
  }
  const quickInfo = validateQuickInfo(raw.quickInfo);
  if (quickInfo !== undefined) {
    config.quickInfo = quickInfo;
  }
  const inputOperator = validatePIUInfoItem(raw.inputOperator);
  if (inputOperator !== null) {
    config.inputOperator = inputOperator;
  }
  const layoutConfig = validateLayoutConfig(raw.layoutConfig);
  if (layoutConfig !== undefined) {
    config.layoutConfig = layoutConfig;
  }
  const guideInfo = validateGuideInfo(raw.guideInfo);
  if (guideInfo !== undefined) {
    config.guideInfo = guideInfo;
  }
  const panelPosition = validatePanelPosition(raw.panelPosition);
  if (panelPosition !== undefined) {
    config.panelPosition = panelPosition;
  }
  const closeBehavior = validateCloseBehavior(raw.closeBehavior);
  if (closeBehavior !== undefined) {
    config.closeBehavior = closeBehavior;
  }
  const initialDisplayState = validateInitialDisplayState(raw.initialDisplayState);
  if (initialDisplayState !== undefined) {
    config.initialDisplayState = initialDisplayState;
  }
  const controls = validateControls(raw.controls);
  if (controls !== undefined) {
    config.controls = controls;
  }
  const minimizedStyle = validateMinimizedStyle(raw.minimizedStyle);
  if (minimizedStyle !== undefined) {
    config.minimizedStyle = minimizedStyle;
  }
  return config as AICOConfig;
}
