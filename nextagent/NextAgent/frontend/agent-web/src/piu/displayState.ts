export interface AIAgentDisplayState {
  readonly showEntrance: boolean;
  readonly showPanel: boolean;
  readonly minimized: boolean;
}

export const defaultDisplayState: AIAgentDisplayState = {
  showEntrance: true,
  showPanel: false,
  minimized: false,
};

export function normalizeDisplayState(display: Partial<AIAgentDisplayState>): AIAgentDisplayState {
  const merged = { ...defaultDisplayState, ...display };
  if (merged.minimized && !merged.showPanel) {
    return { ...merged, minimized: false };
  }
  return merged;
}

export function closePanel(display: Partial<AIAgentDisplayState>): AIAgentDisplayState {
  return normalizeDisplayState({ ...display, showPanel: false });
}

export function openPanel(display: Partial<AIAgentDisplayState>): AIAgentDisplayState {
  return normalizeDisplayState({ ...display, showEntrance: true, showPanel: true });
}
