import type { AICOConfig, Operator, PanelType, PIUInfoItem } from './types.ts';

export interface AICOConfigSnapshot {
  readonly config: AICOConfig | null;
  readonly panelType: PanelType;
  readonly activePanelOperatorData: PIUInfoItem | null;
  readonly activeModalOperator: Operator | null;
}

type Listener = () => void;

const INITIAL_SNAPSHOT: AICOConfigSnapshot = {
  config: null,
  panelType: 'CONVERSATION_PANEL',
  activePanelOperatorData: null,
  activeModalOperator: null,
};

class AICOConfigStore {
  private snapshot: AICOConfigSnapshot = INITIAL_SNAPSHOT;
  private listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): AICOConfigSnapshot => this.snapshot;

  setConfig(config: AICOConfig): void {
    this.snapshot = {
      config,
      panelType: 'CONVERSATION_PANEL',
      activePanelOperatorData: null,
      activeModalOperator: null,
    };
    this.emit();
  }

  updateConfig(config: AICOConfig): void {
    this.snapshot = { ...this.snapshot, config };
    this.emit();
  }

  clearConfig(): void {
    this.snapshot = INITIAL_SNAPSHOT;
    this.emit();
  }

  setPanelType(panelType: PanelType): void {
    this.update({
      panelType,
      activePanelOperatorData: panelType === 'CONVERSATION_PANEL' ? null : this.snapshot.activePanelOperatorData,
    });
  }

  setActivePanelOperator(data: PIUInfoItem | null): void {
    this.update({ activePanelOperatorData: data, panelType: data ? 'CUSTOM_PANEL' : 'CONVERSATION_PANEL' });
  }

  setActiveModalOperator(operator: Operator | null): void {
    this.update({ activeModalOperator: operator });
  }

  private update(patch: Partial<AICOConfigSnapshot>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const aicoConfigStore = new AICOConfigStore();

export function resetAICOConfigStoreForTesting(): void {
  aicoConfigStore.clearConfig();
}
