// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunGraphViewState } from '../src/features/run-graph/types.ts';

let X6FlowDiagram: any;

const graphMockState = new Proxy({} as any, {
  get(_target, property) {
    return (globalThis as any).__nextAgentG6MockState[property];
  },
});

function installG6Mock(): void {
  vi.doMock('@antv/g6', () => {
    function mockFn<T extends (...args: any[]) => any>(
      implementation?: T,
    ): T & {
      mock: { calls: unknown[][] };
      mockClear: () => void;
      mockReturnValue: (value: unknown) => void;
    } {
      let currentImplementation = implementation;
      const fn = function (this: unknown, ...args: unknown[]) {
        fn.mock.calls.push(args);
        return currentImplementation?.apply(this, args);
      } as T & {
        mock: { calls: unknown[][] };
        mockClear: () => void;
        mockReturnValue: (value: unknown) => void;
        _isMockFunction: boolean;
        getMockName: () => string;
      };
      fn.mock = { calls: [] };
      fn.mockClear = () => {
        fn.mock.calls = [];
      };
      fn.mockReturnValue = (value: unknown) => {
        currentImplementation = (() => value) as T;
      };
      fn._isMockFunction = true;
      fn.getMockName = () => 'mockFn';
      return fn;
    }
    const state: { instances: any[] } = { instances: [] };
    class HoistedMockGraph {
      readonly options: Record<string, unknown>;
      readonly data = mockFn((data: unknown) => {
        this.graphData = data;
        return this;
      });
      readonly render = mockFn(() => {
        this.emit('afterrender');
        return this;
      });
      readonly changeData = mockFn((data: unknown) => {
        this.graphData = data;
        this.emit('afterrender');
        return this;
      });
      readonly destroy = mockFn();
      readonly fitView = mockFn();
      readonly fitCenter = mockFn();
      readonly zoomTo = mockFn();
      readonly changeSize = mockFn();
      readonly getZoom = mockFn(() => 1);
      readonly on = mockFn((eventName: string, callback: () => void) => {
        const callbacks = this.listeners.get(eventName) ?? new Set<() => void>();
        callbacks.add(callback);
        this.listeners.set(eventName, callbacks);
        return this;
      });
      readonly off = mockFn((eventName: string, callback: () => void) => {
        this.listeners.get(eventName)?.delete(callback);
        return this;
      });
      readonly resize = mockFn(() => {
        this.emit('viewportchange');
        return this;
      });
      readonly translate = mockFn((dx: number, dy: number) => {
        this.translation = { tx: this.translation.tx + dx, ty: this.translation.ty + dy };
        return this;
      });
      graphData: unknown = null;
      private translation = { tx: 0, ty: 0 };
      private readonly listeners = new Map<string, Set<() => void>>();

      constructor(options: Record<string, unknown>) {
        this.options = options;
        state.instances.push(this);
      }

      private emit(eventName: string): void {
        this.listeners.get(eventName)?.forEach((callback) => callback());
      }
    }
    const mockState = { state, MockGraph: HoistedMockGraph, registerNode: mockFn() };
    (globalThis as any).__nextAgentG6MockState = mockState;
    return {
      Graph: HoistedMockGraph,
      registerNode: mockState.registerNode,
    };
  });
}

beforeAll(async () => {
  installG6Mock();
  await import('@antv/g6');
  ({ X6FlowDiagram } = await import('../src/features/run-graph/X6FlowDiagram.tsx'));
});

