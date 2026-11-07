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

export function longDate(iso) {
  if (!iso) return '';
  const s = new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function setTitle(t) { document.title = t ? `${t} · INES` : 'INES · ECOS blancs OMAS Externat'; }

// Une cellule qui commence par = + - @ serait exécutée comme formule par le tableur : on la neutralise
export const csvCell = (v) => { let t = String(v ?? ''); if (/^[=+\-@\t\r]/.test(t) && !/^-?\d[\d,.]*$/.test(t)) t = `'${t}`; return `"${t.replace(/"/g, '""')}"`; };

// Téléchargement d'un CSV construit côté navigateur
export function downloadCsv(filename, rows) {
  const csv = '﻿' + rows.map((r) => r.map(csvCell).join(';')).join('\r\n');
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

// Plaque d'atelier : le pictogramme de l'atelier, avec son numéro en pastille
export function atelierPlate(code, emoji, size = '') {
  const n = String(code || '').replace(/\D/g, '') || esc(code || '?');
  if (!emoji) return plate(code, size);
  return `<span class="aplate ${size}" role="img" aria-label="Atelier ${esc(n)}"><span class="emo">${esc(emoji)}</span><span class="no">${esc(n)}</span></span>`;
}

// ---------- choix de jours précis (deux week-ends, par exemple) ----------

// Résumé lisible : « sam. 18, dim. 19, sam. 25 et dim. 26 avril 2026 »
export function daysLabel(days) {
  const list = [...new Set((days || []).filter(Boolean))].sort();
  if (!list.length) return 'Dates à fixer';
  const fmtDay = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric' });
  const byMonth = [];
  for (const d of list) {
    const m = d.slice(0, 7);
    if (!byMonth.length || byMonth[byMonth.length - 1].m !== m) byMonth.push({ m, days: [] });
    byMonth[byMonth.length - 1].days.push(d);
  }
  const parts = byMonth.map((g, i) => {
    const month = new Date(`${g.days[0]}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', ...(i === byMonth.length - 1 ? { year: 'numeric' } : {}) });
    return `${g.days.map(fmtDay).join(', ')} ${month}`;
  });
  const s = parts.join(', ');
  const k = s.lastIndexOf(', ');
  return list.length > 1 && byMonth.length === 1 ? s.replace(/, ([^,]*)$/, ' et $1') : (k > 0 && byMonth.length > 1 ? `${s.slice(0, k)} et ${s.slice(k + 2)}` : s);
}

// Petit calendrier : un clic ajoute ou retire un jour. `onChange(days)` reçoit la liste triée.
export function daysPicker(el, initial = [], onChange = () => {}, opts = {}) {
  let days = [...new Set(initial.filter(Boolean))].sort();
  const first = days[0] || new Date().toISOString().slice(0, 10);
  let view = new Date(`${first.slice(0, 7)}-01T12:00:00`);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const draw = () => {
    const y = view.getFullYear(); const m = view.getMonth();
    const start = (new Date(y, m, 1).getDay() + 6) % 7;
    const n = new Date(y, m + 1, 0).getDate();
    const cells = [];
    for (let i = 0; i < start; i++) cells.push('<span></span>');
    for (let d = 1; d <= n; d++) {
      const k = iso(new Date(y, m, d));
      const wd = (start + d - 1) % 7;
      cells.push(`<button type="button" data-day="${k}" class="${days.includes(k) ? 'on' : ''} ${wd >= 5 ? 'we' : ''}" aria-pressed="${days.includes(k)}">${d}</button>`);
    }
    el.innerHTML = `<div class="dp">
      <div class="dp-head"><button type="button" data-nav="-1" aria-label="Mois précédent">‹</button>
        <strong>${new Date(y, m, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}</strong>
        <button type="button" data-nav="1" aria-label="Mois suivant">›</button></div>
      <div class="dp-grid">${['lu', 'ma', 'me', 'je', 've', 'sa', 'di'].map((x) => `<span class="dp-wd">${x}</span>`).join('')}${cells.join('')}</div>
      <div class="dp-sum small">${days.length ? `<strong>${days.length} jour${days.length > 1 ? 's' : ''}</strong> : ${esc(daysLabel(days))}
        <button type="button" class="link" data-clear>Tout effacer</button>` : `<span class="muted">Clique les jours de la session.${opts.weekend ? ' Un clic sur un samedi ajoute aussi le dimanche.' : ''}</span>`}</div></div>`;
    el.querySelectorAll('[data-nav]').forEach((b) => b.addEventListener('click', () => { view = new Date(view.getFullYear(), view.getMonth() + Number(b.dataset.nav), 1, 12); draw(); }));
    el.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
      const k = b.dataset.day;
      if (days.includes(k)) days = days.filter((x) => x !== k);
      else {
        days.push(k);
        // un samedi ajouté seul entraîne son dimanche : nos sessions tiennent sur des week-ends entiers
        const d = new Date(`${k}T12:00:00`);
        const sun = iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1));
        if (opts.weekend && d.getDay() === 6 && !days.includes(sun)) days.push(sun);
      }
      days = [...new Set(days)].sort();
      onChange(days); draw();
    }));
    el.querySelector('[data-clear]')?.addEventListener('click', () => { days = []; onChange(days); draw(); });
  };
  draw();
  return { get: () => days };
}

// Envoi d'un fichier joint à une station. Les photos sont réduites dans le navigateur (2000 px, JPEG) :
// une radio prise au téléphone pèse alors quelques centaines de Ko au lieu de plusieurs Mo.
export async function uploadStationFile(stationId, file) {
  let blob = file;
  let type = file.type;
  if (/^image\/(jpeg|png|webp|heic|heif)$/.test(type) || (type.startsWith('image/') && type !== 'image/svg+xml')) {
    const bmp = await createImageBitmap(file).catch(() => null);
    if (bmp && (file.size > 900000 || Math.max(bmp.width, bmp.height) > 2000 || !/^image\/(jpeg|png|webp)$/.test(type))) {
      const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height); g.drawImage(bmp, 0, 0, cv.width, cv.height);
      blob = await new Promise((ok) => cv.toBlob(ok, 'image/jpeg', 0.85));
      type = 'image/jpeg';
    }
  }
  const res = await fetch(`/api/stations/${stationId}/files`, {
    method: 'POST', body: blob, credentials: 'same-origin',
    headers: { 'Content-Type': type, 'X-Filename': encodeURIComponent(file.name.replace(/\.(heic|heif|png|webp)$/i, type === 'image/jpeg' ? '.jpg' : '.$1')) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Erreur ${res.status}`);
  return data;
}

// Aperçu d'un document joint : vignette pour une image, lien pour un PDF
export function fileThumb(d, big = false) {
  if (!d?.file_id) return '';
  return /^image\//.test(d.file_mime || '') ? `<a href="/api/files/${d.file_id}" target="_blank" rel="noopener"><img src="/api/files/${d.file_id}" alt="${esc(d.nom || d.file_name || 'Document')}" loading="lazy" ${big ? 'class="big"' : ''}></a>`
    : `<a class="btn small" href="/api/files/${d.file_id}" target="_blank" rel="noopener">Ouvrir le PDF</a>`;
}
