export function comparableDisplayPrice(snapshot) {
  const { price, field_status: fields } = snapshot;
  if ((typeof price !== 'number' && typeof price !== 'string') || String(price).trim() === '') return null;
  if (['未获取', '值异常'].includes(fields?.price)) return null;
  const value = Number(price);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

export function budgetGroup(price, ceiling) {
  if (price === null) return 'unavailable';
  return price <= ceiling ? 'at_or_below' : 'above';
}
