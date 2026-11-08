// Étiquettes adhésives des candidats, à coller sur la blouse à l'émargement : numéro en grand, prénom,
// circuit de départ en couleur et un QR code qui ouvre directement la grille du candidat chez l'évaluateur.
import { api, esc, setTitle, longDate } from './ui.js';
import { rotationFor, seriesTimes, frTime } from './planning-shared.js';

// Formats A4 courants (dimensions en millimètres)
const FORMATS = {
  L7160: { label: '21 par page, 63,5 × 38,1 mm (Avery L7160 ou équivalent)', cols: 3, rows: 7, w: 63.5, h: 38.1, top: 15.15, left: 7.25, gapX: 2.5, gapY: 0 },
  L7163: { label: '14 par page, 99,1 × 38,1 mm (Avery L7163 ou équivalent)', cols: 2, rows: 7, w: 99.1, h: 38.1, top: 15.15, left: 4.65, gapX: 2.5, gapY: 0 },
  L7165: { label: '8 par page, 99,1 × 67,7 mm (Avery L7165 ou équivalent, badges)', cols: 2, rows: 4, w: 99.1, h: 67.7, top: 13.1, left: 4.65, gapX: 2.5, gapY: 0 },
};
const opts = { day: '', series: '', format: 'L7163', perSeries: true };

