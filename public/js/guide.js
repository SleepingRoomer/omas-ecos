// Le déroulé d'une session dans l'espace de chacun : un petit film animé, l'essentiel à retenir et les questions fréquentes,
// adaptés au profil (étudiant, évaluateur, PS ou PSS, accueil et logistique). Même film que la page « Une session étape par étape ».
import { esc } from './ui.js';

// ---------- Le film : une scène animée par grande étape ----------
// Chaque scène est un SVG régénéré à chaque lecture, ce qui relance ses animations (CSS et SMIL).
const C = { a: '#2d2f84', b: '#00a09a', bi: '#00807b', ps: '#6b4f9e', team: '#b9770e', ink: '#191a3f', ink2: '#4a4c68', ink3: '#8c8ea6', line: '#e3e5ee', soft: '#f5f6fa', lav: '#abacce', ok: '#2e9e5b', no: '#c4473a' };
const an = (cls, d, extra = '') => `class="an ${cls}" style="animation-delay:${d}s;${extra}"`;
const T = (x, y, txt, o = {}) => `<text x="${x}" y="${y}" font-size="${o.s || 12}" font-weight="${o.w || 600}" fill="${o.c || C.ink2}" text-anchor="${o.a || 'middle'}" ${o.attr || ''}>${txt}</text>`;
const av = (x, y, col, label, d = 0, cls = 'pop') => `<g ${an(cls, d)}><circle cx="${x}" cy="${y - 20}" r="11" fill="${col}"/><rect x="${x - 17}" y="${y - 6}" width="34" height="26" rx="13" fill="${col}"/>${label ? T(x, y + 38, label, { s: 11.5 }) : ''}</g>`;
const check = (x, y, d, col = C.ok) => `<g ${an('pop', d)}><circle cx="${x}" cy="${y}" r="11" fill="${col}"/><path d="M${x - 5} ${y} l3.5 3.5 l6.5 -7" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="round"/></g>`;
const show = (b) => `<set attributeName="opacity" to="1" begin="${b}s" fill="freeze"/>`;
const hide = (b) => `<set attributeName="opacity" to="0" begin="${b}s" fill="freeze"/>`;
const move = (path, b, dur) => `<animateMotion path="${path}" begin="${b}s" dur="${dur}s" fill="freeze" calcMode="spline" keyTimes="0;1" keySplines=".4 0 .2 1"/>`;
const doc = (w = 34, h = 42) => `<rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="5" fill="#fff" stroke="${C.a}" stroke-width="2"/><path d="M${-w / 2 + 7} ${-h / 2 + 11}h${w - 14}M${-w / 2 + 7} ${-h / 2 + 19}h${w - 14}M${-w / 2 + 7} ${-h / 2 + 27}h${w - 20}" stroke="${C.lav}" stroke-width="2.5" stroke-linecap="round"/>`;
const envelope = () => `<rect x="-15" y="-10" width="30" height="20" rx="3" fill="#fff" stroke="${C.a}" stroke-width="2"/><path d="M-15 -10 L0 2 L15 -10" fill="none" stroke="${C.a}" stroke-width="2"/>`;
const phoneShape = (x, y, w = 70, h = 120) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" stroke="${C.line}" stroke-width="2.5"/><rect x="${x + w / 2 - 12}" y="${y + 7}" width="24" height="4" rx="2" fill="${C.line}"/>`;
const qrMini = (x, y, s = 30, d = 0) => { const c = s / 5; let out = `<g ${an('pop', d)}><rect x="${x}" y="${y}" width="${s}" height="${s}" fill="#fff" stroke="${C.ink}" stroke-width="1"/>`; [0, 1, 3, 5, 7, 8, 11, 13, 14, 16, 17, 19, 21, 23, 24].forEach((k) => { out += `<rect x="${x + (k % 5) * c + .5}" y="${y + Math.floor(k / 5) * c + .5}" width="${c - 1}" height="${c - 1}" fill="${C.ink}"/>`; }); return out + '</g>'; };
const rbox = (x, y, w, h, fill, stroke = 'none', r = 12) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;

