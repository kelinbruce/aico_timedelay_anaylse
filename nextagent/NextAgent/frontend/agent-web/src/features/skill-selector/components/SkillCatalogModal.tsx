import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Input, Spin } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import type { SkillCatalogSummaryEntry } from '../../../state/contracts.ts';
import { useSkillSelectionStore } from '../../../state/skillSelectionStore.ts';
import { SKILL_ICONS } from '../../../constants/skillIcons.ts';
import { querySkills } from '../../../services/skillCatalogService.ts';
import { resolveSkillDisplayName } from '../skill-display-name.ts';
import { SKILL_SEARCH_KEYWORD_MAX_LENGTH } from '../../../constants/inputLimits.ts';

export interface SkillCatalogModalProps {
  readonly anchorRect: DOMRect | null;
  readonly onClose: () => void;
  readonly initialItemCount?: number;
}

const MODAL_WIDTH = 328;
const MODAL_MIN_HEIGHT = 120;
const MODAL_MAX_HEIGHT = 400;
const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;
const SKILL_ROW_HEIGHT = 36;
const MAX_VISIBLE_SKILL_ROWS = 7;

export function SkillCatalogModal({ anchorRect, onClose, initialItemCount = 1 }: SkillCatalogModalProps) {
  const { i18n, t } = useTranslation();
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [skills, setSkills] = useState<readonly SkillCatalogSummaryEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [keyboardIndex, setKeyboardIndex] = useState(-1);
  const [listViewportHeight] = useState(() => Math.min(MAX_VISIBLE_SKILL_ROWS, Math.max(1, initialItemCount)) * SKILL_ROW_HEIGHT);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(false);
  const skillsRef = useRef(skills);
  const keyboardIndexRef = useRef(keyboardIndex);
  const selectedSkill = useSkillSelectionStore((s) => s.selectedSkill);
  const selectSkill = useSkillSelectionStore((s) => s.selectSkill);

  skillsRef.current = skills;
  keyboardIndexRef.current = keyboardIndex;

  // Debounce keyword changes
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedKeyword(keyword);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [keyword]);

  // Load first page when debounced keyword changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setSkills([]);
    setPageNum(1);
    setTotal(0);
    setHasMore(false);
    setKeyboardIndex(-1);
    hasMoreRef.current = false;

    querySkills({ pageNum: 1, pageSize: PAGE_SIZE, keyword: debouncedKeyword })
      .then((result) => {
        if (cancelled) {
          return;
        }
        setSkills(result.skills ?? []);
        setTotal(result.total ?? 0);
        setHasMore((result.skills ?? []).length < (result.total ?? 0));
        hasMoreRef.current = (result.skills ?? []).length < (result.total ?? 0);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setSkills([]);
        setTotal(0);
        setHasMore(false);
        hasMoreRef.current = false;
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [debouncedKeyword]);

  const loadNextPage = useCallback(() => {
    if (loadingRef.current || !hasMoreRef.current) {
      return;
    }
    loadingRef.current = true;
    setLoading(true);
    const nextPage = pageNum + 1;
    querySkills({ pageNum: nextPage, pageSize: PAGE_SIZE, keyword: debouncedKeyword })
      .then((result) => {
        setSkills((prev) => {
          const existingIds = new Set(prev.map((s) => s.capabilityId));
          const newSkills = (result.skills ?? []).filter((s) => !existingIds.has(s.capabilityId));
          return [...prev, ...newSkills];
        });
        setPageNum(nextPage);
        setTotal(result.total);
        const allLoaded = (result.skills ?? []).length > 0 && skillsRef.current.length + (result.skills ?? []).length >= (result.total ?? 0);
        setHasMore(!allLoaded);
        hasMoreRef.current = !allLoaded;
      })
      .catch(() => {
        // Keep existing results on error
      })
      .finally(() => {
        loadingRef.current = false;
        setLoading(false);
      });
  }, [pageNum, debouncedKeyword]);

  const handleScroll = useCallback(() => {
    const list = listRef.current;
    if (!list) {
      return;
    }
    const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - 20;
    if (nearBottom) {
      loadNextPage();
    }
  }, [loadNextPage]);

  const handleClickSkill = useCallback(
    (skill: SkillCatalogSummaryEntry) => {
      selectSkill(skill);
      onClose();
    },
    [selectSkill, onClose],
  );

  // Keyboard navigation: Escape, ArrowUp, ArrowDown, Enter
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      const currentSkills = skillsRef.current;
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        if (currentSkills.length === 0) {
          return;
        }
        setKeyboardIndex((prev) => (prev + 1) % currentSkills.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        e.stopPropagation();
        if (currentSkills.length === 0) {
          return;
        }
        setKeyboardIndex((prev) => (prev - 1 + currentSkills.length) % currentSkills.length);
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        const idx = keyboardIndexRef.current;
        if (idx >= 0 && idx < currentSkills.length) {
          handleClickSkill(currentSkills[idx]!);
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [onClose, handleClickSkill]);

  // Auto-focus search input on mount
  useEffect(() => {
    const input = modalRef.current?.querySelector<HTMLInputElement>('input');
    input?.focus();
  }, []);

  // Scroll keyboard-focused item into view
  useEffect(() => {
    if (keyboardIndex < 0) {
      return;
    }
    const list = listRef.current;
    if (!list) {
      return;
    }
    const item = list.querySelector<HTMLElement>(`[data-keyboard-index="${keyboardIndex}"]`);
    if (item) {
      item.scrollIntoView({ block: 'nearest' });
    }
  }, [keyboardIndex]);

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const modal = modalRef.current;
      if (modal && !modal.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  // Position: right-bottom of modal aligns with right-top of anchor button
  const modalStyle: React.CSSProperties = (() => {
    if (!anchorRect) {
      return {
        position: 'fixed',
        top: 100,
        right: 24,
        width: MODAL_WIDTH,
        zIndex: 1000,
      };
    }
    const modalRight = window.innerWidth - anchorRect.right;
    // Position the modal so its bottom edge is 16px above the anchor button,
    // regardless of actual modal height. Using `bottom` instead of `top`
    // means the gap stays constant whether the content is short or at max
    // height — the modal grows upward from the anchor.
    const modalBottom = window.innerHeight - anchorRect.top + 16;
    return {
      position: 'fixed',
      bottom: modalBottom,
      right: modalRight,
      width: MODAL_WIDTH,
      zIndex: 1000,
    };
  })();

  // When the modal would extend past the top of the viewport (content at max
  // height plus the 16px gap), fall back to opening below the button instead.
  const computedStyle: React.CSSProperties = (() => {
    if (!anchorRect) {
      return modalStyle;
    }
    const bottomValue = (modalStyle as { bottom?: number }).bottom;
    if (bottomValue === undefined) {
      return modalStyle;
    }
    const topEdge = window.innerHeight - bottomValue - MODAL_MAX_HEIGHT;
    if (topEdge >= 8) {
      return modalStyle;
    }
    // Not enough space above — open below with the same 16px gap.
    return {
      position: 'fixed' as const,
      top: anchorRect.bottom + 16,
      right: window.innerWidth - anchorRect.right,
      width: MODAL_WIDTH,
      zIndex: 1000,
    };
  })();

  return (
    <div
      ref={modalRef}
      data-testid="skill-catalog-modal"
      style={{
        ...computedStyle,
        minHeight: MODAL_MIN_HEIGHT,
        maxHeight: MODAL_MAX_HEIGHT,
        background: 'var(--color-bg-primary, #ffffff)',
        border: '1px solid var(--color-composer-border, #e5e7eb)',
        borderRadius: 12,
        boxShadow: '0 6px 18px rgba(0,0,0,0.12)',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        padding: 16,
      }}
    >
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: 'var(--color-text-primary, #1f2937)',
          flexShrink: 0,
        }}
      >
        {t('skillSelector.all')}
      </div>
      <div
        style={{
          height: 20,
          margin: '8px 0',
          fontSize: 12,
          fontWeight: 600,
          lineHeight: '20px',
          color: 'var(--color-text-secondary, #6b7280)',
          flexShrink: 0,
        }}
      >
        {t('skillSelector.modalDescription')}
      </div>
      <div style={{ flexShrink: 0, marginBottom: 8 }}>
        <Input
          data-testid="skill-modal-search"
          placeholder={t('skillSelector.searchPlaceholder')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          allowClear
          maxLength={SKILL_SEARCH_KEYWORD_MAX_LENGTH}
          suffix={<SearchOutlined style={{ color: 'var(--color-text-tertiary)' }} />}
          style={{ paddingLeft: 12, paddingRight: 12, fontSize: 12, height: 32 }}
        />
      </div>
      <div
        ref={listRef}
        onScroll={handleScroll}
        data-testid="skill-modal-list"
        className="nextagent-trackless-scrollbar"
        style={{
          height: listViewportHeight,
          flex: '0 0 auto',
          overflowY: 'auto',
        }}
      >
        {loading && skills.length === 0 && (
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <Spin size="small" />
          </div>
        )}
        {!loading && skills.length === 0 && (
          <div
            data-testid="skill-modal-empty"
            style={{ textAlign: 'center', padding: '20px 0', color: 'var(--color-text-secondary, #6b7280)', fontSize: 12 }}
          >
            {t('skillSelector.noResults')}
          </div>
        )}
        {skills.map((skill, index) => {
          const isSelected = selectedSkill?.capabilityId === skill.capabilityId;
          const isKeyboardFocused = keyboardIndex === index;
          const background = isSelected ? 'var(--color-bg-active, #e6f4ff)' : isKeyboardFocused ? 'var(--color-bg-hover, #f5f5f5)' : 'transparent';
          const color = isSelected ? 'var(--color-primary, #1677ff)' : 'var(--color-text-primary, #1f2937)';
          return (
            <div
              key={skill.capabilityId}
              data-testid={`skill-modal-item-${skill.capabilityId}`}
              data-keyboard-index={index}
              onClick={() => handleClickSkill(skill)}
              style={{
                height: 36,
                padding: '7px 12px',
                borderRadius: 8,
                cursor: 'pointer',
                fontSize: 13,
                lineHeight: '18px',
                background,
                color,
                transition: 'background 120ms ease',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                boxSizing: 'border-box',
              }}
              onMouseEnter={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = 'var(--color-bg-hover, #f5f5f5)';
                }
              }}
              onMouseLeave={(e) => {
                if (!isSelected) {
                  e.currentTarget.style.background = isKeyboardFocused ? 'var(--color-bg-hover, #f5f5f5)' : 'transparent';
                }
              }}
            >
              <img
                src={SKILL_ICONS[index % SKILL_ICONS.length]}
                alt=""
                aria-hidden="true"
                style={{ width: 16, height: 16, flexShrink: 0, marginRight: 16 }}
              />
              {resolveSkillDisplayName(skill, i18n.resolvedLanguage ?? i18n.language)}
            </div>
          );
        })}
        {loading && skills.length > 0 && (
          <div style={{ textAlign: 'center', padding: '8px 0' }}>
            <Spin size="small" />
          </div>
        )}
      </div>
    </div>
  );
}