function setElementSize(element: HTMLElement, width: number, height: number): void {
  Object.defineProperty(element, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(element, 'clientHeight', { configurable: true, value: height });
  element.getBoundingClientRect = vi.fn(() => ({
    x: 0,
    y: 0,
    width,
    height,
    top: 0,
    right: width,
    bottom: height,
    left: 0,
    toJSON: () => ({}),
  }));
}

function viewState(runKey: string, status: 'running' | 'success' = 'running'): RunGraphViewState {
  return {
    runKey,
    sessionId: 'session-1',
    runId: 'run-1',
    requestId: 'request-1',
    rootMessageId: 'root-1',
    requestContextId: 'context-1',
    status,
    statusLabel: status === 'running' ? 'Running' : 'Completed',
    summary: {
      eventCount: 2,
      nodeCount: 2,
      capabilityCount: 1,
      failedCapabilityCount: 0,
      startedAt: '2026-04-20T12:00:00.000Z',
      updatedAt: '2026-04-20T12:00:01.000Z',
    },
    nodes: [
      {
        id: 'request',
        x6NodeId: 'node-request',
        kind: 'request',
        phaseLabel: 'Web Channel',
        title: 'Request accepted',
        status: 'success',
        statusLabel: 'Completed',
        eventLabel: 'REQUEST_ACCEPTED · seq 1',
        metricLabel: '1 backend events',
        summary: 'accepted',
        detailLines: ['accepted'],
        startedAt: '2026-04-20T12:00:00.000Z',
        updatedAt: '2026-04-20T12:00:00.000Z',
        relatedEventIds: ['evt-1'],
        relatedToolCallIds: [],
        references: [],
      },
      {
        id: 'capability:tool-1',
        x6NodeId: 'node-tool-1',
        kind: 'capability',
        phaseLabel: 'Capability SPI',
        title: 'diagnose',
        status,
        statusLabel: status === 'running' ? 'Running' : 'Completed',
        eventLabel: 'CAPABILITY_STARTED · seq 2',
        metricLabel: 'toolCallId: tool-1',
        summary: 'Capability started.',
        detailLines: ['Capability started.'],
        startedAt: '2026-04-20T12:00:01.000Z',
        updatedAt: '2026-04-20T12:00:01.000Z',
        relatedEventIds: ['evt-2'],
        relatedToolCallIds: ['tool-1'],
        references: [],
      },
    ],
    edges: [
      {
        id: 'edge:request:capability',
        x6EdgeId: 'edge-1',
        source: 'node-request',
        target: 'node-tool-1',
        label: null,
        status: 'success',
      },
    ],
    activities: [],
    latestNodeId: 'capability:tool-1',
    latestRunningNodeId: status === 'running' ? 'capability:tool-1' : null,
    rawEvents: [],
  };
}

describe('X6FlowDiagram', () => {
  beforeEach(() => {
    graphMockState.state.instances = [];
    graphMockState.registerNode.mockClear();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it('initializes G6 once, updates cells from view state, and destroys on unmount', async () => {
    const { rerender, unmount } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    expect(graph.data).toHaveBeenCalledTimes(1);
    expect(graph.render).toHaveBeenCalledTimes(1);
    expect(graph.fitView).toHaveBeenCalledTimes(1);
    expect(graph.options.container).toBe(document.querySelector('[data-testid="turn-run-graph-x6-canvas"]'));
    expect(graph.options.modes.default[0]).toMatchObject({ type: 'zoom-canvas', minZoom: 0.6, maxZoom: 1.35 });

    rerender(
      <X6FlowDiagram viewState={viewState('run-2', 'success')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    expect(graphMockState.state.instances).toHaveLength(1);
    expect(graph.changeData).toHaveBeenCalledTimes(1);
    expect(graph.fitView).toHaveBeenCalledTimes(1);

    unmount();
    expect(graph.destroy).toHaveBeenCalledTimes(1);
  });

  it('handles viewport changes and fit/reset signals without reinitializing', async () => {
    const { getByTestId, rerender } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    expect(graph.on).toHaveBeenCalledWith('afterrender', expect.any(Function));
    expect(graph.on).toHaveBeenCalledWith('viewportchange', expect.any(Function));
    setElementSize(viewport, 420, 360);
    act(() => {
      graph.resize(420, 360);
    });
    expect(graph.fitView).toHaveBeenCalledTimes(2);
    setElementSize(viewport, 620, 360);
    act(() => {
      graph.resize(620, 360);
    });
    expect(graph.fitView).toHaveBeenCalledTimes(2);

    rerender(<X6FlowDiagram viewState={viewState('run-1')} fitSignal={1} resetSignal={1} loadingLabel="Loading graph" errorLabel="Graph error" />);

    expect(graphMockState.state.instances).toHaveLength(1);
    expect(graph.fitView).toHaveBeenCalled();
    expect(graph.zoomTo).toHaveBeenCalledWith(1);
  });

  it('pans the graph with mouse drag gestures', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 420, 360);

    fireEvent.pointerDown(viewport, { button: 0, clientX: 150, clientY: 98, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 120, clientY: 80, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(graph.translate).toHaveBeenCalledWith(-30, -18);
    expect(viewport.className).not.toContain('turn-run-graph-viewport--dragging');
  });

  it('allows a fitted graph smaller than the viewport to pan within visible edge bounds', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 760, 520);
    graph.translate(206, 89);
    graph.translate.mockClear();

    fireEvent.pointerDown(viewport, { button: 0, clientX: 380, clientY: 260, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -120, clientY: -240, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(graph.translate).toHaveBeenLastCalledWith(-162, -240);
  });

  it('keeps a dragged graph visible inside the canvas bounds', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 420, 360);
    act(() => {
      graph.resize(420, 360);
    });

    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 510, clientY: 510, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(graph.translate).toHaveBeenCalledWith(500, 390);

    fireEvent.pointerDown(viewport, { button: 0, clientX: 510, clientY: 510, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: -1490, clientY: -1490, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    expect(graph.translate).toHaveBeenLastCalledWith(-662, -630);
  });

  it('recomputes the pan range when the canvas becomes narrower', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram
        viewState={viewState('run-1')}
        fitSignal={0}
        resetSignal={0}
        loadingLabel="Loading graph"
        errorLabel="Graph error"
        selectedNodeId="capability:tool-1"
      />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 620, 360);
    act(() => {
      graph.resize(620, 360);
    });

    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1010, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(graph.translate).toHaveBeenLastCalledWith(726, 0);

    setElementSize(viewport, 420, 360);
    act(() => {
      graph.resize(420, 360);
    });

    expect(graph.translate).toHaveBeenLastCalledWith(-200, 0);
  });

  it('uses stable local content bounds instead of transformed content bbox for pan limits', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 420, 360);
    fireEvent.pointerDown(viewport, { button: 0, clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: 1010, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    expect(graph.translate).toHaveBeenLastCalledWith(526, 0);
  });

  it('keeps a small edge guard visible when a long graph is zoomed in', async () => {
    const { getByTestId } = render(
      <X6FlowDiagram viewState={viewState('run-1')} fitSignal={0} resetSignal={0} loadingLabel="Loading graph" errorLabel="Graph error" />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 420, 360);
    graph.getZoom.mockReturnValue(1.35);

    fireEvent.pointerDown(viewport, { button: 0, clientX: 200, clientY: 320, pointerId: 1 });
    fireEvent.pointerMove(window, { clientX: -2200, clientY: -2200, pointerId: 1 });
    fireEvent.pointerUp(window, { pointerId: 1 });

    const [tx, ty] = graph.translate.mock.calls.at(-1) ?? [];
    expect(typeof tx).toBe('number');
    expect(typeof ty).toBe('number');
    expect(tx).toBeCloseTo(-227.1, 5);
    expect(ty).toBeCloseTo(-332.4, 5);

    fireEvent.pointerDown(viewport, { button: 0, clientX: 200, clientY: 200, pointerId: 2 });
    fireEvent.pointerMove(window, { clientX: 2600, clientY: 2600, pointerId: 2 });
    fireEvent.pointerUp(window, { pointerId: 2 });

    const [maxTx, maxTy] = graph.translate.mock.calls.at(-1) ?? [];
    expect(typeof maxTx).toBe('number');
    expect(typeof maxTy).toBe('number');
    expect(maxTx).toBeCloseTo(798.6, 5);
    expect(maxTy).toBeCloseTo(741.3, 5);
  });

  it('selects a clicked node but treats node dragging as canvas panning', async () => {
    const onNodeSelect = vi.fn();
    const { getByTestId } = render(
      <X6FlowDiagram
        viewState={viewState('run-1')}
        fitSignal={0}
        resetSignal={0}
        loadingLabel="Loading graph"
        errorLabel="Graph error"
        onNodeSelect={onNodeSelect}
      />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const viewport = getByTestId('turn-run-graph-viewport');
    setElementSize(viewport, 420, 360);
    const nodeElement = document.createElement('div');
    nodeElement.dataset.runGraphNodeId = 'capability:tool-1';
    viewport.append(nodeElement);

    fireEvent.pointerDown(nodeElement, { button: 0, clientX: 100, clientY: 100, pointerId: 3 });
    fireEvent.pointerUp(window, { pointerId: 3 });
    expect(onNodeSelect).toHaveBeenCalledWith('capability:tool-1');

    onNodeSelect.mockClear();
    fireEvent.pointerDown(nodeElement, { button: 0, clientX: 100, clientY: 100, pointerId: 4 });
    fireEvent.pointerMove(window, { clientX: 80, clientY: 92, pointerId: 4 });
    fireEvent.pointerUp(window, { pointerId: 4 });

    expect(graph.translate).toHaveBeenLastCalledWith(-20, -8);
    expect(onNodeSelect).not.toHaveBeenCalled();
  });

  it('suppresses running motion class when reduced motion is preferred', async () => {
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: query.includes('prefers-reduced-motion'),
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });

    render(
      <X6FlowDiagram
        viewState={viewState('run-1')}
        fitSignal={0}
        resetSignal={0}
        loadingLabel="Loading graph"
        errorLabel="Graph error"
        selectedNodeId="capability:tool-1"
      />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const graphJson = graph.graphData as { nodes: Array<{ isRunning: boolean; isActive: boolean }> };
    expect(graphJson.nodes[1]?.isRunning).toBe(false);
    expect(graphJson.nodes[1]?.isActive).toBe(false);
  });

  it('marks the latest non-terminal event node active separately from running status', async () => {
    const baseState = viewState('run-active');
    const activeCompletedCapabilityState: RunGraphViewState = {
      ...baseState,
      nodes: baseState.nodes.map((node) =>
        node.id === 'capability:tool-1' ? { ...node, status: 'success', statusLabel: 'Completed', summary: 'Capability completed.' } : node,
      ),
      latestNodeId: 'capability:tool-1',
      latestRunningNodeId: null,
    };

    render(
      <X6FlowDiagram
        viewState={activeCompletedCapabilityState}
        fitSignal={0}
        resetSignal={0}
        loadingLabel="Loading graph"
        errorLabel="Graph error"
        selectedNodeId="capability:tool-1"
      />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const graphJson = graph.graphData as { nodes: Array<{ isRunning: boolean; isActive: boolean }> };
    expect(graphJson.nodes[1]?.isRunning).toBe(false);
    expect(graphJson.nodes[1]?.isActive).toBe(true);
  });

  it('renders backend phase, event metadata, and metric text through contained HTML node data', async () => {
    render(
      <X6FlowDiagram
        viewState={viewState('run-1')}
        fitSignal={0}
        resetSignal={0}
        loadingLabel="Loading graph"
        errorLabel="Graph error"
        selectedNodeId="capability:tool-1"
      />,
    );

    await waitFor(() => expect(graphMockState.state.instances).toHaveLength(1));
    const graph = graphMockState.state.instances[0]!;
    const graphJson = graph.graphData as {
      nodes: Array<{
        type: string;
        phase: string;
        title: string;
        eventLabel: string;
        metricLabel: string;
        statusLabel: string;
        phaseColor: string;
        nodeId: string;
        isActive: boolean;
        isSelected: boolean;
      }>;
    };

    expect(graphJson.nodes[1]?.type).toBe('turn-run-graph-node');
    expect(graphJson.nodes[1]?.nodeId).toBe('capability:tool-1');
    expect(graphJson.nodes[1]?.isActive).toBe(true);
    expect(graphJson.nodes[1]?.isSelected).toBe(true);
    expect(graphJson.nodes[1]?.phase).toBe('Capability SPI');
    expect(graphJson.nodes[1]?.title).toBe('diagnose');
    expect(graphJson.nodes[1]?.eventLabel).toBe('CAPABILITY_STARTED · seq 2');
    expect(graphJson.nodes[1]?.metricLabel).toBe('toolCallId: tool-1');
    expect(graphJson.nodes[1]?.statusLabel).toBe('Running');
    expect(graphJson.nodes[1]?.phaseColor).toBe('#f79009');
  });
});