export const SCENES = [
  { id: 'redaction', p: 1, title: 'Rédaction et relecture', dur: 8,
    text: 'Le rédacteur remplit la station dans INES, puis elle passe de main en main : relecture pair, relecture experte, validation par les organisateurs. Chacun est prévenu par e-mail quand c\'est son tour.',
    svg: () => {
      let s = av(80, 150, C.a, 'Rédacteur', 0) + av(300, 150, C.a, 'Relecteur pair', .2) + av(480, 150, C.a, 'Relecteur expert', .3) + av(690, 150, C.team, 'Organisateurs', .4);
      s += `<g ${an('fade', .5)}><rect x="112" y="92" width="52" height="64" rx="6" fill="#fff" stroke="${C.a}" stroke-width="2"/>`;
      [0, 1, 2, 3, 4].forEach((i) => { s += `<rect x="120" y="${104 + i * 10}" width="${i === 4 ? 20 : 36}" height="4" rx="2" fill="${i === 3 ? C.b : C.lav}" ${an('grow', .8 + i * .35)}/>`; });
      s += '</g>';
      s += `<path d="M166 100 C 210 60, 250 60, 284 104" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="5 6" ${an('fade', 2.6)}/>`;
      s += `<path d="M320 110 C 370 70, 420 70, 462 110" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="5 6" ${an('fade', 4)}/>`;
      s += `<path d="M500 110 C 560 60, 620 60, 672 110" fill="none" stroke="${C.line}" stroke-width="2" stroke-dasharray="5 6" ${an('fade', 5.4)}/>`;
      s += `<g ${an('fade', 5.2)}><path d="M500 160 C 530 200, 550 205, 566 205" fill="none" stroke="${C.ps}" stroke-width="1.5" stroke-dasharray="3 5"/><circle cx="588" cy="205" r="20" fill="#fff" stroke="${C.ps}" stroke-width="2" stroke-dasharray="4 4"/><path d="M582 198 l12 7 l-12 7z" fill="${C.ps}"/>${T(588, 242, 'Test par un externe', { s: 10.5, c: C.ps })}${T(588, 256, '(facultatif)', { s: 10.5, c: C.ps, w: 500 })}</g>`;
      s += `<g opacity="0">${doc()}${show(2.8)}${move('M138 124 C 200 50, 240 50, 300 96', 2.8, 1)}${move('M300 96 C 370 50, 420 50, 480 96', 4.2, 1)}${move('M480 96 C 560 40, 620 40, 690 72', 5.6, 1)}</g>`;
      s += check(325, 96, 3.9) + check(505, 96, 5.3);
      s += `<g ${an('stamp', 6.8)}><rect x="640" y="204" width="108" height="34" rx="8" fill="#fff" stroke="${C.ok}" stroke-width="3"/>${T(694, 227, 'VALIDÉE', { s: 15, w: 800, c: C.ok })}</g>`;
      return s;
    } },
  { id: 'billetterie', p: 1, title: 'Billetterie', dur: 7,
    text: 'Les étudiants prennent leur billet sur HelloAsso. Les organisateurs importent l\'export dans INES : les inscrits arrivent, et un second import ajoute les nouveaux et annule les billets remboursés.',
    svg: () => {
      let s = rbox(40, 70, 170, 170, C.soft) + T(125, 100, 'HelloAsso', { s: 15, w: 800, c: C.ink });
      [0, 1, 2].forEach((i) => { s += `<g transform="translate(${70 + i * 8} ${130 + i * 8})"><rect width="100" height="44" rx="8" fill="#fff" stroke="${C.line}" stroke-width="2"/><path d="M70 0v44" stroke="${C.line}" stroke-dasharray="3 3"/>${T(35, 27, 'Billet', { s: 11 })}</g>`; });
      s += rbox(500, 40, 230, 230, '#fff', C.line) + T(615, 68, 'INES · Candidats', { s: 13, w: 800, c: C.a });
      const names = ['Inès B.', 'Hugo M.', 'Léa D.', 'Sami K.', 'Nora T.', 'Yanis R.'];
      names.forEach((n, i) => {
        const d = .6 + i * .45;
        s += `<g opacity="0"><rect x="-26" y="-14" width="52" height="28" rx="6" fill="${C.b}"/>${T(0, 5, '🎟', { s: 13 })}${show(d)}${move(`M190 160 C 300 ${80 + i * 10}, 400 ${90 + i * 20}, 540 ${96 + i * 26}`, d, .7)}${hide(d + .75)}</g>`;
        s += `<g ${an('fadeR', d + .7)}><rect x="516" y="${84 + i * 26}" width="198" height="22" rx="6" fill="${C.soft}"/>${T(528, 99 + i * 26, n, { s: 11.5, a: 'start', c: C.ink })}${T(704, 99 + i * 26, 'inscrit', { s: 10.5, a: 'end', c: C.bi })}</g>`;
      });
      s += `<g ${an('fade', 4.6)}><path d="M524 ${95 + 2 * 26}h70" stroke="${C.no}" stroke-width="2.5"/><rect x="630" y="${86 + 2 * 26}" width="80" height="18" fill="${C.soft}"/>${T(704, 99 + 2 * 26, 'remboursé', { s: 10.5, a: 'end', c: C.no, w: 700 })}</g>`;
      [0, 1].forEach((j) => { const d = 3.9 + j * .35; s += `<g opacity="0"><rect x="-26" y="-14" width="52" height="28" rx="6" fill="${C.a}"/>${T(0, 5, '🎟', { s: 13 })}${show(d)}${move(`M190 160 C 300 ${200 + j * 20}, 420 ${240}, 560 256`, d, .7)}${hide(d + .75)}</g>`; });
      s += `<g ${an('pop', 5)}>${rbox(560, 244, 110, 24, C.a, 'none', 12)}${T(615, 260, '62 inscrits', { s: 12, w: 800, c: '#fff' })}</g>`;
      s += `<g ${an('pop', 3.6)}>${rbox(60, 252, 130, 26, '#fff', C.line, 13)}${T(125, 269, 'Second export', { s: 11, w: 700, c: C.ink })}</g>`;
      return s;
    } },
  { id: 'billetterie', p: 1, title: 'Vœux et attribution', dur: 8,
    text: 'Chaque étudiant classe les créneaux : idéal, possible ou impossible. L\'algorithme répartit tout le monde d\'un coup, en donnant le plus d\'idéaux possible et jamais un créneau impossible.',
    svg: () => {
      const stu = [['ok', 'mid', 'no'], ['mid', 'ok', 'mid'], ['no', 'mid', 'ok'], ['ok', 'no', 'mid'], ['mid', 'mid', 'ok'], ['mid', 'ok', 'no']];
      const col = { ok: C.ok, mid: C.lav, no: C.no };
      const assign = [0, 1, 2, 0, 2, 1];
      let s = T(110, 30, 'Les vœux', { s: 12, w: 800, c: C.ink3 }) + T(640, 30, 'Les créneaux', { s: 12, w: 800, c: C.ink3 });
      stu.forEach((w, i) => {
        const y = 58 + i * 40;
        s += `<g ${an('pop', .2 + i * .15)}><circle cx="60" cy="${y}" r="13" fill="${C.b}"/>${T(60, y + 4, String(i + 1), { s: 11, c: '#fff', w: 800 })}</g>`;
        w.forEach((v, k) => { s += `<circle cx="${92 + k * 22}" cy="${y}" r="7" fill="${col[v]}" ${an('pop', 1 + i * .12 + k * .06)}/>`; });
      });
      s += `<g ${an('pop', 2.3)}><g class="gear"><circle cx="380" cy="160" r="30" fill="${C.a}"/>${[0, 45, 90, 135, 180, 225, 270, 315].map((r) => `<rect x="375" y="120" width="10" height="16" rx="3" fill="${C.a}" transform="rotate(${r} 380 160)"/>`).join('')}<circle cx="380" cy="160" r="11" fill="#fff"/></g>${T(380, 220, 'Attribution', { s: 12, w: 800, c: C.a })}</g>`;
      ['Sam. matin', 'Sam. après-midi', 'Dim. matin'].forEach((n, k) => {
        const y = 70 + k * 72;
        s += `<g ${an('pop', .4 + k * .2)}>${rbox(580, y - 24, 140, 52, '#fff', C.line)}${T(650, y - 4, n, { s: 11.5, c: C.ink })}</g>`;
        [0, 1].forEach((j) => { s += `<rect x="${618 + j * 34}" y="${y + 6}" width="28" height="12" rx="4" fill="${C.soft}"/>`; });
      });
      const filled = [0, 0, 0];
      stu.forEach((w, i) => {
        const y = 58 + i * 40; const k = assign[i]; const ty = 70 + k * 72; const j = filled[k]++;
        const isIdeal = w[k] === 'ok';
        s += `<path d="M162 ${y} C 300 ${y}, 460 ${ty + 12}, ${618 + j * 34} ${ty + 12}" fill="none" stroke="${isIdeal ? C.ok : C.lav}" stroke-width="2.5" pathLength="1" ${an('draw', 3.8 + i * .3, '--l:1')}/>`;
        s += `<rect x="${618 + j * 34}" y="${ty + 6}" width="28" height="12" rx="4" fill="${C.b}" ${an('pop', 4.3 + i * .3)}/>`;
      });
      s += `<g ${an('pop', 6.4)}>${rbox(270, 250, 220, 30, C.ok, 'none', 15)}${T(380, 270, '5 idéaux sur 6 · 0 impossible', { s: 12, w: 800, c: '#fff' })}</g>`;
      return s;
    } },
  { id: 'recrutement', p: 1, title: 'Recrutement', dur: 7,
    text: 'Bénévoles et évaluateurs s\'inscrivent par leur lien et reçoivent un code personnel. Les organisateurs les placent dans le planning des salles, où une étoile signale la discipline préférée.',
    svg: () => {
      let s = `<g ${an('pop', .1)}>${rbox(40, 30, 150, 30, C.soft, 'none', 15)}${T(115, 50, 'Lien bénévoles', { s: 11.5, c: C.ink })}</g><g ${an('pop', .25)}>${rbox(40, 70, 150, 30, C.soft, 'none', 15)}${T(115, 90, 'Lien évaluateurs', { s: 11.5, c: C.ink })}</g>`;
      const rooms = ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'];
      rooms.forEach((r, i) => {
        const x = 250 + (i % 5) * 98; const y = 40 + Math.floor(i / 5) * 128;
        s += `${rbox(x, y, 86, 108, C.soft)}<rect x="${x + 8}" y="${y + 8}" width="30" height="20" rx="5" fill="${i < 5 ? C.a : C.b}"/>${T(x + 23, y + 22, r, { s: 11, w: 800, c: '#fff' })}`;
        const d = i < 6 ? .7 + i * .35 : 4.4 + (i - 6) * .15;
        s += `<g ${an('drop', d)}><circle cx="${x + 30}" cy="${y + 54}" r="8" fill="${C.a}"/><rect x="${x + 18}" y="${y + 64}" width="24" height="18" rx="9" fill="${C.a}"/></g>`;
        s += `<g ${an('drop', d + .15)}><circle cx="${x + 60}" cy="${y + 54}" r="8" fill="${C.ps}"/><rect x="${x + 48}" y="${y + 64}" width="24" height="18" rx="9" fill="${C.ps}"/></g>`;
        if ([0, 2, 3, 6, 8].includes(i)) s += `<text x="${x + 76}" y="${y + 24}" font-size="15" fill="${C.team}" text-anchor="middle" ${an('pop', d + .5)}>★</text>`;
      });
      s += `<g ${an('press', 3.9)}>${rbox(40, 200, 170, 34, C.a, 'none', 17)}${T(125, 222, 'Compléter automatiquement', { s: 11, w: 700, c: '#fff' })}</g>`;
      s += `<g ${an('fade', 3.9)}><circle cx="125" cy="217" r="18" fill="none" stroke="${C.a}" stroke-width="2" class="ripple"/></g>`;
      s += T(115, 140, '● évaluateur', { s: 11, c: C.a, a: 'middle' }) + T(115, 160, '● PS ou PSS', { s: 11, c: C.ps, a: 'middle' });
      return s;
    } },
  { id: 'convocations', p: 1, title: 'Convocations et rappels', dur: 7,
    text: 'Un clic envoie les convocations, avec l\'heure, la série et le QR code d\'émargement. La veille en fin d\'après-midi, INES envoie seul un rappel à tous ceux qui viennent.',
    svg: () => {
      let s = `<g ${an('pop', .1)}>${rbox(40, 100, 140, 90, C.a)}${T(110, 140, 'INES', { s: 22, w: 800, c: '#fff' })}${T(110, 164, 'Convocations', { s: 11, c: '#cfd0ee' })}</g>`;
      [0, 1, 2].forEach((i) => {
        const x = 430 + i * 105;
        s += `<g ${an('pop', .3 + i * .1)}>${phoneShape(x, 70, 80, 150)}</g>`;
        const d = .9 + i * .4;
        s += `<g opacity="0">${envelope()}${show(d)}${move(`M180 140 C 280 ${60 + i * 20}, 360 ${80 + i * 10}, ${x + 40} 120`, d, .8)}${hide(d + .85)}</g>`;
        s += `<g ${an('fade', d + .9)}>${T(x + 40, 104, '8 h 40', { s: 12, w: 800, c: C.ink })}${T(x + 40, 120, `Série ${i + 1}`, { s: 10, c: C.ink3 })}</g>${qrMini(x + 25, 130, 30, d + 1)}`;
        s += `<g ${an('slideDown', 5.2 + i * .15)}>${rbox(x - 6, 52, 92, 30, C.team, 'none', 10)}${T(x + 40, 71, 'C\'est demain', { s: 10.5, w: 800, c: '#fff' })}</g>`;
      });
      s += `<g ${an('pop', 3.8)}>${rbox(210, 226, 150, 40, C.soft, 'none', 20)}${T(285, 251, 'J-1 · 17 h', { s: 14, w: 800, c: C.team })}</g>`;
      s += `<g ${an('shake', 4.3)}><path d="M285 196 a14 14 0 0 1 14 14 v10 l5 5 h-38 l5 -5 v-10 a14 14 0 0 1 14 -14z" fill="${C.team}"/><circle cx="285" cy="229" r="4" fill="${C.team}"/></g>`;
      return s;
    } },
  { id: 'montage', p: 2, title: 'La veille', dur: 6,
    text: 'Chaque salle est montée comme le jour J et cochée « Salle prête » dans INES. Les étiquettes sont rangées par série, la signalétique posée.',
    svg: () => {
      let s = '';
      ['A1', 'A2', 'A3', 'A4', 'A5', 'B1', 'B2', 'B3', 'B4', 'B5'].forEach((r, i) => {
        const x = 40 + (i % 5) * 140; const y = 30 + Math.floor(i / 5) * 130;
        s += `${rbox(x, y, 124, 112, '#fff', C.line)}<rect x="${x + 10}" y="${y + 10}" width="30" height="20" rx="5" fill="${i < 5 ? C.a : C.b}"/>${T(x + 25, y + 24, r, { s: 11, w: 800, c: '#fff' })}`;
        const d = .3 + i * .4;
        s += `<rect x="${x + 50}" y="${y + 12}" width="22" height="28" rx="3" fill="#fff" stroke="${C.ink3}" stroke-width="1.5" ${an('pop', d)}/>`;
        s += `<rect x="${x + 14}" y="${y + 48}" width="96" height="22" rx="5" fill="${C.soft}" ${an('grow', d + .1)}/>`;
        s += `<g ${an('pop', d + .25)}><rect x="${x + 82}" y="${y + 12}" width="28" height="22" rx="4" fill="#f9eeda"/><circle cx="${x + 90}" cy="${y + 20}" r="2.5" fill="${C.team}"/><circle cx="${x + 100}" cy="${y + 25}" r="2.5" fill="${C.team}"/></g>`;
        s += `<g ${an('fade', d + .35)}>${T(x + 62, y + 98, 'Salle prête', { s: 11, c: C.ok, w: 700 })}</g>` + check(x + 104, y + 94, d + .35);
      });
      return s;
    } },
  { id: 'rotation', p: 3, title: 'Le jour J', dur: 9,
    text: 'À l\'accueil, on scanne le QR code et on colle l\'étiquette. Puis chaque candidat fait les cinq salles d\'un circuit, change à la pause, et finit par les cinq de l\'autre.',
    svg: () => {
      let s = `${phoneShape(30, 70, 70, 120)}${qrMini(50, 110, 30, .2)}<rect x="38" y="105" width="54" height="3" fill="${C.b}" ${an('scan', .6)}/>`;
      s += `<g ${an('pop', 1.4)}><rect x="20" y="210" width="96" height="44" rx="8" fill="#fff" stroke="${C.line}" stroke-width="2"/><rect x="20" y="210" width="8" height="44" rx="3" fill="${C.a}"/>${T(70, 230, 'J1-S2-04', { s: 12, w: 800, c: C.ink })}${T(70, 246, 'Yasmine', { s: 10.5 })}</g>`;
      s += `<g ${an('fade', 1)}>${T(68, 50, 'Accueil', { s: 12, w: 800, c: C.ink3 })}</g>`;
      const RA = [0, 1, 2, 3, 4].map((k) => [210 + k * 108, 80]); const RB = [0, 1, 2, 3, 4].map((k) => [210 + k * 108, 210]);
      s += rbox(180, 40, 548, 80, C.a + '14') + rbox(180, 170, 548, 80, C.b + '18');
      s += T(196, 34, 'Circuit A', { s: 11.5, w: 800, c: C.a, a: 'start' }) + T(196, 164, 'Circuit B', { s: 11.5, w: 800, c: C.bi, a: 'start' });
      RA.forEach(([x, y], k) => { s += `<rect x="${x}" y="${y - 30}" width="80" height="60" rx="10" fill="#fff"/>${T(x + 40, y - 12, 'A' + (k + 1), { s: 11, w: 800, c: C.a })}`; });
      RB.forEach(([x, y], k) => { s += `<rect x="${x}" y="${y - 30}" width="80" height="60" rx="10" fill="#fff"/>${T(x + 40, y - 12, 'B' + (k + 1), { s: 11, w: 800, c: C.bi })}`; });
      // 10 candidats : places 1 à 5 sur A puis B, 6 à 10 sur B puis A ; 5 tours, pause, 5 tours
      const t0 = 2.2; const step = .62; const pause = .8;
      for (let c = 0; c < 10; c++) {
        const first = c < 5 ? RA : RB; const second = c < 5 ? RB : RA; const k0 = c % 5;
        const pts = [];
        for (let r = 0; r < 5; r++) pts.push(first[(k0 + r) % 5]);
        for (let r = 0; r < 5; r++) pts.push(second[(k0 + r) % 5]);
        const times = []; const vals = [];
        pts.forEach(([x, y], r) => { const t = t0 + r * step + (r >= 5 ? pause : 0); times.push(t); vals.push(`${x + 40} ${y + 12}`); });
        const total = 9; const kt = [0, ...times.map((t) => (t / total).toFixed(3)), 1];
        const vv = [vals[0], ...vals, vals[vals.length - 1]];
        s += `<g opacity="0">${show(t0 - .3)}<circle r="10" fill="${c < 5 ? C.a : C.b}" stroke="#fff" stroke-width="2"/>${T(0, 4, String(c + 1), { s: 10, w: 800, c: '#fff' })}<animateTransform attributeName="transform" type="translate" dur="${total}s" fill="freeze" calcMode="discrete" keyTimes="${kt.join(';')}" values="${vv.join(';')}"/></g>`;
      }
      s += `<g opacity="0">${show(t0 + 5 * step - .1)}${hide(t0 + 5 * step + pause - .05)}${rbox(388, 128, 132, 32, C.lav, 'none', 16)}${T(454, 149, 'Pause, on change', { s: 11.5, w: 800, c: C.ink })}</g>`;
      return s;
    } },
  { id: 'evaluateur', p: 3, title: 'Les grilles', dur: 7,
    text: 'Chaque évaluateur note sur son téléphone : 1 ou 0 par item, la communication par quart de point. Sans réseau, la grille attend et part dès que la connexion revient. Les notes se calculent seules.',
    svg: () => {
      let s = '';
      [0, 1, 2, 3].forEach((i) => {
        const x = 30 + i * 88; const y = 60;
        s += `<g ${an('pop', .1 + i * .1)}>${phoneShape(x, y, 64, 110)}</g>`;
        [0, 1, 2].forEach((k) => { s += `<rect x="${x + 10}" y="${y + 26 + k * 16}" width="30" height="8" rx="3" fill="${C.soft}"/><circle cx="${x + 50}" cy="${y + 30 + k * 16}" r="5" fill="${(i + k) % 3 ? C.ok : C.no}" ${an('pop', .5 + i * .1 + k * .15)}/>`; });
        const off = i === 2;
        if (off) s += `<g ${an('fade', 1)}>${T(x + 32, y + 92, 'hors ligne', { s: 9.5, c: C.no, w: 700 })}</g><g ${an('fade', 3.4)}><rect x="${x + 6}" y="${y + 82}" width="52" height="14" fill="#fff"/>${T(x + 32, y + 92, 'réseau ok', { s: 9.5, c: C.ok, w: 700 })}</g>`;
        const d = off ? 3.6 : 1.4 + i * .3;
        s += `<g opacity="0"><rect x="-12" y="-14" width="24" height="28" rx="4" fill="${C.a}"/><path d="M-6 -6h12M-6 0h12M-6 6h8" stroke="#fff" stroke-width="2"/>${show(d)}${move(`M${x + 32} ${y + 40} C ${x + 120} 0, 420 40, 450 130`, d, .8)}${hide(d + .85)}</g>`;
      });
      s += `<g ${an('pop', .3)}>${rbox(420, 100, 90, 70, C.a)}${T(465, 141, 'INES', { s: 18, w: 800, c: '#fff' })}</g>`;
      ['A1', 'A2', 'A3', 'A4', 'A5'].forEach((st, i) => {
        const h = [96, 70, 120, 58, 84][i]; const x = 556 + i * 36;
        s += `<rect x="${x}" y="${230 - h}" width="24" height="${h}" rx="5" fill="${i % 2 ? C.b : C.a}" ${an('growy', 2.4 + i * .25)}/>${T(x + 12, 248, st, { s: 10.5, w: 700 })}`;
      });
      s += `<g ${an('pop', 5)}>${rbox(560, 30, 170, 40, C.soft, 'none', 12)}${T(645, 55, 'Note sur 20, rang', { s: 12, w: 800, c: C.ink })}</g>`;
      return s;
    } },
  { id: 'resultats', p: 4, title: 'Après la session', dur: 8,
    text: 'L\'étudiant voit sa note et son rang. Le détail des grilles s\'ouvre après la dernière série. Une réclamation acceptée corrige la note, et les organisateurs font le bilan des stations.',
    svg: () => {
      let s = `<g ${an('pop', .1)}>${phoneShape(60, 40, 130, 220)}</g>`;
      s += `<g ${an('fade', .5)}>${T(125, 82, 'Mes résultats', { s: 12, w: 800, c: C.ink })}</g>`;
      s += `<g ${an('pop', .9)}>${T(125, 120, '13,4 / 20', { s: 22, w: 800, c: C.a })}${T(125, 140, '12e sur 68', { s: 11 })}</g>`;
      s += `<g ${an('fade', 1.4)}>${rbox(76, 156, 98, 34, C.soft, 'none', 8)}${T(125, 177, 'Détail des grilles', { s: 9.5 })}</g>`;
      s += `<g ${an('fadeOut', 2.8)}><g ${an('pop', 1.6)}><rect x="160" y="150" width="20" height="16" rx="3" fill="${C.ink3}"/><path d="M164 150 v-5 a6 6 0 0 1 12 0 v5" fill="none" stroke="${C.ink3}" stroke-width="2.5"/></g></g>`;
      s += `<g ${an('pop', 3)}>${check(170, 158, 3)}</g>`;
      s += `<g ${an('fade', 2.6)}>${T(125, 212, 'après la dernière série', { s: 9.5, c: C.ok, w: 700 })}</g>`;
      s += av(560, 120, C.team, 'Organisateurs', 3.3);
      s += `<g opacity="0">${show(3.8)}<rect x="-40" y="-16" width="80" height="32" rx="10" fill="#fff" stroke="${C.b}" stroke-width="2"/>${T(0, 5, 'Réclamation', { s: 10.5, w: 700, c: C.bi })}${move('M190 120 C 300 40, 430 40, 520 90', 3.8, 1)}${hide(5)}</g>`;
      s += `<g opacity="0">${show(5.2)}<rect x="-46" y="-16" width="92" height="32" rx="10" fill="${C.ok}"/>${T(0, 5, 'Note corrigée', { s: 10.5, w: 800, c: '#fff' })}${move('M520 130 C 430 200, 300 200, 200 150', 5.2, 1)}${hide(6.3)}</g>`;
      s += `<g ${an('pop', 6.3)}>${T(125, 120, '13,9 / 20', { s: 22, w: 800, c: C.ok, attr: 'paint-order="stroke" stroke="#fff" stroke-width="10"' })}</g>`;
      s += `<g ${an('fade', 6.4)}>${T(690, 70, 'Analyse', { s: 11.5, w: 800, c: C.ink3 })}</g>`;
      [64, 40, 82, 52].forEach((h, i) => { s += `<rect x="${652 + i * 20}" y="${160 - h}" width="14" height="${h}" rx="4" fill="${i % 2 ? C.b : C.a}" ${an('growy', 6.6 + i * .15)}/>`; });
      s += `<g ${an('fade', 7)}>${T(690, 182, 'Bilan des stations', { s: 10.5 })}</g>`;
      return s;
    } },
];

