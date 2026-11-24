/** 事件流 → 当前态投影：可重建、可校验；不落库（M1 数据量小）。 */

export function project(events = []) {
  const sorted = [...events].sort(
    (a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at))
      || String(a.event_id).localeCompare(String(b.event_id)),
  );
  const out = {
    is_lead_marker: false,
    marker: null,
    candidate_state: '待定',
    review_date: null,
    context_note: null,
    premortem: null,
    corrections: [],
    log: [],
  };
  for (const e of sorted) {
    out.log.push(e);
    switch (e.kind) {
      case 'marker_set':
        out.is_lead_marker = true;
        out.marker = { ...(out.marker || {}), ...e.payload, marked_at: e.occurred_at, marker_source: 'manual' };
        break;
      case 'marker_unset':
        out.is_lead_marker = false;
        out.marker = null;
        break;
      case 'state_set':
        out.candidate_state = e.payload.state;
        out.review_date = e.payload.review_date ?? null;
        out.context_note = e.payload.context_note ?? null;
        out.premortem = e.payload.premortem ?? null;
        break;
      case 'correction':
        out.corrections.push({ text: e.payload.text, at: e.payload.at || e.occurred_at });
        break;
      case 'restore':
        // 恢复只追加事件、重新投影；不复制实体、不覆盖原记录（P4 校验点）
        break;
      default:
        break;
    }
  }
  return Object.freeze(out);
}
