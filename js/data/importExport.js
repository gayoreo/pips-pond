import { toKey } from '../core/dates.js';

// ---------- CSV ----------
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const src = String(text ?? '').replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ',' || c === '\t') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

export function toCSV(rows) {
  return rows.map((r) => r.map((v) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(',')).join('\r\n');
}

// ---------- parsing school exports ----------
const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

const monthNum = (name) => MONTHS[name.slice(0, 4).toLowerCase()] ?? MONTHS[name.slice(0, 3).toLowerCase()];

// Accepts 2026-09-21, 9/21/2026, 9/21/26, "Sep 21, 2026", "21 Sep 2026", with or without a time.
export function parseDateLoose(value) {
  const s = String(value ?? '').trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (m) return fmt(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/.exec(s);
  if (m) return fmt(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[1], +m[2]);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/.exec(s);
  if (m && monthNum(m[1])) return fmt(+m[3], monthNum(m[1]), +m[2]);
  m = /^(\d{1,2})\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/.exec(s);
  if (m && monthNum(m[2])) return fmt(+m[3], monthNum(m[2]), +m[1]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : toKey(d);
}

function fmt(y, mo, d) {
  if (!(mo >= 1 && mo <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(y, mo - 1, d);
  return date.getMonth() === mo - 1 ? toKey(date) : null;
}

// "$5.45", "-5.45", "(5.45)", "5,45"? → 5.45 (always positive)
export function parseAmount(value) {
  const s = String(value ?? '').replace(/,(?=\d{3}\b)/g, '');
  const m = /(\d+(?:\.\d+)?)/.exec(s);
  return m ? Math.round(Number(m[1]) * 100) / 100 : NaN;
}

const DEPOSIT = /deposit|add(ed)?\s*funds?|credit|refund|reload|top.?up/i;
const SWIPE = /meal|swipe|board|dining hall|entry|all.?you.?care/i;
const EXCHANGE = /exchange|equivalen/i;

export function guessType(description) {
  const d = String(description ?? '');
  if (EXCHANGE.test(d)) return 'exchange';
  if (SWIPE.test(d)) return 'swipe';
  return 'points';
}

/**
 * Turn CSV rows into entries.
 * opts: { dateCol, amountCol, descCol (or -1), mode: 'points'|'swipe'|'guess',
 *         skipDeposits, onlyBetween: [start, end] | null, existing: entries[] }
 */
export function mapSchoolRows(rows, opts) {
  const out = [];
  const skipped = { badDate: 0, badAmount: 0, deposit: 0, outside: 0, duplicate: 0 };
  const seen = new Map();
  for (const e of opts.existing ?? []) {
    const k = `${e.date}|${e.type}|${Number(e.amount).toFixed(2)}`;
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  for (const r of rows) {
    const date = parseDateLoose(r[opts.dateCol]);
    if (!date) { skipped.badDate++; continue; }
    const desc = opts.descCol >= 0 ? r[opts.descCol] ?? '' : '';
    if (opts.skipDeposits && DEPOSIT.test(desc)) { skipped.deposit++; continue; }
    if (opts.onlyBetween && (date < opts.onlyBetween[0] || date > opts.onlyBetween[1])) { skipped.outside++; continue; }
    const type = opts.mode === 'guess' ? guessType(desc) : opts.mode;
    let amount = parseAmount(r[opts.amountCol]);
    if (type !== 'points') amount = 1;
    if (!(amount > 0)) { skipped.badAmount++; continue; }
    const k = `${date}|${type}|${amount.toFixed(2)}`;
    if (opts.skipDuplicates && seen.get(k) > 0) { seen.set(k, seen.get(k) - 1); skipped.duplicate++; continue; }
    out.push({ date, type, amount, note: desc ? `imported: ${desc}` : 'imported' });
  }
  return { entries: out, skipped };
}

// ---------- downloads ----------
export function download(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function entriesCSV(semesters) {
  const rows = [['semester', 'date', 'type', 'amount', 'note', 'logged_at']];
  for (const { name, entries } of semesters) {
    for (const e of [...entries].sort((a, b) => a.date.localeCompare(b.date))) {
      if (e.deleted) continue;
      rows.push([name, e.date, e.type, e.amount, e.note ?? '', e.createdAt ?? '']);
    }
  }
  return toCSV(rows);
}

export const slug = (s) => String(s ?? 'semester').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'semester';