// ---------- contenu par profil ----------
// Scènes du film montrées à chacun (index dans SCENES) : 0 rédaction, 1 billetterie, 2 vœux, 3 recrutement,
// 4 convocations, 5 la veille, 6 le jour J, 7 les grilles, 8 après la session
const FILM = { etudiant: [2, 4, 6, 7, 8], evaluateur: [6, 7, 8], ps: [6, 7], benevole: [5, 6], accueil: [5, 6] };

const essentials = (p, P) => {
  const r = P.rotation_minutes || 10; const pa = P.pause_after || 5; const pm = P.pause_minutes || 10; const db = P.debrief_minutes || 30;
  return {
    etudiant: [
      ['Arrivée', 'à l\'heure de ta convocation, avec ta blouse. On scanne le QR code de ta convocation et on te donne ton étiquette : ton numéro et ton circuit de départ en couleur.'],
      ['Brief', 'en salle d\'attente, l\'étudiant de l\'accueil montre à chacun son circuit et sa salle de départ.'],
      ['Les tours', `${r} minutes par salle. À la sonnerie, tu passes à la suivante. Après ${pa} tours, pause de ${pm} minutes, puis tu changes de circuit dans la salle du même numéro (A2 puis B2).`],
      ['Dans la salle', 'lis la vignette sur la porte avant d\'entrer. Les évaluateurs ne connaissent que ton numéro, pas ton nom.'],
      ['Après', `débrief de ${db} minutes tous ensemble. Ta note et ton rang arrivent ici ; le détail des grilles après la dernière série de la session.`],
    ],
    evaluateur: [
      ['Arrivée', 'une heure avant la première série : café, installation, briefing. Rien à préparer avant.'],
      ['Votre salle', 'ouvrez-la avec votre code personnel (« Ouvrir ma salle ») ou avec la fiche « code de salle » remise au briefing.'],
      ['La grille', 'chaque item observé vaut 1 point, sinon 0, jamais de demi-point. Communication de 0 à 1 par quart de point. Un mot de retour utile pour le candidat.'],
      ['Le bon candidat', 'il n\'a qu\'un numéro : son étiquette, son QR code, et l\'écran « Dans ta salle en ce moment ». S\'il n\'a pas émargé, « Noter absent » apparaît après quelques minutes.'],
      ['Imprévu', 'sans réseau, la grille attend sur le téléphone et part toute seule. Grille papier de secours dans la salle. Les messages des organisateurs s\'affichent en haut de l\'écran.'],
    ],
    ps: [
      ['Arrivée', 'une heure avant la première série. Ta fiche de rôle t\'est donnée au briefing, avec le temps de la lire.'],
      ['Le rôle', 'tu joues pareil pour chaque candidat. Tu donnes une information seulement si on te la demande. Tu ne notes pas.'],
      ['Entre deux tours', `${r} minutes par passage ; pendant que le suivant lit la vignette, tu remets la salle en ordre.`],
      ['En réserve', 'si tu es PS ou PSS de réserve, tu restes près de la table des organisateurs et tu remplaces un absent, script donné sur place.'],
    ],
    benevole: [
      ['Arrivée', 'une heure avant la première série : café, installation, briefing.'],
      ['Accueil', 'émargement en scannant le QR code de la convocation (ou dans la liste), étiquette sur la blouse, puis salle d\'attente.'],
      ['Brief des circuits', 'avant chaque série, l\'écran « Brief des circuits » montre qui commence sur A ou B et dans quelle salle.'],
      ['Chrono', 'un bénévole dédié, pas celui de l\'accueil, lance chaque tour depuis son espace (« Ouvrir le chrono ») : tous les écrans suivent.'],
      ['Imprévu', 'un candidat absent de la liste : on appelle un organisateur. Les messages des organisateurs s\'affichent en haut de l\'écran.'],
    ],
  }[p === 'accueil' ? 'benevole' : p];
};

