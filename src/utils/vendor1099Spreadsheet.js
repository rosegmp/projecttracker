import { readSheet } from 'read-excel-file/browser';

const MAX_IMPORT_BYTES = 10 * 1024 * 1024;
const TAX_ID_PATTERN = /\b\d{2}-?\d{7}\b/;

function cleanText(value, maxLength = 240) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function normalizeName(value) {
  return cleanText(value).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(incorporated|inc|limited|ltd|llc|corp|corporation|company|co)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const text = String(value ?? '').trim();
  if (!text) return 0;
  const negative = /^\(.*\)$/.test(text);
  const numeric = Number(text.replace(/[^0-9.-]/g, ''));
  return Number.isFinite(numeric) ? (negative ? -Math.abs(numeric) : numeric) : 0;
}

function taxIdLastFour(row) {
  for (const cell of row || []) {
    const match = String(cell ?? '').match(TAX_ID_PATTERN);
    if (match) return match[0].replace(/\D/g, '').slice(-4);
  }
  return '';
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 25); rowIndex += 1) {
    const row = rows[rowIndex] || [];
    const amountColumn = row.findIndex((cell) => /nonemployee compensation|nec\s*box\s*1/i.test(String(cell ?? '')));
    if (amountColumn >= 0) return { rowIndex, amountColumn };
  }
  throw new Error('The spreadsheet does not contain a “NEC Box 1: Nonemployee Compensation” column.');
}

function vendorNameFromRow(row, amountColumn) {
  for (let index = 0; index < row.length; index += 1) {
    if (index === amountColumn) continue;
    const text = cleanText(row[index]);
    if (!text || /^total$/i.test(text) || TAX_ID_PATTERN.test(text) || /no tax id/i.test(text)) continue;
    if (/nonemployee compensation|nec\s*box\s*1/i.test(text)) continue;
    return text;
  }
  return '';
}

export async function parseVendor1099Spreadsheet(file) {
  if (!file || !/\.xlsx$/i.test(file.name || '')) throw new Error('Choose a QuickBooks 1099 report in .xlsx format.');
  if (Number(file.size) > MAX_IMPORT_BYTES) throw new Error('The 1099 spreadsheet must be 10 MB or smaller.');
  const rows = await readSheet(file);
  return parseVendor1099Rows(rows);
}

export function parseVendor1099Rows(rows) {
  if (!Array.isArray(rows) || !rows.length) throw new Error('The spreadsheet is empty.');
  const { rowIndex: headerRow, amountColumn } = findHeader(rows);
  const parsed = [];
  for (let index = headerRow + 1; index < rows.length; index += 1) {
    const row = rows[index] || [];
    if (row.some((cell) => /^total$/i.test(cleanText(cell)))) continue;
    const rowAmount = amount(row[amountColumn]);
    const name = vendorNameFromRow(row, amountColumn);
    if (!name || /^total$/i.test(name) || rowAmount < 0) continue;
    const nextRow = rows[index + 1] || [];
    const lastFour = taxIdLastFour(row) || taxIdLastFour(nextRow);
    parsed.push({
      sourceRow: index + 1,
      vendorName: name,
      taxIdLastFour: lastFour,
      reportableTotal: Math.round(rowAmount * 100) / 100,
      subcontractorId: '',
    });
  }
  if (!parsed.length) throw new Error('No vendor payment rows were found under the NEC Box 1 column.');
  const combined = new Map();
  parsed.forEach((row) => {
    const key = `${normalizeName(row.vendorName)}|${row.taxIdLastFour}`;
    const current = combined.get(key);
    if (current) current.reportableTotal = Math.round((current.reportableTotal + row.reportableTotal) * 100) / 100;
    else combined.set(key, { ...row });
  });
  return [...combined.values()];
}

export function suggestVendor1099Matches(rows, subcontractors = [], taxIdStatuses = []) {
  const taxBySubcontractor = new Map(taxIdStatuses.map((status) => [String(status.subcontractorId), status]));
  const idsByLastFour = new Map();
  const idsByName = new Map();
  subcontractors.forEach((subcontractor) => {
    const id = String(subcontractor.id || '');
    const taxStatus = taxBySubcontractor.get(id) || {};
    const lastFour = cleanText(taxStatus.taxIdLastFour, 4);
    if (/^[0-9]{4}$/.test(lastFour)) idsByLastFour.set(lastFour, [...(idsByLastFour.get(lastFour) || []), id]);
    const names = [subcontractor.company, subcontractor.legalName, `${subcontractor.first || ''} ${subcontractor.last || ''}`, taxStatus.legalName, taxStatus.businessName];
    new Set(names.map(normalizeName).filter(Boolean)).forEach((name) => idsByName.set(name, [...(idsByName.get(name) || []), id]));
  });
  return rows.map((row) => {
    if (row.subcontractorId) return { ...row, matchReason: 'saved' };
    const taxMatches = row.taxIdLastFour ? idsByLastFour.get(row.taxIdLastFour) || [] : [];
    if (taxMatches.length === 1) return { ...row, subcontractorId: taxMatches[0], matchReason: 'tax-id' };
    const nameMatches = idsByName.get(normalizeName(row.vendorName)) || [];
    if (nameMatches.length === 1) return { ...row, subcontractorId: nameMatches[0], matchReason: 'name' };
    return { ...row, matchReason: taxMatches.length > 1 || nameMatches.length > 1 ? 'ambiguous' : 'unmatched' };
  });
}
