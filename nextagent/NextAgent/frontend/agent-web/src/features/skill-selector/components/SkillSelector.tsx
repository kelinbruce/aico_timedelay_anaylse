import { useCallback, useEffect, useState } from 'react';
import type { SkillCatalogSummaryEntry } from '../../../state/contracts.ts';
import { querySkills } from '../../../services/skillCatalogService.ts';
import { SkillSelectorBar } from './SkillSelectorBar.tsx';
import { SkillCatalogModal } from './SkillCatalogModal.tsx';

interface SkillSelectorSummary {
  readonly skills: readonly SkillCatalogSummaryEntry[];
  readonly total: number;
}

let cachedSkillSelectorSummary: SkillSelectorSummary | null = null;
let pendingSkillSelectorSummary: Promise<SkillSelectorSummary> | null = null;

export function loadSkillSelectorSummary(): Promise<SkillSelectorSummary> {
  if (cachedSkillSelectorSummary) {
    return Promise.resolve(cachedSkillSelectorSummary);
  }
  if (pendingSkillSelectorSummary) {
    return pendingSkillSelectorSummary;
  }

  pendingSkillSelectorSummary = querySkills({ pageNum: 1, pageSize: 50 })
    .then((result) => {
      const summary = {
        skills: result.skills ?? [],
        total: result.total ?? 0,
      };
      cachedSkillSelectorSummary = summary;
      return summary;
    })
    .finally(() => {
      pendingSkillSelectorSummary = null;
    });
  return pendingSkillSelectorSummary;
}

export function __resetSkillSelectorSummaryCacheForTests(): void {
  cachedSkillSelectorSummary = null;
  pendingSkillSelectorSummary = null;
}

export function SkillSelector() {
  const [skills, setSkills] = useState<readonly SkillCatalogSummaryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadSkillSelectorSummary()
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSkills(result.skills);
        setTotal(result.total);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSkills([]);
        setTotal(0);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenModal = useCallback(() => {
    const btn = document.querySelector<HTMLButtonElement>("[data-testid='skill-all-button']");
    setAnchorRect(btn ? btn.getBoundingClientRect() : null);
    setModalOpen(true);
  }, []);

  const handleCloseModal = useCallback(() => {
    setModalOpen(false);
  }, []);

  // Don't render the bar if no skills are available
  if (total === 0 && skills.length === 0) {
    return null;
  }

  return (
    <>
      <SkillSelectorBar skills={skills} total={total} onOpenModal={handleOpenModal} />
      {modalOpen && <SkillCatalogModal anchorRect={anchorRect} onClose={handleCloseModal} initialItemCount={Math.max(skills.length, total)} />}
    </>
  );
}