// Questions fréquentes : f = profils concernés. Vouvoiement pour les évaluateurs.
const FAQ = [
  { f: ['etudiant'], q: 'Qu\'est-ce que je dois apporter ?', a: 'Ta blouse, et ce que précise ta convocation. Le QR code de ta convocation (dans ton espace) sert à l\'émargement.' },
  { f: ['etudiant'], q: 'Comment je sais par où je commence ?', a: 'Ton circuit de départ est en couleur sur ton étiquette (bleu pour A, turquoise pour B) et l\'accueil fait un brief avant chaque série. Ton parcours salle par salle est aussi dans ton espace.' },
  { f: ['etudiant'], q: 'Je ne peux plus venir, ou je serai en retard.', a: 'Si tu ne viens pas, libère ta place depuis ton espace : elle part à la personne suivante sur la liste d\'attente. Un échange de créneau avec un autre étudiant est possible jusqu\'à quelques heures avant. En cas de retard le jour même, préviens les organisateurs.' },
  { f: ['etudiant'], q: 'Les évaluateurs connaissent mon nom ?', a: 'Non. Ils ne voient que ton numéro, sur ton étiquette. C\'est ce qui rend la note indépendante de qui tu es.' },
  { f: ['etudiant'], q: 'Comment est calculée ma note ?', a: 'Chaque item observé vaut 1 point, la communication se note de 0 à 1 par quart de point. Note = (items + communication) ÷ maximum × 20. Si deux évaluateurs te notent, c\'est la moyenne.' },
  { f: ['etudiant'], q: 'Quand ai-je mes résultats ?', a: 'Ta note et ton rang provisoire arrivent ici au fil des grilles. Le détail (items, mot de l\'évaluateur) s\'ouvre après la dernière série de la session, pour que rien ne circule d\'un jour à l\'autre. Les corrections suivent.' },
  { f: ['etudiant'], q: 'Je pense qu\'un item a été mal noté.', a: 'Une fois le détail ouvert, tu peux demander une révision, une fois par station, pendant quelques jours. Les organisateurs te répondent par e-mail et corrige la note si besoin.' },
  { f: ['evaluateur'], q: 'Dois-je préparer quelque chose ?', a: 'Non. La station, sa vignette et sa grille vous sont présentées au briefing, une heure avant la première série.' },
  { f: ['evaluateur'], q: 'Comment savoir quel candidat est devant moi ?', a: 'Son numéro est sur l\'étiquette collée sur sa blouse, avec un QR code qui ouvre sa grille. L\'écran affiche aussi le numéro attendu dans votre salle. Si vous ouvrez la grille d\'un candidat qui n\'est pas prévu, INES vous demande de confirmer.' },
  { f: ['evaluateur'], q: 'Le candidat n\'est pas venu.', a: 'S\'il n\'a pas émargé à l\'accueil, « Noter absent » apparaît sur l\'écran quelques minutes après le début de son tour. Un candidat arrivé à la dernière minute peut ne pas avoir émargé : s\'il est devant vous, remplissez sa grille normalement. Une absence notée par erreur se remplace en remplissant la grille.' },
  { f: ['evaluateur'], q: 'Comment noter un item ?', a: 'Observé : 1 point. Pas observé : 0. Jamais de demi-point. La communication se note à part, de 0 à 1 par quart de point.' },
  { f: ['evaluateur'], q: 'Nous sommes deux évaluateurs dans la salle.', a: 'Chacun remplit sa grille sans se concerter pendant le passage. La note du candidat est la moyenne des deux.' },
  { f: ['evaluateur'], q: 'Mon téléphone n\'a plus de réseau ou de batterie.', a: 'Sans réseau, la grille reste sur le téléphone (« En attente d\'envoi ») et part dès que la connexion revient. Sans batterie, prenez une grille papier de secours dans la salle et prévenez les organisateurs. Des chargeurs sont à leur table.' },
  { f: ['evaluateur'], q: 'Je me suis trompé de candidat.', a: 'Prévenez les organisateurs : ils voient les grilles suspectes dans En direct et peuvent supprimer une grille erronée. Vous ressaisissez ensuite la bonne.' },
  { f: ['evaluateur', 'ps'], q: 'Puis-je aider un candidat bloqué ?', a: 'Non, on n\'intervient pas pendant le passage. Les explications viennent au débrief, juste après la série.' },
  { f: ['ps'], q: 'Est-ce que je dois apprendre un texte ?', a: 'Pas mot à mot. Ta fiche décrit le personnage, ce qu\'il dit d\'emblée et ce qu\'il ne dit que si on le lui demande. Tu la reçois au briefing.' },
  { f: ['ps'], q: 'Est-ce que je note aussi ?', a: 'Non, c\'est l\'évaluateur qui remplit la grille. Toi, tu joues ton rôle du début à la fin du tour.' },
  { f: ['ps', 'benevole', 'accueil'], q: 'Et si un PS ou un PSS ne vient pas ?', a: 'Chaque demi-journée a au moins un PS ou PSS de réserve, près de la table des organisateurs. Il prend la place de l\'absent et reçoit le script sur place.' },
  { f: ['benevole', 'accueil'], q: 'Que fait-on à l\'accueil ?', a: 'On émarge chaque candidat en scannant le QR code de sa convocation (ou dans la liste), on lui donne son étiquette et on l\'oriente vers la salle d\'attente. Avant chaque série, on fait le brief des circuits.' },
  { f: ['benevole', 'accueil'], q: 'Un candidat n\'est pas sur la liste.', a: 'Ne le refuse pas toi-même : appelle un organisateur, qui vérifie (liste d\'attente, changement de créneau, billet remboursé).' },
  { f: ['benevole'], q: 'Je tiens le chrono : comment ça marche ?', a: 'Le jour J, ton espace affiche « Ouvrir le chrono ». Un gros bouton lance le tour suivant, la pause ou le débrief, et l\'écran te dit qui est dans quelle salle et ton écart avec le planning. Lance le tour 1 quand tous les candidats sont devant leur salle de départ.' },
  { f: ['benevole', 'accueil'], q: 'Un candidat arrive en retard.', a: 'Émarge-le quand même. Si une salle l\'a déjà noté absent, l\'écran te le dit : s\'il passe encore dans cette salle, l\'évaluateur remplit sa grille normalement.' },
  { f: ['evaluateur', 'ps', 'benevole', 'accueil'], q: 'Et après la session ?', a: 'Le lendemain, un merci arrive par e-mail avec un lien vers votre espace : trois questions sur la journée, lues par les organisateurs pour préparer la suivante.', tu: 'Le lendemain, un merci arrive par e-mail avec un lien vers ton espace : trois questions sur la journée, lues par les organisateurs pour préparer la suivante.' },
];

