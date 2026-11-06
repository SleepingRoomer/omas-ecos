// Mode projection : un écran à l'accueil, pour l'équipe et les évaluateurs.
// Heure, série en cours, tour en cours, grilles en retard et course des évaluateurs.
import { api, esc, longDate, plate } from './ui.js';
import { seriesTimes, frTime, toMin } from './planning-shared.js';
import { raceHtml } from './race.js';

let timer = null;

export async function projectionView(app, exam) {
  document.body.classList.add('kiosk');
  clearInterval(timer);
  const draw = async () => {
    const [R, P, Res] = await Promise.all([api(`/exams/${exam.id}/race`), api(`/exams/${exam.id}/planning`), api(`/exams/${exam.id}/results`)]);
    const now = new Date();
    const hhmm = now.toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });
    const nowMin = toMin(hhmm.replace(/\s/g, ''));
    const day = P.planning.days.find((d) => d.date === R.day);
    const cap = P.slots.length;
    // série en cours, ou prochaine série du jour
    let cur = null; let next = null;
    (day?.series || []).forEach((s, i) => {
      const T = seriesTimes(P.planning, s, cap);
      const st = toMin(s.convocation || s.start); const en = toMin(T.debrief?.end || T.end);
      if (nowMin >= st && nowMin < en) cur = { n: i + 1, s, T };
      else if (!next && nowMin < st) next = { n: i + 1, s, T };
    });
    let phase = '';
    if (cur) {
      const r = cur.T.rounds.find((x) => nowMin >= toMin(x.start) && nowMin < toMin(x.end));
      phase = nowMin < toMin(cur.T.start) ? 'Accueil des candidats'
        : r ? `Tour ${r.round} sur ${cap}, jusqu'à ${frTime(r.end)}`
          : cur.T.pause && nowMin >= toMin(cur.T.pause.start) && nowMin < toMin(cur.T.pause.end) ? 'Pause, changement de circuit'
            : nowMin >= toMin(cur.T.end) ? 'Débrief et correction' : '';
    }
    const done = Res.rows.reduce((a, r) => a + Object.keys(r.scores).length, 0);
    app.innerHTML = `<div class="proj">
      <div class="proj-top"><div><div class="proj-title">${esc(exam.name)}</div><div class="proj-day">${R.day ? esc(longDate(R.day)) : ''}</div></div>
        <div class="proj-clock">${hhmm.replace(':', ' h ')}</div></div>
      <div class="proj-grid">
        <div class="proj-card big">${cur ? `<div class="proj-k">En ce moment</div><div class="proj-v">Série ${cur.n}</div><div class="proj-s">${esc(phase)}</div>`
          : next ? `<div class="proj-k">Prochaine série</div><div class="proj-v">Série ${next.n}</div><div class="proj-s">Convocation à ${frTime(next.s.convocation)}, début à ${frTime(next.s.start)}</div>`
            : '<div class="proj-k">Aujourd\'hui</div><div class="proj-v">Merci à tous !</div><div class="proj-s">Plus de série prévue.</div>'}</div>
        <div class="proj-card"><div class="proj-k">Grilles saisies</div><div class="proj-v">${done}</div><div class="proj-s">sur toute la session</div></div>
        <div class="proj-card"><div class="proj-k">Évaluateurs en piste</div><div class="proj-v">${R.horses.length}</div><div class="proj-s">${R.horses[0] ? `en tête : ${esc(R.horses[0].name)}` : ''}</div></div>
      </div>
      ${day ? `<div class="proj-series">${day.series.map((s, i) => { const T = seriesTimes(P.planning, s, cap); const past = nowMin >= toMin(T.debrief?.end || T.end);
        return `<span class="${cur?.n === i + 1 ? 'on' : past ? 'past' : ''}">Série ${i + 1} · ${frTime(s.start)}</span>`; }).join('')}</div>` : ''}
      <div class="proj-race">${raceHtml(R, { compact: true })}</div>
      <button class="proj-exit no-print" id="exit">Quitter la projection</button>
    </div>`;
    app.querySelector('#exit').addEventListener('click', () => { document.body.classList.remove('kiosk'); clearInterval(timer); location.hash = `#/admin/session/${exam.id}/direct`; });
  };
  await draw();
  timer = setInterval(() => { if (!location.hash.endsWith('/projection')) { clearInterval(timer); document.body.classList.remove('kiosk'); return; } draw().catch(() => {}); }, 20000);
  void plate;
}
