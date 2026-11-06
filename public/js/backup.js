// Sauvegarde et restauration d'une session d'ECOS (fichier JSON).
// Sert aussi à reprendre les données de l'ancien site, une fois converties.
import { api, esc, toast } from './ui.js';

const chunks = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

export function importPanel(root, onDone) {
  root.innerHTML = `<details class="panel">
    <summary style="cursor:pointer"><strong>Importer une session</strong> <span class="muted">depuis une sauvegarde (.json) téléchargée dans les réglages d'une session</span></summary>
    <label for="imp-file">Fichier de sauvegarde</label><input type="file" id="imp-file" accept=".json,application/json">
    <div id="imp-out"></div></details>`;
  const out = root.querySelector('#imp-out');
  root.querySelector('#imp-file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    let data;
    try { data = JSON.parse(await file.text()); } catch { out.innerHTML = '<p class="alert warn">Ce fichier n\'est pas un JSON lisible.</p>'; return; }
    if (data.format !== 'omas-ecos-session' || !Array.isArray(data.stations)) {
      out.innerHTML = '<p class="alert warn">Ce fichier n\'est pas une sauvegarde de session OMAS.</p>'; return;
    }
    const nEval = data.evaluations?.length || 0;
    const pairs = new Set((data.evaluations || []).map((v) => `${v.station}|${v.candidate}`)).size;
    out.innerHTML = `<p class="alert info">« ${esc(data.exam?.name)} »${data.source ? `, ${esc(data.source)}` : ''} :
      ${data.stations.length} stations, ${data.candidates?.length || 0} candidats, ${nEval} grilles
      ${nEval > pairs ? `, dont ${nEval - pairs} remplies par un second évaluateur` : ''}.</p>
      <label for="imp-name">Nom de la session importée</label><input id="imp-name" value="${esc(data.exam?.name || '')}">
      <p class="small muted">Une nouvelle session est créée, l'import ne touche à aucune session existante. Les codes d'accès des candidats sont conservés quand ils sont libres.</p>
      <button class="primary" id="imp-go">Importer</button><div id="imp-prog" style="margin-top:12px"></div>`;
    out.querySelector('#imp-go').addEventListener('click', async (ev) => {
      ev.target.disabled = true;
      const prog = out.querySelector('#imp-prog');
      const step = (t, done, total) => { prog.innerHTML = `<p class="small">${esc(t)}${total ? ` ${done} / ${total}` : ''}</p>
        ${total ? `<div class="gauge" style="height:8px"><div class="fill" style="width:${Math.round((done / total) * 100)}%"></div></div>` : ''}`; };
      let examId = null;
      try {
        step('Création de la session et des stations');
        const r = await api('/import/exam', { method: 'POST', body: { exam: { ...data.exam, name: out.querySelector('#imp-name').value.trim() || data.exam?.name }, stations: data.stations } });
        examId = r.exam_id;
        const stId = new Map(r.stations.map(([k, id]) => [String(k), id]));
        const caId = new Map();
        const cands = data.candidates || [];
        let changed = 0;
        for (const [i, part] of chunks(cands, 250).entries()) {
          step('Candidats', i * 250, cands.length);
          const res = await api(`/import/${examId}/candidates`, { method: 'POST', body: { rows: part } });
          res.candidates.forEach(([k, id]) => caId.set(String(k), id));
          changed += res.codes_changed;
        }
        const rows = (data.evaluations || []).map((v) => ({ ...v, station_id: stId.get(String(v.station)), candidate_id: caId.get(String(v.candidate)) }))
          .filter((v) => v.station_id && v.candidate_id);
        let skipped = nEval - rows.length;
        for (const [i, part] of chunks(rows, 400).entries()) {
          step('Grilles', i * 400, rows.length);
          skipped += (await api(`/import/${examId}/evaluations`, { method: 'POST', body: { rows: part } })).skipped;
        }
        step('Import terminé');
        toast(`Session importée : ${cands.length} candidats, ${rows.length - skipped} grilles`);
        if (changed) alert(`${changed} code(s) d'accès étaient déjà pris : de nouveaux codes ont été générés pour ces candidats.`);
        onDone?.(examId);
      } catch (err) {
        prog.innerHTML = `<p class="alert warn">L'import s'est arrêté : ${esc(err.message)}.${examId ? ' La session a été créée en partie : supprime-la avant de relancer l\'import.' : ''}</p>`;
        ev.target.disabled = false;
      }
    });
  });
}
