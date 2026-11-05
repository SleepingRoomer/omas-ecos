// Petits utilitaires d'interface
import { domainIcon, disciplineIcon } from './shared.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));

// Texte multiligne : échappé, retours à la ligne conservés
export const nl = (s) => esc(s).replace(/\n/g, '<br>');

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  let data = null;
  try { data = await res.json(); } catch { /* réponse vide */ }
  if (!res.ok) {
    const err = new Error(data?.error || `Erreur ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export function toast(msg, kind = 'ok') {
  let box = document.getElementById('toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.append(box); }
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.append(t);
  setTimeout(() => t.remove(), kind === 'error' ? 6000 : 3000);
}

export const fmt = (n, d = 2) => (n === null || n === undefined || Number.isNaN(n)) ? '–'
  : Number(n).toLocaleString('fr-FR', { minimumFractionDigits: d, maximumFractionDigits: d });

export const pct = (n) => (n === null || n === undefined) ? '–' : `${Math.round(n * 100)} %`;

export function frDate(iso) {
  if (!iso) return '';
  const d = new Date(`${iso}T12:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function setTitle(t) { document.title = t ? `${t} · ECOS OMAS` : 'ECOS OMAS'; }

// Téléchargement d'un CSV construit côté navigateur
export function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// Lecture d'un CSV ou d'un collage depuis un tableur (séparateur détecté)
export function parseTable(text) {
  const firstLine = text.split(/\r?\n/)[0] || '';
  const sep = firstLine.includes('\t') ? '\t' : (firstLine.split(';').length > firstLine.split(',').length ? ';' : ',');
  const rows = [];
  let row = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export function confirmBox(msg) { return window.confirm(msg); }

// Plaque de porte d'une station : la couleur dit le circuit (A, B ou réserve)
export function plate(slot, size = '') {
  const s = String(slot || '?');
  const c = /^A/i.test(s) ? 'c-a' : /^B/i.test(s) ? 'c-b' : /^R/i.test(s) ? 'c-r' : /^P/i.test(s) ? 'c-p' : 'c-x';
  return `<span class="plate ${c} ${size}" aria-label="${/^P/i.test(s) ? 'Atelier' : 'Station'} ${esc(s)}">${esc(s)}</span>`;
}

// Ordre du circuit de validation (pour les rails de progression)
export const FLOW_ORDER = ['redaction', 'relecture_pair', 'relecture_expert', 'test', 'corrections', 'validation', 'validee'];
export const FLOW_SHORT = ['Rédaction', 'Relecture pair', 'Relecture expert', 'Test', 'Corrections', 'Validation', 'Validée'];

export function rail(status, mini = false) {
  const i = FLOW_ORDER.indexOf(status);
  return `<span class="rail ${mini ? 'mini' : ''}" aria-hidden="true">${FLOW_ORDER.map((_, k) =>
    `<i class="${status === 'validee' || k < i ? 'done' : k === i ? 'now' : ''}"></i>`).join('')}</span>`;
}

// Domaine et discipline précédés de leur pictogramme
export const dom = (d) => (d ? `<span class="tag-ico" aria-hidden="true">${domainIcon(d)}</span>${esc(d)}` : '');
export const disc = (d) => (d ? `<span style="white-space:nowrap"><span class="tag-ico" aria-hidden="true">${disciplineIcon(d)}</span>${esc(d)}</span>` : '');
