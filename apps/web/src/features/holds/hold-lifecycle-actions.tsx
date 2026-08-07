'use client';

import { useState } from 'react';
import {
  deleteUnusedHoldCategory,
  restoreHoldCategory,
  stopHoldCategory,
  type HoldCategoryDetail,
} from './hold-api';

export function HoldCategoryLifecycleActions(props: {
  category: HoldCategoryDetail;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [message, setMessage] = useState('');

  async function run(action: () => Promise<void>, confirmation: string, remove = false) {
    if (!window.confirm(confirmation)) return;
    setMessage('');
    try {
      await action();
      if (remove) await props.onDeleted();
      else await props.onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '操作失败');
    }
  }

  const category = props.category;
  return (
    <section className="hold-lifecycle-section">
      <div>
        <b>这个用途不再使用？</b>
        <p>停用后历史仍会保留；从未使用过的用途可以永久删除。</p>
        {message && <small>{message}</small>}
      </div>
      <span>
        {category.lifecycle.canRestore ? (
          <button onClick={() => run(() => restoreHoldCategory(category.id), '恢复该用途分类？')}>
            恢复使用
          </button>
        ) : (
          <button
            disabled={!category.lifecycle.canStop}
            onClick={() =>
              run(
                () => stopHoldCategory(category.id),
                '停用后不能继续添加岩点或入库，但历史会保留。确定继续？',
              )
            }
          >
            停用分类
          </button>
        )}
        <button
          className="is-danger"
          disabled={!category.lifecycle.canDelete}
          onClick={() =>
            run(
              () => deleteUnusedHoldCategory(category.id),
              `永久删除后将释放编号 ${category.code}，该操作不能撤销。确定继续？`,
              true,
            )
          }
        >
          永久删除
        </button>
      </span>
    </section>
  );
}
