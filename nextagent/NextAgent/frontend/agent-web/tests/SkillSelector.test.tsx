// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SkillSelector, __resetSkillSelectorSummaryCacheForTests } from '../src/features/skill-selector/components/SkillSelector.tsx';
import { SkillSelectorBar } from '../src/features/skill-selector/components/SkillSelectorBar.tsx';
import { SkillCatalogModal } from '../src/features/skill-selector/components/SkillCatalogModal.tsx';
import { SelectedSkillChip } from '../src/features/skill-selector/components/SelectedSkillChip.tsx';
import { useSkillSelectionStore } from '../src/state/skillSelectionStore.ts';
import type { SkillCatalogSummaryEntry } from '../src/state/contracts.ts';
import i18n from '../src/i18n/index.ts';
import { resolveSkillDisplayName } from '../src/features/skill-selector/skill-display-name.ts';

function makeSkill(overrides: Partial<SkillCatalogSummaryEntry> = {}): SkillCatalogSummaryEntry {
  return {
    capabilityId: 'skill-1',
    displayName: '告警诊断',
    description: '网络告警智能诊断',
    providerKind: 'LOCAL_DIRECTORY',
    ...overrides,
  };
}

const skills3: SkillCatalogSummaryEntry[] = [
  makeSkill({ capabilityId: 's1', displayName: '告警诊断', description: '网络告警智能诊断' }),
  makeSkill({ capabilityId: 's2', displayName: '流量分析', description: '网络流量分析' }),
  makeSkill({ capabilityId: 's3', displayName: '拓扑发现', description: '网络拓扑自动发现' }),
];

afterEach(() => {
  cleanup();
  useSkillSelectionStore.getState().clearSelection();
  __resetSkillSelectorSummaryCacheForTests();
  vi.unstubAllGlobals();
});

beforeEach(async () => {
  await i18n.changeLanguage('zh-CN');
  useSkillSelectionStore.getState().clearSelection();
  __resetSkillSelectorSummaryCacheForTests();
});

describe('SkillSelector', () => {
  it('reuses the summary catalog after composer remounts', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total: 3, pageNum: 1, pageSize: 50, skills: skills3 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const first = render(<SkillSelector />);
    await waitFor(() => expect(screen.getByTestId('skill-bar')).toBeTruthy());
    first.unmount();

    render(<SkillSelector />);
    await waitFor(() => expect(screen.getByTestId('skill-bar')).toBeTruthy());

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('SkillSelectorBar (tasks 6.1-6.3)', () => {
  it('renders the bar with skill chips when skills are available', () => {
    render(<SkillSelectorBar skills={skills3} total={3} onOpenModal={() => {}} />);
    expect(screen.getByTestId('skill-bar')).toBeTruthy();
    expect(screen.getByTestId('skill-chip-s1')).toBeTruthy();
    expect(screen.getByTestId('skill-chip-s2')).toBeTruthy();
    expect(screen.getByTestId('skill-chip-s3')).toBeTruthy();
  });

  it('shows the all button even when all skills fit', () => {
    render(<SkillSelectorBar skills={skills3} total={3} onOpenModal={() => {}} />);
    expect(screen.getByTestId('skill-all-button')).toBeTruthy();
  });

  it('shows the all button when total exceeds visible skills', () => {
    render(<SkillSelectorBar skills={skills3} total={100} onOpenModal={() => {}} />);
    expect(screen.getByTestId('skill-all-button')).toBeTruthy();
  });

  it('calls onOpenModal when the all button is clicked', () => {
    const onOpenModal = vi.fn();
    render(<SkillSelectorBar skills={skills3} total={100} onOpenModal={onOpenModal} />);
    fireEvent.click(screen.getByTestId('skill-all-button'));
    expect(onOpenModal).toHaveBeenCalledOnce();
  });

  it('selects a skill when a chip is clicked', () => {
    render(<SkillSelectorBar skills={skills3} total={3} onOpenModal={() => {}} />);
    fireEvent.click(screen.getByTestId('skill-chip-s2').querySelector('button')!);
    expect(useSkillSelectionStore.getState().selectedSkill?.capabilityId).toBe('s2');
  });

  it('replaces previous selection when a new chip is clicked', () => {
    render(<SkillSelectorBar skills={skills3} total={3} onOpenModal={() => {}} />);
    fireEvent.click(screen.getByTestId('skill-chip-s1').querySelector('button')!);
    fireEvent.click(screen.getByTestId('skill-chip-s2').querySelector('button')!);
    expect(useSkillSelectionStore.getState().selectedSkill?.capabilityId).toBe('s2');
  });
});

describe('SelectedSkillChip (tasks 8.1-8.3)', () => {
  it('does not render when no skill is selected', () => {
    const { container } = render(<SelectedSkillChip />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the chip with displayName when a skill is selected', () => {
    useSkillSelectionStore.getState().selectSkill(skills3[0]!);
    render(<SelectedSkillChip />);
    expect(screen.getByTestId('selected-skill-chip')).toBeTruthy();
    expect(screen.getByText('告警诊断')).toBeTruthy();
  });

  it('clears selection when x button is clicked', () => {
    useSkillSelectionStore.getState().selectSkill(skills3[0]!);
    render(<SelectedSkillChip />);
    fireEvent.click(screen.getByTestId('selected-skill-chip-remove'));
    expect(useSkillSelectionStore.getState().selectedSkill).toBeNull();
  });

  it('updates to new skill when selection changes', () => {
    useSkillSelectionStore.getState().selectSkill(skills3[0]!);
    const { rerender } = render(<SelectedSkillChip />);
    expect(screen.getByText('告警诊断')).toBeTruthy();
    useSkillSelectionStore.getState().selectSkill(skills3[1]!);
    rerender(<SelectedSkillChip />);
    expect(screen.getByText('流量分析')).toBeTruthy();
    expect(screen.queryByText('告警诊断')).toBeNull();
  });

  it('uses source metadata for the Chinese catalog and selected skill display', async () => {
    const localizedSkill = makeSkill({
      displayName: 'network-diagnostics',
      sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ total: 1, pageNum: 1, pageSize: 50, skills: [localizedSkill] }),
      }),
    );
    render(<SkillCatalogModal anchorRect={null} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('网络诊断')).toBeTruthy());
    fireEvent.click(screen.getByTestId('skill-modal-item-skill-1'));
    render(<SelectedSkillChip />);
    expect(screen.getAllByText('网络诊断')).not.toHaveLength(0);
  });

  it('uses English source metadata outside Chinese and falls back to displayName', () => {
    const localizedSkill = makeSkill({
      displayName: 'network-diagnostics',
      sourceMetadata: { 'zh-name': '网络诊断', 'en-name': 'Network Diagnostics' },
    });
    expect(resolveSkillDisplayName(localizedSkill, 'en-US')).toBe('Network Diagnostics');
    expect(resolveSkillDisplayName(makeSkill({ sourceMetadata: { 'zh-name': '网络诊断' } }), 'en-US')).toBe('告警诊断');
    expect(resolveSkillDisplayName(makeSkill({ sourceMetadata: { 'en-name': ['invalid'] } }), 'en-US')).toBe('告警诊断');
  });
});

