'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  cancelHoldInitialization,
  completeHoldInitialization,
  getActiveHoldInitialization,
  startHoldInitialization,
  type HoldInitializationBatch,
} from './hold-api';

export function useHoldInitialization() {
  const [batch, setBatch] = useState<HoldInitializationBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setBatch(await getActiveHoldInitialization());
    } catch (requestError) {
      setError(toMessage(requestError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => void refresh(), [refresh]);

  async function start(name: string): Promise<void> {
    setBatch(await startHoldInitialization(name));
  }

  async function complete(): Promise<void> {
    if (!batch) return;
    await completeHoldInitialization(batch.id);
    setBatch(null);
  }

  async function cancel(): Promise<void> {
    if (!batch) return;
    await cancelHoldInitialization(batch.id);
    setBatch(null);
  }

  return { batch, loading, error, refresh, start, complete, cancel };
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : '初始化批次加载失败';
}
