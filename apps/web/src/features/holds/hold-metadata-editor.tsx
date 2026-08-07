'use client';

import { useState } from 'react';
import { updateHoldCategory, type HoldCategoryDetail } from './hold-api';
import { formatCategoryDescription, gripEnglishLabel, gripLabel } from './hold-options';

export function HoldCategoryMetadataEditor(props: {
  category: HoldCategoryDetail;
  onChanged: () => Promise<void>;
  disabled?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <section className="hold-detail-section">
      <header className="hold-section-title">
        <div>
          <h3>分类信息</h3>
          <p>需要时给这个用途加一句备注</p>
        </div>
        <button disabled={props.disabled} onClick={() => setEditing((value) => !value)}>
          {editing ? '取消' : '编辑说明'}
        </button>
      </header>
      {editing ? (
        <CategoryMetadataForm
          category={props.category}
          onSaved={async () => {
            setEditing(false);
            await props.onChanged();
          }}
        />
      ) : (
        <dl className="hold-metadata-grid">
          <div>
            <dt>分类编号</dt>
            <dd>{props.category.code}</dd>
          </div>
          <div>
            <dt>抓握用途</dt>
            <dd>
              {gripLabel[props.category.gripType]}
              <small className="hold-grip-english">
                {gripEnglishLabel[props.category.gripType]}
              </small>
            </dd>
          </div>
          <div>
            <dt>分类说明</dt>
            <dd>{formatCategoryDescription(props.category.description)}</dd>
          </div>
        </dl>
      )}
    </section>
  );
}

function CategoryMetadataForm(props: {
  category: HoldCategoryDetail;
  onSaved: () => Promise<void>;
}) {
  const [name, setName] = useState(props.category.name);
  const [description, setDescription] = useState(
    formatCategoryDescription(props.category.description ?? ''),
  );
  const [message, setMessage] = useState('');

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    setMessage('');
    try {
      await updateHoldCategory(props.category.id, { name, description: description || null });
      await props.onSaved();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '分类资料保存失败');
    }
  }

  return (
    <form className="hold-metadata-form" onSubmit={submit}>
      <label>
        分类名称
        <input
          required
          maxLength={80}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="is-wide">
        分类说明
        <input
          maxLength={500}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      <button type="submit">保存说明</button>
      {message && <p>{message}</p>}
    </form>
  );
}
