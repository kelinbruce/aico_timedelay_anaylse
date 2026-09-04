export interface ModalSize {
  readonly width?: number | string;
  readonly height?: number | string;
  readonly minWidth?: number | string;
}

export interface PIUInfoItem {
  readonly piuName: string;
  readonly piuVersion: string;
  readonly renderFunc: string;
  readonly data?: Readonly<Record<string, unknown>> | readonly unknown[];
  readonly width?: number | string;
  readonly height?: number | string;
}

export type QuickType = 'SKILL_LIST' | 'SELF_DEFINE' | 'CATEGORY_RECOMMEND';

export type OperatorPosition = 'OUTER' | 'INNER';

export type OperatorType = 'PANEL' | 'MODAL';

export type ExpandPanelPosition = 'LEFT' | 'RIGHT';

export type ToolBarPosition = 'LEFT' | 'RIGHT';

export interface Operator {
  readonly lightIcon: string;
  readonly darkIcon: string;
  readonly enName: string;
  readonly zhName: string;
  readonly position: OperatorPosition;
  readonly type: OperatorType;
  readonly data: PIUInfoItem;
  readonly isCenter?: boolean;
}

export type GuideAreaType = 'HIGH_FREQUENCY_RECOMMEND' | 'SELF_DEFINE';

export type CloseBehavior = 'hide' | 'minimize';

export interface PanelPosition {
  readonly top?: number | string;
  readonly bottom?: number | string;
  readonly left?: number | string;
  readonly right?: number | string;
}

export interface AICOConfig {
  readonly containerId?: string;
  readonly icon?: string;
  readonly activeIcon?: string;
  readonly entranceIcon?: string;
  readonly entranceStyle?: Readonly<Record<string, string | number>>;
  readonly guideIcon?: string;
  readonly name?: string;
  readonly welcome?: string;
  readonly modalSize?: ModalSize;
  readonly clearStorage?: boolean;
  readonly declaration?: boolean | { readonly title: string; readonly tips: string };
  readonly showAskTime?: boolean;
  readonly showThinkingChain?: boolean;
  readonly operators?: readonly Operator[];
  readonly answerOperator?: PIUInfoItem;
  readonly quickInfo?: { readonly type: QuickType; readonly data?: PIUInfoItem };
  readonly inputOperator?: PIUInfoItem;
  readonly layoutConfig?: {
    readonly expandPanelPosition?: ExpandPanelPosition;
    readonly operatorPosition?: ToolBarPosition;
  };
  readonly guideInfo?: { readonly type: GuideAreaType; readonly data?: PIUInfoItem };
  readonly panelPosition?: PanelPosition;
  readonly closeBehavior?: CloseBehavior;
  readonly initialDisplayState?: { readonly showEntrance?: boolean; readonly showPanel?: boolean; readonly minimized?: boolean };
  readonly controls?: {
    readonly close?: boolean;
    readonly maximize?: boolean;
    readonly dockFloat?: boolean;
    readonly drag?: boolean;
    readonly resize?: boolean;
  };
  readonly minimizedStyle?: Readonly<Record<string, string | number>>;
}

export type PanelType = 'CONVERSATION_PANEL' | 'CUSTOM_PANEL';