// ---------- le lecteur du film ----------
const PHASE = { 1: 'Préparation', 2: 'La veille', 3: 'Le jour J', 4: 'Après' };
function filmPlayer(box, scenes) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  box.innerHTML = `<div class="gd-film"><div class="gd-stage"></div>
    <div class="gd-cap"><span class="gd-when"></span><strong class="gd-title"></strong><p class="gd-text"></p></div>
    <div class="gd-controls"><button type="button" class="gd-play" aria-label="Lecture">▶</button><div class="gd-chapters">${scenes.map((s, i) => `<button type="button" data-k="${i}" aria-label="${esc(s.title)}"><i><b></b></i><span>${esc(s.title)}</span></button>`).join('')}</div></div></div>`;
  const stage = box.querySelector('.gd-stage'); const chapters = box.querySelector('.gd-chapters'); const playBtn = box.querySelector('.gd-play');
  let k = 0; let playing = false; let t0 = 0; let elapsed = 0; let raf = 0; let started = false;
  const render = (i) => {
    k = i; elapsed = 0; t0 = performance.now();
    const S = scenes[i];
    stage.innerHTML = `<svg viewBox="0 0 760 290" role="img" aria-label="${esc(S.title)}">${S.svg()}</svg>`;
    const svg = stage.querySelector('svg');
    if (reduced && svg.setCurrentTime) svg.setCurrentTime(30);
    if (!playing && !reduced) svg.pauseAnimations?.();
    stage.classList.toggle('paused', !playing && !reduced);
    box.querySelector('.gd-when').textContent = PHASE[S.p];
    box.querySelector('.gd-title').textContent = S.title;
    box.querySelector('.gd-text').textContent = S.text;
    [...chapters.children].forEach((b, j) => { b.classList.toggle('on', j === i); b.querySelector('b').style.width = j < i ? '100%' : '0'; });
  };
  const tick = (now) => {
    if (!playing) return;
    const total = (scenes[k].dur + 1.6) * 1000; const t = elapsed + (now - t0);
    chapters.children[k].querySelector('b').style.width = `${Math.min(100, (t / total) * 100)}%`;
    if (t >= total) render((k + 1) % scenes.length);
    raf = requestAnimationFrame(tick);
  };
  const setPlaying = (on) => {
    if (on === playing || reduced) return;
    playing = on; const svg = stage.querySelector('svg');
    if (on) { t0 = performance.now(); svg?.unpauseAnimations?.(); stage.classList.remove('paused'); raf = requestAnimationFrame(tick); }
    else { elapsed += performance.now() - t0; cancelAnimationFrame(raf); svg?.pauseAnimations?.(); stage.classList.add('paused'); }
    playBtn.textContent = on ? '❚❚' : '▶'; playBtn.setAttribute('aria-label', on ? 'Pause' : 'Lecture');
  };
  playBtn.addEventListener('click', () => { userPaused = playing; setPlaying(!playing); });
  chapters.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { render(Number(b.dataset.k)); setPlaying(true); } });
  let userPaused = false;
  render(0);
  if (!reduced && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver((es) => es.forEach((en) => {
      if (!box.isConnected) { io.disconnect(); setPlaying(false); return; }
      if (en.isIntersecting && !started) { started = true; render(0); setPlaying(true); }
      else if (!en.isIntersecting) setPlaying(false);
      else if (!userPaused) setPlaying(true);
    }), { threshold: 0.5 });
    io.observe(stage);
  }
}

