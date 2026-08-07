'use client';

import { useState } from 'react';
import { updateHoldSpecification, type HoldSpecification } from './hold-api';
import { HoldSpecificationForm } from './hold-specification-form';

export function HoldSpecificationEditor(props: {
  specification: HoldSpecification;
  onChanged: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button className="hold-variant-edit-trigger" onClick={() => setEditing(true)}>
        编辑档案
      </button>
    );
  }
  return (
    <HoldSpecificationForm
      initial={props.specification}
      submitLabel="保存档案"
      onCancel={() => setEditing(false)}
      onSubmit={async (input) => {
        await updateHoldSpecification(props.specification.id, input);
        setEditing(false);
        await props.onChanged();
      }}
    />
  );
}
