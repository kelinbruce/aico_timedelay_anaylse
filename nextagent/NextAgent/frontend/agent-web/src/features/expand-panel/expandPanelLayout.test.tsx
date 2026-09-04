import { describe, it, expect, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { expandPanelStore } from './ExpandPanelStore.ts';
import { ExpandPanel } from './ExpandPanel.tsx';

describe('ExpandPanel local mode layout', () => {
  beforeEach(() => {
    expandPanelStore.getState().close();
    cleanup();
  });

  it('renders expand panel container with correct structure', () => {
    expandPanelStore.getState().open();
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'Test content' }, 'test');
    render(<ExpandPanel />);
    const container = screen.getByTestId('expand-panel-container');
    expect(container).toBeTruthy();
    expect(container.id).toBe('nextagent-expand-panel-container');
    expect(container.style.width).toBe('100%');
    expect(container.style.flex).toBe('1 1 0%');
    expect(container.style.minHeight).toBe('0px');
    expect(container.style.overflow).toBe('auto');
  });

  it('renders the close button in a fixed 48px top bar', () => {
    expandPanelStore.getState().open();
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'Test' }, 'test');
    render(<ExpandPanel />);
    const closeButton = screen.getByTestId('expand-panel-close-button');
    expect(closeButton).toBeTruthy();
    const topBar = closeButton.parentElement;
    expect(topBar?.style.flex).toBe('0 0 48px');
    expect(topBar?.style.justifyContent).toBe('flex-end');
    expect(topBar?.style.paddingRight).toBe('16px');
  });

  it('does not render close button when contentSource is dsl', () => {
    expandPanelStore.getState().openDsl();
    render(<ExpandPanel />);
    expect(screen.queryByTestId('expand-panel-close-button')).toBeNull();
  });

  it('renders close button when contentSource is react', () => {
    expandPanelStore.getState().open();
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'Test' }, 'test');
    render(<ExpandPanel />);
    expect(screen.getByTestId('expand-panel-close-button')).toBeTruthy();
  });

  it('renders close button when contentSource is view', () => {
    expandPanelStore.getState().open();
    expandPanelStore.getState().setView(<div>view content</div>);
    render(<ExpandPanel />);
    expect(screen.getByTestId('expand-panel-close-button')).toBeTruthy();
  });

  it('renders empty container when content is null (PIU scenario)', () => {
    expandPanelStore.getState().open();
    render(<ExpandPanel />);
    const container = screen.getByTestId('expand-panel-container');
    expect(container.children).toHaveLength(0);
  });

  it('clears container on close', () => {
    expandPanelStore.getState().open();
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'Test' }, 'test');
    const { rerender } = render(<ExpandPanel />);
    const container = screen.getByTestId('expand-panel-container');
    expect(container.children.length).toBeGreaterThan(0);

    expandPanelStore.getState().close();
    rerender(<ExpandPanel />);
    const containerAfterClose = screen.getByTestId('expand-panel-container');
    expect(containerAfterClose.children).toHaveLength(0);
  });

  it('clears React content when switching to PIU mode (content to null)', () => {
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'React content' }, 'test');
    expandPanelStore.getState().open();
    const { rerender } = render(<ExpandPanel />);
    let container = screen.getByTestId('expand-panel-container');
    expect(container.children.length).toBeGreaterThan(0);

    // Simulate PIU takeover: close clears content, then open without content
    expandPanelStore.getState().close();
    expandPanelStore.getState().open();
    rerender(<ExpandPanel />);
    container = screen.getByTestId('expand-panel-container');
    expect(container.children).toHaveLength(0);
  });

  it('clears PIU DOM when switching to React mode (null to content)', () => {
    expandPanelStore.getState().open();
    const { rerender } = render(<ExpandPanel />);
    let container = screen.getByTestId('expand-panel-container');
    // Simulate PIU writing a DOM node
    const piuNode = document.createElement('div');
    piuNode.textContent = 'PIU content';
    container.appendChild(piuNode);
    expect(container.children.length).toBe(1);

    // Stream event sets content
    expandPanelStore.getState().setContent({ toolMessageType: 'TEXT', content: 'React content' }, 'live-stream');
    rerender(<ExpandPanel />);
    container = screen.getByTestId('expand-panel-container');
    // PIU DOM node must be gone, only React content should remain
    expect(container.contains(piuNode)).toBe(false);
    expect(container.children.length).toBeGreaterThan(0);
  });
});
