import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { CategoryL1 } from '../../../state/contracts.ts';
import { ChipBar, type ChipBarItem } from '../../shared/components/ChipBar.tsx';

export interface CategoryQuestionBarProps {
  readonly categories: readonly CategoryL1[];
  readonly selectedCategory: string | null;
  readonly onSelectCategory: (category: CategoryL1, iconIndex: number) => void;
}

export function CategoryQuestionBar({ categories, selectedCategory, onSelectCategory }: CategoryQuestionBarProps) {
  const { t } = useTranslation();

  const items: readonly ChipBarItem[] = categories.map((cat) => ({
    key: cat.name,
    label: cat.name,
    tooltip: cat.name,
  }));

  const handleSelect = useCallback(
    (key: string, index: number) => {
      const cat = categories.find((c) => c.name === key);
      if (cat) {
        onSelectCategory(cat, index);
      }
    },
    [categories, onSelectCategory],
  );

  const handleOpenAll = useCallback(() => {
    const allCat: CategoryL1 = { name: t('skillSelector.all'), hasSubCategories: false, questions: [] };
    onSelectCategory(allCat, 0);
  }, [onSelectCategory, t]);

  return (
    <ChipBar
      items={items}
      selectedKey={selectedCategory}
      testIdPrefix="category"
      allLabel={t('skillSelector.all')}
      onSelect={handleSelect}
      onOpenAll={handleOpenAll}
    />
  );
}
