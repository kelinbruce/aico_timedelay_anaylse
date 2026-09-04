export interface ComposerPanelProps {
  readonly middleContent?: React.ReactNode;
}

/**
 * ComposerPanel — borderless flex container that fills the Main region.
 * middleContent (Welcome or ChatTimeline) is rendered directly with flex layout,
 * no Card wrapper, so it slots seamlessly into the RightPaneLayout body.
 */
export function ComposerPanel({ middleContent }: ComposerPanelProps) {
  return (
    <div data-testid="composer-middle-content" style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
      {middleContent}
    </div>
  );
}
