'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  ensureDefaultHoldCategories,
  getHoldCategories,
  getHoldSummary,
  type HoldCategory,
  type HoldInventorySummary,
} from './hold-api';

const emptySummary: HoldInventorySummary = {
  categoryCount: 0,
  specificationCount: 0,
  warehouseQuantity: 0,
  installedQuantity: 0,
  reservedQuantity: 0,
  maintenanceQuantity: 0,
  unverifiedCount: 0,
};

let defaultCategoriesRequest: Promise<void> | null = null;

function ensureDefaultCategoriesOnce(): Promise<void> {
  if (!defaultCategoriesRequest) {
    defaultCategoriesRequest = ensureDefaultHoldCategories()
      .then(() => undefined)
      .catch((error: unknown) => {
        defaultCategoriesRequest = null;
        throw error;
      });
  }
  return defaultCategoriesRequest;
}

export function useHoldsData(search: string, gripType: string, showStopped: boolean) {
  const [categories, setCategories] = useState<HoldCategory[]>([]);
  const [summary, setSummary] = useState(emptySummary);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    const errors: string[] = [];
    try {
      await ensureDefaultCategoriesOnce();
    } catch (requestError) {
      errors.push(`默认分类：${toMessage(requestError)}`);
    }
    const [listResult, summaryResult] = await Promise.allSettled([
      getHoldCategories(search, gripType, showStopped),
      getHoldSummary(),
    ]);
    if (listResult.status === 'fulfilled') setCategories(listResult.value.items);
    else errors.push(`岩点目录：${toMessage(listResult.reason)}`);
    if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value);
    else errors.push(`库存指标：${toMessage(summaryResult.reason)}`);
    setError(errors.join('；'));
    setLoading(false);
  }, [gripType, search, showStopped]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { categories, summary, loading, error, refresh };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '岩点数据加载失败';
}