// ---------- la section, à placer dans un espace ----------
// profiles : un ou plusieurs de 'etudiant', 'evaluateur', 'ps', 'benevole', 'accueil' ; planning : pour les durées
export function guideSection(box, profiles, { planning = {}, open = false, title = null } = {}) {
  if (!box) return;
  const ps = [...new Set(profiles.filter((p) => FILM[p]))];
  if (!ps.length) return;
  const vous = ps.includes('evaluateur') && ps.length === 1;
  const scenes = [...new Set(ps.flatMap((p) => FILM[p]))].sort((a, b) => a - b).map((i) => SCENES[i]);
  const ess = ps.flatMap((p) => essentials(p, planning)).filter((x, i, a) => a.findIndex((y) => y[0] === x[0] && y[1] === x[1]) === i);
  const faq = FAQ.filter((x) => x.f.some((f) => ps.includes(f)));
  box.innerHTML = `<details class="guide" ${open ? 'open' : ''}><summary><span><strong>${esc(title || 'Le déroulé, en bref')}</strong>
      <span class="small muted">${vous ? 'Le film de la journée, l\'essentiel à retenir et vos questions.' : 'Le film de la journée, l\'essentiel à retenir et tes questions.'}</span></span></summary>
    <div class="guide-body">
      <div class="gd-film-box"></div>
      <div class="gd-ess"><h3>L'essentiel</h3><dl>${ess.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl></div>
      <div class="gd-faq"><h3>Questions fréquentes</h3>${faq.map((x) => `<details><summary>${esc(x.q)}</summary><p>${esc(vous || !x.tu ? x.a : x.tu)}</p></details>`).join('')}</div>
    </div></details>`;
  const det = box.querySelector('details.guide');
  let filmReady = false;
  const ready = () => { if (det.open && !filmReady) { filmReady = true; filmPlayer(box.querySelector('.gd-film-box'), scenes); } };
  det.addEventListener('toggle', ready); ready();
}
