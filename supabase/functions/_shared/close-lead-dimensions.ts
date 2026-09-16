// Verified Close field IDs; store values verbatim, never infer attribution from an activity author.
export const LEAD_DIMENSION_FIELDS = Object.freeze({
 lead_source: 'cf_2CMz3g4iGjEjeWmrbouveHjdBsMHaLttdpV4vrgVurd',
 industry: 'cf_Uf2wDtzMsovpjMv7xJBVlhrfDDeMHB8Hl01zTCkeNSS',
 industry_wz: 'cf_QrlvS8iQRt87bA3GBB6fhIrMuazog6sVnSKntTykOWm',
 working_capital: 'cf_yWtuNeeZPlEeGIeudbkf4LN1sb8pOVkf8hUjzHpIjm0',
 liquidity_statement: 'cf_96MM0Bh0ueo3kyoaEho9pX67c5TDQTxvffbgtbhO1qb',
 financials_date: 'cf_Bba5oxKdmNOolz55KJTTDgh8vGbepeIYc74dtf5w4Tc',
 employees: 'cf_L6S83hpN0YZsYHAJVFZkvtNeCyuz4eOXkbcTsRfeDvK',
 owner: 'cf_9PksauL7S9pUPLluVlvUqRaPbAynAhuQsgpm6xQRj8k',
 opener: 'cf_TSACbW8OM7JYd1ibwAOqZgot7DNRVETNZDNDP6qhhBS',
 setter: 'cf_szgwxBHGiT3kNPNFmmCXXrI8MZcdFKQsoLEQfiJt0Bg',
 closer: 'cf_BfV6Ozp3GtXASgWErLR0y4XGKGg0krhQ64zts9yJSZE',
});
export const SELECTION_STATUSES = Object.freeze({
 setting: 'stat_Bo9KBFViTrdAlKxJaSblfNcnB90ikOzf5g4ARS82mXb',
 closing: 'stat_v6fo1NvqjwqsIIzUS9kNDGVIJVfcDxTxYDXwpqE4gpn',
 customer: 'stat_cD0BJbQkdi32yVVjypYBOeXYyRnHBZKrSuJYhyzWory',
});
export function isSelectedStatusEvent(row: Record<string, unknown>): boolean {
 return row.old_status_id === SELECTION_STATUSES.setting || row.old_status_id === SELECTION_STATUSES.closing || row.new_status_id === SELECTION_STATUSES.customer;
}
const text = (v: unknown): string | null => typeof v === 'string' ? v.trim() || null : null;
export function leadDimensions(lead: Record<string, unknown>, users: Map<string,string>, tracked: boolean) {
 const dimensions: Record<string, string | boolean | null> = { selection_tracked: tracked, status_label: text(lead.status_label) };
 for (const [key, id] of Object.entries(LEAD_DIMENSION_FIELDS)) {
  const raw = lead[`custom.${id}`];
  // Close's liquidity field is multi-select. Retain the actual statements as
  // one lead's metadata; never derive a rating from its Working Capital.
  const value = key === 'liquidity_statement' && Array.isArray(raw)
   ? raw.map(text).filter((v): v is string => v !== null).join(' · ') || null
   : text(raw);
  if (['owner','opener','setter','closer'].includes(key)) {
   dimensions[`${key}_id`] = value;
   dimensions[key] = value ? users.get(value) || `Nicht aufgelöst (${value})` : null;
  } else dimensions[key] = value;
 }
 return dimensions;
}
