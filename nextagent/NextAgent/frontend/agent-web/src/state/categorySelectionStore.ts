import { create } from 'zustand';

interface CategorySelectionState {
  readonly selectedCategoryName: string | null;
  readonly selectedIconIndex: number;
  selectCategory: (name: string, iconIndex: number) => void;
  clearSelection: () => void;
}

export const useCategorySelectionStore = create<CategorySelectionState>((set) => ({
  selectedCategoryName: null,
  selectedIconIndex: 0,
  selectCategory: (name, iconIndex) => {
    set({ selectedCategoryName: name, selectedIconIndex: iconIndex });
  },
  clearSelection: () => {
    set({ selectedCategoryName: null, selectedIconIndex: 0 });
  },
}));
