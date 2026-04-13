import { normalizeText } from './utils.js';

export function buildExportFiles(payload, formats = ['json']) {
  const safeFormats = Array.isArray(formats) && formats.length ? formats : ['json'];
  return safeFormats.map(format => createSingleExport(payload, format));
}

export function makeExportFileName(baseName, ext) {
  const safeBase = String(baseName || 'open-comet-export')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'open-comet-export';
  return `${safeBase}.${ext}`;
}

function createSingleExport(payload, format) {
  const data = normalizePayload(payload);
  switch (String(format || 'json').toLowerCase()) {
    case 'csv':
      return { ext: 'csv', mimeType: 'text/csv', content: toCsv(data) };
    case 'txt':
      return { ext: 'txt', mimeType: 'text/plain', content: toTxt(data) };
    case 'md':
    case 'markdown':
      return { ext: 'md', mimeType: 'text/markdown', content: toMarkdown(data) };
    case 'json':
    default:
      return { ext: 'json', mimeType: 'application/json', content: JSON.stringify(data, null, 2) };
  }
}

function normalizePayload(payload = {}) {
  return {
    title: payload.title || 'Open Comet Export',
    rows: Array.isArray(payload.rows) ? payload.rows : [],
    columns: Array.isArray(payload.columns) ? payload.columns : inferColumns(payload.rows || []),
    notes: Array.isArray(payload.notes) ? payload.notes : [],
    meta: payload.meta || {},
  };
}

function inferColumns(rows = []) {
  return [...new Set(rows.flatMap(row => Object.keys(row || {})))];
}

function toCsv(data) {
  const columns = data.columns.length ? data.columns : inferColumns(data.rows);
  const lines = [columns.map(escapeCsv).join(',')];
  for (const row of data.rows) {
    lines.push(columns.map(column => escapeCsv(row?.[column] ?? '')).join(','));
  }
  return lines.join('\n');
}

function toTxt(data) {
  const header = [`Title: ${data.title}`];
  if (data.notes.length) header.push(`Notes: ${data.notes.join(' | ')}`);
  if (Object.keys(data.meta || {}).length) {
    header.push(`Meta: ${JSON.stringify(data.meta)}`);
  }
  const body = data.rows.map((row, index) => {
    const parts = data.columns.map(column => `${column}: ${normalizeText(row?.[column] ?? '')}`);
    return `${index + 1}. ${parts.join(' | ')}`;
  });
  return [...header, '', ...body].join('\n');
}

function toMarkdown(data) {
  const columns = data.columns.length ? data.columns : inferColumns(data.rows);
  const header = `# ${data.title}`;
  const notes = data.notes.length ? `${data.notes.map(note => `- ${note}`).join('\n')}\n\n` : '';
  if (!columns.length || !data.rows.length) return `${header}\n\n${notes}No rows extracted.`;
  const headRow = `| ${columns.join(' | ')} |`;
  const sepRow = `| ${columns.map(() => '---').join(' | ')} |`;
  const body = data.rows
    .map(row => `| ${columns.map(column => escapeMdCell(row?.[column] ?? '')).join(' | ')} |`)
    .join('\n');
  return `${header}\n\n${notes}${headRow}\n${sepRow}\n${body}`;
}

function escapeCsv(value) {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function escapeMdCell(value) {
  return String(value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

