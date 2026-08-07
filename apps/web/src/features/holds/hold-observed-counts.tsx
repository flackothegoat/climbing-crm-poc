export interface ObservedCountState {
  warehouse: string;
  installed: string;
  note: string;
}

export function HoldObservedCounts(props: {
  value: ObservedCountState;
  onChange: (value: ObservedCountState) => void;
}) {
  const update = (field: keyof ObservedCountState, value: string) =>
    props.onChange({ ...props.value, [field]: value });
  return (
    <section className="hold-initialization-counts">
      <div>
        <h4>确认现实中的同组数量</h4>
        <p>这是现场实数，不是新增到货数量；只统计完全一致的岩点。</p>
      </div>
      <label>
        仓库实数
        <input
          min="0"
          type="number"
          value={props.value.warehouse}
          onChange={(event) => update('warehouse', event.target.value)}
        />
      </label>
      <label>
        已上墙实数
        <input
          min="0"
          type="number"
          value={props.value.installed}
          onChange={(event) => update('installed', event.target.value)}
        />
      </label>
      <label className="is-wide">
        盘点备注（可选）
        <input
          maxLength={200}
          value={props.value.note}
          onChange={(event) => update('note', event.target.value)}
        />
      </label>
    </section>
  );
}

export function parseObservedCounts(value: ObservedCountState) {
  const warehouseQuantity = Number(value.warehouse);
  const installedQuantity = Number(value.installed);
  if (!isCount(warehouseQuantity) || !isCount(installedQuantity)) {
    throw new Error('仓库和已上墙实数必须是非负整数');
  }
  if (warehouseQuantity + installedQuantity < 1) throw new Error('同组岩点总数至少为 1');
  return { warehouseQuantity, installedQuantity, note: value.note.trim() || null };
}

function isCount(value: number): boolean {
  return Number.isInteger(value) && value >= 0;
}