export async function labelsView(app, exam) {
  const [D, qr] = await Promise.all([api(`/exams/${exam.id}/planning`), import('./vendor/qrcode.mjs')]);
  const P = D.planning;
  const rot = rotationFor(D.slots);
  setTitle(`Étiquettes, ${exam.name}`);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
  const days = P.days.map((d) => d.date);
  if (!opts.day || (opts.day !== 'all' && !days.includes(opts.day))) opts.day = days.includes(today) ? today : days[0] || 'all';
  const qrSvg = (text) => { const q = qr.default(0, 'M'); q.addData(text); q.make(); return q.createSvgTag({ cellSize: 2, margin: 0, scalable: true }); };

  const draw = () => {
    const F = FORMATS[opts.format];
    const list = D.candidates.filter((c) => c.status !== 'annule' && c.number && c.seat && (opts.day === 'all' || c.day === opts.day) && (!opts.series || String(c.series) === opts.series))
      .sort((a, b) => a.day.localeCompare(b.day) || a.series - b.series || a.seat - b.seat);
    // une planche par série : chaque série a ses étiquettes, faciles à distribuer
    const groups = [];
    for (const c of list) {
      const key = opts.perSeries ? `${c.day}|${c.series}` : 'all';
      let g = groups.find((x) => x.key === key);
      if (!g) { g = { key, day: c.day, series: c.series, items: [] }; groups.push(g); }
      g.items.push(c);
    }
    const per = F.cols * F.rows;
    const pages = groups.flatMap((g) => { const out = []; for (let i = 0; i < g.items.length; i += per) out.push({ ...g, items: g.items.slice(i, i + per) }); return out; });
    const label = (c) => {
      const first = rot.at(c.seat, 1) || '';
      const circ = /^B/i.test(first) ? 'b' : 'a';
      const ser = P.days.find((d) => d.date === c.day)?.series[c.series - 1];
      const start = ser ? frTime(seriesTimes(P, ser, D.slots.length).start) : '';
      return `<div class="lab c-${circ}"><div class="lab-txt"><div class="lab-no">${esc(c.number)}</div>
        <div class="lab-name">${esc(c.first_name)} ${esc((c.last_name || '').slice(0, 1))}.</div>
        <div class="lab-meta">Série ${c.series}${start ? ` · ${start}` : ''} · départ ${esc(first)}</div></div>
        <div class="lab-qr">${qrSvg(`${location.origin}/#/q/${c.number}`)}</div></div>`;
    };
    app.innerHTML = `
      <div class="no-print" style="margin-bottom:14px">
        <a class="back" href="#/admin/session/${exam.id}/accueil">Accueil</a>
        <h1>Étiquettes des candidats</h1>
        <p class="lede">À remettre à l'émargement et à coller sur la blouse. Le numéro se lit de loin, la couleur dit le circuit de départ (bleu A, turquoise B), et le QR code ouvre directement la grille du candidat sur le téléphone de l'évaluateur.</p>
        <div class="row" style="gap:10px;align-items:flex-end">
          <div><label for="l-day" style="margin-top:0">Jour</label><select id="l-day">${days.map((d) => `<option value="${d}" ${d === opts.day ? 'selected' : ''}>${esc(longDate(d))}</option>`).join('')}<option value="all" ${opts.day === 'all' ? 'selected' : ''}>Tous les jours</option></select></div>
          <div><label for="l-ser" style="margin-top:0">Série</label><select id="l-ser"><option value="">Toutes</option>${[1, 2, 3, 4, 5, 6].filter((n) => P.days.some((d) => d.series[n - 1])).map((n) => `<option value="${n}" ${String(n) === opts.series ? 'selected' : ''}>Série ${n}</option>`).join('')}</select></div>
          <div><label for="l-fmt" style="margin-top:0">Planche</label><select id="l-fmt">${Object.entries(FORMATS).map(([k, f]) => `<option value="${k}" ${k === opts.format ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}</select></div>
          <label class="check" style="margin:0 0 8px"><input type="checkbox" id="l-per" ${opts.perSeries ? 'checked' : ''}><span>Une planche par série</span></label>
          <button class="primary" data-print ${list.length ? '' : 'disabled'}>Imprimer ${list.length} étiquette${list.length > 1 ? 's' : ''}</button></div>
        <p class="small muted">Impression à 100 % (« taille réelle », sans mise à l'échelle), marges à zéro. Fais un essai sur une feuille blanche, superposée à une planche, avant d'imprimer sur les étiquettes. Seuls les candidats numérotés apparaissent.</p>
      </div>
      ${list.length ? '' : '<p class="alert info no-print">Aucun candidat numéroté pour ce choix. La numérotation se fait dans l\'onglet Candidats.</p>'}
      <style>
        @page { size: A4; margin: 0; }
        .sheet { width: 210mm; height: 297mm; box-sizing: border-box; padding: ${F.top}mm 0 0 ${F.left}mm; display: grid;
          grid-template-columns: repeat(${F.cols}, ${F.w}mm); grid-auto-rows: ${F.h}mm; column-gap: ${F.gapX}mm; row-gap: ${F.gapY}mm; background: #fff; margin: 0 auto 18px; box-shadow: 0 2px 12px rgba(0,0,0,.12); break-after: page; }
        .lab { box-sizing: border-box; height: ${F.h}mm; padding: 3mm 3mm 3mm 5mm; display: flex; align-items: center; gap: 2.5mm; position: relative; overflow: hidden; outline: 1px dashed #e3e5ee; color: #191a3f; font-family: inherit; }
        .lab::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 2.6mm; }
        .lab.c-a::before { background: #2d2f84; } .lab.c-b::before { background: #00a09a; }
        .lab-txt { flex: 1; min-width: 0; }
        .lab-no { font-weight: 800; font-size: ${F.h > 50 ? 30 : F.w > 80 ? 24 : 17}pt; line-height: 1; letter-spacing: .01em; white-space: nowrap; }
        .lab.c-a .lab-no { color: #2d2f84; } .lab.c-b .lab-no { color: #00807b; }
        .lab-name { font-weight: 700; font-size: ${F.h > 50 ? 16 : 11}pt; margin-top: 1.2mm; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
        .lab-meta { font-size: 7.5pt; color: #4a4c68; margin-top: .8mm; white-space: nowrap; }
        .lab-qr { width: ${F.h > 50 ? 30 : 22}mm; height: ${F.h > 50 ? 30 : 22}mm; flex: none; } .lab-qr svg { width: 100%; height: 100%; display: block; }
        .sheet-head { font-size: 9pt; color: #8c8ea6; text-align: center; margin: 0 auto 4px; width: 210mm; }
        @media print { body * { visibility: hidden; } .sheets, .sheets * { visibility: visible; } .sheets { position: absolute; left: 0; top: 0; }
          .sheet { box-shadow: none; margin: 0; } .lab { outline: none; } .sheet-head { display: none; } header, nav, .no-print { display: none !important; } }
      </style>
      <div class="sheets">${pages.map((pg) => `<div class="sheet-head">${opts.perSeries ? `${esc(longDate(pg.day))}, série ${pg.series}` : ''}</div>
        <div class="sheet">${pg.items.map(label).join('')}</div>`).join('')}</div>`;
    app.querySelector('#l-day').addEventListener('change', (e) => { opts.day = e.target.value; draw(); });
    app.querySelector('#l-ser').addEventListener('change', (e) => { opts.series = e.target.value; draw(); });
    app.querySelector('#l-fmt').addEventListener('change', (e) => { opts.format = e.target.value; draw(); });
    app.querySelector('#l-per').addEventListener('change', (e) => { opts.perSeries = e.target.checked; draw(); });
  };
  draw();
}
