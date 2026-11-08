// Remplit une instance LOCALE d'INES (npm run dev, base locale vide) avec des données fictives,
// pour les captures d'écran et les démonstrations. Ne jamais lancer contre la production.
// Usage : node scripts/demo/seed.mjs   (écrit scripts/demo/seed.json, lu par shots.py)
import { STATIONS, contentFor } from './stations.mjs';
import { rotationFor } from '../../public/js/planning-shared.js';
import { writeFileSync } from 'node:fs';

const BASE = process.env.INES_URL || 'http://localhost:8787/api';
if (!/localhost|127\.0\.0\.1/.test(BASE)) throw new Error('Données de démo : seulement en local.');
class Client {
  constructor() { this.cookie = ''; }
  async req(method, path, body) {
    const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0];
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; }
    if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${t.slice(0, 200)}`);
    return j;
  }
}
const admin = new Client();
await admin.req('POST', '/login', { role: 'admin', code: 'test-admin' });
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const TOMORROW = new Date(Date.now() + 864e5).toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });
const { id: examId } = await admin.req('POST', '/exams', { name: 'ECOS blancs de novembre', days: [TODAY, TOMORROW] });

const P = (await admin.req('GET', `/exams/${examId}/planning`)).planning;
await admin.req('PUT', `/exams/${examId}/planning`, { planning: { ...P, place: 'Faculté de médecine, 15 rue de l\'École de Médecine, Paris', publish: true, swaps_open: true, instructions: 'Viens avec ta blouse et ton stéthoscope.' } });

const PEOPLE = [['Yasmine Haddad', 'Cardiologie'], ['Karim Benali', 'Médecine d\'urgence'], ['Sarah Lemaire', 'Pneumologie'], ['Mehdi Ouali', 'Neurologie'], ['Inès Chabane', 'Endocrinologie'], ['Lucas Moreau', 'Hématologie'], ['Nadia Ferhat', 'Médecine interne'], ['Omar Diallo', 'Hépato-gastro-entérologie']];
await admin.req('POST', '/people', PEOPLE.map(([name, specialty], i) => ({ name: `Dr ${name}`, specialty, email: `redacteur${i}@exemple.org` })));
const people = await admin.req('GET', '/people');
const stations = await admin.req('GET', `/exams/${examId}/stations`);
const pid = (i) => people[i % people.length].id;
let k = 0;
for (const st of stations) {
  const S = STATIONS[st.slot];
  await admin.req('PUT', `/stations/${st.id}/content`, { content: contentFor(st.slot), title: S.title, discipline: S.discipline });
  const status = st.slot === 'R1' ? 'relecture_expert' : st.slot === 'R2' ? 'redaction' : 'validee';
  await admin.req('PATCH', `/stations/${st.id}`, { author_id: pid(k), peer_id: pid(k + 3), expert_id: pid(k + 5), status });
  k++;
}
await admin.req('POST', `/exams/${examId}/test-candidates`, { count: 80 });
await admin.req('PATCH', `/exams/${examId}`, { eval_mode: 'open', show_results: true, show_details: true, details_embargo: false });

// grilles : série 1 du jour entière, série 2 jusqu'au tour en cours
const played = stations.filter((s) => s.played).map((s) => s.slot);
const rot = rotationFor(played);
const now = new Date();
const nowMin = Number(now.toLocaleTimeString('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).replace(':', '.').split('.').reduce((h, m) => h * 60 + Number(m), 0));
const roundStart = (ser, r) => { const [h, m] = ser.start.split(':').map(Number); return h * 60 + m + (r - 1) * 10 + (r > 5 ? 10 : 0); };
const day = P.days.find((d) => d.date === TODAY) || P.days[0];
const hash = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return ((h >>> 0) % 10000) / 10000; };
const EVAL = { A1: ['Dr Hugo Petit', 'Dr Amel Saidi'], A2: ['Dr Claire Roux'], A3: ['Dr Rayan Toumi'], A4: ['Dr Léa Garnier'], A5: ['Dr Bilal Kaci'], B1: ['Dr Emma Fontaine'], B2: ['Dr Samir Bouzid'], B3: ['Dr Julie Marchand'], B4: ['Dr Ismaël Traoré'], B5: ['Dr Manon Leclerc'] };
let n = 0;
for (const st of stations.filter((s) => s.played)) {
  for (const name of EVAL[st.slot]) {
    const ev = new Client();
    await ev.req('POST', '/login', { role: 'evaluateur', code: st.eval_code, name });
    const ctx = await ev.req('GET', '/eval/context');
    for (const cand of ctx.candidates) {
      if (cand.day !== day.date || cand.series > 2) continue;
      const ser = day.series[cand.series - 1];
      const round = [...Array(10).keys()].map((i) => i + 1).find((r) => rot.at(cand.seat, r) === st.slot);
      if (!round) continue;
      const late = st.slot === 'B2' || st.slot === 'A4';
      if (cand.series === 2 && roundStart(ser, round) + 10 + (late ? 12 : 0) > nowMin) continue;
      if (name.includes('Amel') && cand.series === 2) continue;
      const ability = 0.45 + 0.5 * hash(`${cand.id}`);
      const absent = cand.series === 1 && cand.seat === 7;
      const answers = { apt: {}, com: {} };
      ctx.grille.apt.forEach((it, i) => { answers.apt[it.id] = { ok: hash(`${cand.id}-${st.slot}-${i}-${name}`) < ability }; });
      ctx.grille.com.forEach((it, i) => { answers.com[it.id] = Math.round(Math.min(1, Math.max(0, ability + (hash(`c${cand.id}${i}${name}`) - 0.5) * 0.5)) * 4) / 4; });
      const global = Math.max(0, Math.min(4, Math.round(ability * 5 - 0.5)));
      const comment = hash(`m${cand.id}${st.slot}`) < 0.3 ? 'Bon début, pense à hiérarchiser tes hypothèses avant de conclure.' : '';
      await ev.req('PUT', '/eval/evaluations', { candidate_id: cand.id, absent, answers, global, comment });
      n++;
    }
  }
}
// émargement des séries 1 et 2 du jour
const plan = await admin.req('GET', `/exams/${examId}/planning`);
for (const c of plan.candidates.filter((c) => c.day === day.date && c.series <= 2 && !(c.series === 1 && c.seat === 7))) {
  await admin.req('POST', `/candidates/${c.id}/presence`, { present: true });
}
const cands = plan.candidates;
const pick = (ser, seat, d = day.date) => cands.find((c) => c.day === d && c.series === ser && c.seat === seat);
const full = await admin.req('GET', `/exams/${examId}/candidates`);
const codeOf = (id) => full.find((c) => c.id === id)?.code;
const out = { examId, grids: n, today: day.date, nowMin,
  done: { id: pick(1, 2).id, code: codeOf(pick(1, 2).id) },
  upcoming: { id: pick(3, 4).id, code: codeOf(pick(3, 4).id) },
  evalA1: stations.find((s) => s.slot === 'A1').eval_code, evalA1Station: stations.find((s) => s.slot === 'A1').id,
  serie2cand: pick(2, 1).id, people: people.slice(0, 2).map((p) => ({ name: p.name, code: p.code })) };
writeFileSync(new URL('./seed.json', import.meta.url), JSON.stringify(out, null, 1));
console.log(out);
