'use client';

import { useState, type FormEvent } from 'react';
import { climbingColorOptions, type ClimbingColor } from '../common/climbing-colors';
import type {
  HoldMountingType,
  HoldSizeClass,
  HoldSpecification,
  HoldSpecificationInput,
} from './hold-api';
import { mountingOptions, sizeOptions } from './hold-options';
import { MAX_HOLD_DIMENSION_MM, UNKNOWN_HOLD_MANUFACTURER } from './hold-domain.constants';

interface SpecificationFormState {
  productName: string;
  manufacturer: string;
  style: string;
  sizeClass: HoldSizeClass;
  mountingType: HoldMountingType;
  color: ClimbingColor;
  sku: string;
  widthMm: string;
  heightMm: string;
  depthMm: string;
}

export function HoldSpecificationForm(props: {
  initial?: HoldSpecification;
  submitLabel: string;
  onSubmit: (input: HoldSpecificationInput) => Promise<void>;
  onCancel: () => void;
  context?: 'manual' | 'scan';
}) {
  const [form, setForm] = useState(() => initialState(props.initial));
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSubmitting(true);
    setMessage('');
    try {
      await props.onSubmit(toInput(form));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '岩点档案保存失败');
    } finally {
      setSubmitting(false);
    }
  }

  function update<K extends keyof SpecificationFormState>(
    field: K,
    value: SpecificationFormState[K],
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <form className="hold-specification-form" onSubmit={submit}>
      <p>
        {props.context === 'scan'
          ? '3D 实物模型是主要辨识依据；名称、生产商和颜色用于辅助搜索与人工确认。'
          : '只有款型、颜色、尺寸、生产商和固定方式完全一致，才属于同一个可批量管理的岩点档案。'}
      </p>
      <div className="hold-specification-form-grid">
        <TextField
          label="款型 / 造型名称"
          required
          value={form.productName}
          onChange={(value) => update('productName', value)}
        />
        <TextField
          label="生产商（可选）"
          value={form.manufacturer}
          onChange={(value) => update('manufacturer', value)}
        />
        <SelectField
          label="尺寸级别"
          value={form.sizeClass}
          options={sizeOptions.map((value) => [value, value])}
          onChange={(value) => update('sizeClass', value as HoldSizeClass)}
        />
        <SelectField
          label="固定方式"
          value={form.mountingType}
          options={mountingOptions}
          onChange={(value) => update('mountingType', value as HoldMountingType)}
        />
        <SelectField
          label="岩点颜色"
          value={form.color}
          options={climbingColorOptions.map(({ value, label }) => [value, label])}
          onChange={(value) => update('color', value as ClimbingColor)}
        />
        <TextField
          label="供应商货号（可选）"
          value={form.sku}
          onChange={(value) => update('sku', value)}
        />
        <TextField
          label="造型风格（可选）"
          value={form.style}
          onChange={(value) => update('style', value)}
        />
      </div>
      <DimensionFields form={form} update={update} />
      <footer>
        <button type="button" onClick={props.onCancel}>
          取消
        </button>
        <button type="submit" disabled={submitting}>
          {submitting ? '保存中…' : props.submitLabel}
        </button>
      </footer>
      {message && <small className="is-error">{message}</small>}
    </form>
  );
}

function TextField(props: {
  label: string;
  value: string;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <input
        required={props.required}
        maxLength={80}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
      />
    </label>
  );
}

function SelectField(props: {
  label: string;
  value: string;
  options: ReadonlyArray<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {props.label}
      <select value={props.value} onChange={(event) => props.onChange(event.target.value)}>
        {props.options.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function DimensionFields(props: {
  form: SpecificationFormState;
  update: <K extends keyof SpecificationFormState>(
    field: K,
    value: SpecificationFormState[K],
  ) => void;
}) {
  const dimensions = [
    ['widthMm', '宽度 mm'],
    ['heightMm', '高度 mm'],
    ['depthMm', '凸出深度 mm'],
  ] as const;
  return (
    <div className="hold-dimension-grid">
      {dimensions.map(([field, label]) => (
        <label key={field}>
          {label}
          <input
            min="1"
            max={MAX_HOLD_DIMENSION_MM}
            type="number"
            value={props.form[field]}
            onChange={(event) => props.update(field, event.target.value)}
          />
        </label>
      ))}
    </div>
  );
}

function initialState(specification?: HoldSpecification): SpecificationFormState {
  return {
    productName: specification?.productName ?? '',
    manufacturer: specification?.manufacturer ?? '',
    style: specification?.style ?? '',
    sizeClass: specification?.sizeClass ?? 'M',
    mountingType: specification?.mountingType ?? 'UNKNOWN',
    color: specification?.color ?? 'YELLOW',
    sku: specification?.sku ?? '',
    widthMm: optionalString(specification?.widthMm),
    heightMm: optionalString(specification?.heightMm),
    depthMm: optionalString(specification?.depthMm),
  };
}

function toInput(form: SpecificationFormState): HoldSpecificationInput {
  return {
    ...form,
    manufacturer: form.manufacturer.trim() || UNKNOWN_HOLD_MANUFACTURER,
    style: form.style || null,
    sku: form.sku || null,
    widthMm: optionalNumber(form.widthMm),
    heightMm: optionalNumber(form.heightMm),
    depthMm: optionalNumber(form.depthMm),
  };
}

const optionalString = (value?: number | null) => (value ? String(value) : '');
const optionalNumber = (value: string) => (value ? Number(value) : null);