describe('SkillCatalogModal (tasks 7.1-7.5)', () => {
  const mockResult = { total: 0, pageNum: 1, pageSize: 50, skills: [] as SkillCatalogSummaryEntry[] };

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResult),
      }),
    );
  });

  it('renders with correct title and search box', () => {
    render(<SkillCatalogModal anchorRect={null} onClose={() => {}} />);
    expect(screen.getByText(i18n.t('skillSelector.all'))).toBeTruthy();
    expect(screen.getByTestId('skill-modal-search')).toBeTruthy();
  });

  it('keeps the list viewport height stable while the first catalog request resolves', async () => {
    let resolveCatalog!: (value: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveCatalog = resolve;
          }),
      )
      .mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ total: 0, pageNum: 1, pageSize: 50, skills: [] }),
      } as Response);
    vi.stubGlobal('fetch', fetchMock);

    render(<SkillCatalogModal anchorRect={null} onClose={() => {}} initialItemCount={3} />);

    const list = screen.getByTestId('skill-modal-list');
    expect(list.style.height).toBe('108px');

    resolveCatalog({
      ok: true,
      json: () => Promise.resolve({ total: 3, pageNum: 1, pageSize: 50, skills: skills3 }),
    } as Response);
    await waitFor(() => expect(screen.getByTestId('skill-modal-item-s3')).toBeTruthy());

    expect(list.style.height).toBe('108px');

    fireEvent.change(screen.getByTestId('skill-modal-search'), { target: { value: 'missing' } });
    await waitFor(() => expect(screen.getByTestId('skill-modal-empty')).toBeTruthy(), { timeout: 2_000 });

    expect(list.style.height).toBe('108px');
  });

  it('closes on Escape key', () => {
    const onClose = vi.fn();
    render(<SkillCatalogModal anchorRect={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on outside click', () => {
    const onClose = vi.fn();
    render(<SkillCatalogModal anchorRect={null} onClose={onClose} />);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });

  it('preserves selection after closing', () => {
    useSkillSelectionStore.getState().selectSkill(skills3[0]!);
    const onClose = vi.fn();
    render(<SkillCatalogModal anchorRect={null} onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(useSkillSelectionStore.getState().selectedSkill?.capabilityId).toBe('s1');
  });

  it('selects a skill from the modal list and closes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ total: 3, pageNum: 1, pageSize: 50, skills: skills3 }),
      }),
    );
    const onClose = vi.fn();
    render(<SkillCatalogModal anchorRect={null} onClose={onClose} />);
    await waitFor(() => {
      expect(screen.getByTestId('skill-modal-item-s2')).toBeTruthy();
    });
    fireEvent.click(screen.getByTestId('skill-modal-item-s2'));
    expect(useSkillSelectionStore.getState().selectedSkill?.capabilityId).toBe('s2');
    expect(onClose).toHaveBeenCalled();
  });

  it('debounces search input (300ms)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ total: 0, pageNum: 1, pageSize: 50, skills: [] }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const { container } = render(<SkillCatalogModal anchorRect={null} onClose={() => {}} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toBeTruthy();
    fireEvent.change(input, { target: { value: 'a' } });
    fireEvent.change(input, { target: { value: 'ab' } });
    fireEvent.change(input, { target: { value: 'abc' } });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2), { timeout: 2000 });
  });
});
