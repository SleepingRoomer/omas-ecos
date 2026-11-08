// E-mails automatiques (Brevo) et anonymisation des sessions terminées.
// Sans clé Brevo, rien ne part : chaque message est noté « non envoyé » dans le journal, et le site marche comme avant.
import { normalizePlanning } from '../public/js/planning-shared.js';
import { examState } from './state.js';

const FAKE = /@(exemple|example)\.(org|com|fr)$/i;
const DEFAULTS = { auto_swap: true, auto_waitlist: true, auto_volunteer: true, auto_reminder: true, reply_to: '' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
export const longDate = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }) : '');
const parisDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'Europe/Paris' });

// Gabarit commun : sobre, lisible dans tous les clients mail, sans image distante
export function layout({ title, intro = '', rows = [], button = null, after = '', foot = '' }) {
  return `<!doctype html><html lang="fr"><body style="margin:0;background:#f5f6fa;font-family:Arial,Helvetica,sans-serif;color:#191a3f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;padding:24px 0"><tr><td align="center">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;border:1px solid #e3e5ee">
<tr><td style="padding:22px 28px 6px"><span style="font-weight:900;font-size:24px;letter-spacing:-0.5px;color:#2d2f84">INE<span style="color:#00a09a">S</span></span>
<span style="font-size:12px;color:#4a4c68;margin-left:8px">par <b style="color:#2d2f84">OMAS</b> <b style="color:#00807b">EXTERNAT</b></span></td></tr>
<tr><td style="padding:10px 28px 0"><h1 style="font-size:21px;margin:8px 0 10px">${esc(title)}</h1>${intro ? `<p style="font-size:15px;line-height:1.55;margin:0 0 14px">${intro}</p>` : ''}</td></tr>
${rows.length ? `<tr><td style="padding:0 28px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6fa;border:1px solid #e3e5ee;border-radius:10px">
${rows.map(([k, v]) => `<tr><td style="padding:9px 14px;font-size:13px;color:#4a4c68;width:38%;vertical-align:top">${esc(k)}</td><td style="padding:9px 14px;font-size:15px;font-weight:bold">${v}</td></tr>`).join('')}
</table></td></tr>` : ''}
${button ? `<tr><td style="padding:20px 28px 4px"><a href="${esc(button.url)}" style="display:inline-block;background:#2d2f84;color:#ffffff;text-decoration:none;font-weight:bold;padding:12px 20px;border-radius:9px">${esc(button.label)}</a></td></tr>` : ''}
${after ? `<tr><td style="padding:14px 28px 0;font-size:14px;line-height:1.55">${after}</td></tr>` : ''}
<tr><td style="padding:22px 28px 24px;font-size:12px;color:#6e7090;line-height:1.5">${foot || 'INES, la plateforme des ECOS blancs d’OMAS Externat, accessibles à tous et sans but lucratif.'}<br>Message automatique : pour toute question, réponds à cet e-mail.</td></tr>
</table></td></tr></table></body></html>`;
}

export function mailReady(env) { return !!(env.BREVO_API_KEY && env.MAIL_FROM); }

async function getSettings(db) {
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'mail'").first().catch(() => null);
  try { return { ...DEFAULTS, ...JSON.parse(r?.value || '{}') }; } catch { return { ...DEFAULTS }; }
}
export async function siteUrl(env, db, c) {
  if (env.SITE_URL) return env.SITE_URL.replace(/\/$/, '');
  if (c) return new URL(c.req.url).origin;
  const r = await db.prepare("SELECT value FROM settings WHERE key = 'site_url'").first().catch(() => null);
  return r?.value || '';
}

// Envoi groupé : un appel Brevo pour 200 destinataires, chacun avec son propre message
export async function sendMails(env, db, msgs) {
  const log = [];
  const ok = msgs.filter((m) => m.to && !FAKE.test(m.to));
  for (const m of msgs.filter((x) => !ok.includes(x))) log.push({ ...m, status: 'skipped', error: m.to ? 'adresse fictive' : 'pas d\'adresse' });
  if (!mailReady(env)) for (const m of ok) log.push({ ...m, status: 'skipped', error: 'e-mails non configurés' });
  else {
    const S = await getSettings(db);
    for (let i = 0; i < ok.length; i += 200) {
      const chunk = ok.slice(i, i + 200);
      const body = {
        sender: { email: env.MAIL_FROM, name: env.MAIL_FROM_NAME || 'INES · OMAS Externat' },
        ...(S.reply_to ? { replyTo: { email: S.reply_to } } : {}),
        subject: chunk[0].subject, htmlContent: chunk[0].html, to: [{ email: chunk[0].to }],
        messageVersions: chunk.map((m) => ({ to: [{ email: m.to, ...(m.name ? { name: m.name } : {}) }], subject: m.subject, htmlContent: m.html })),
        tags: [...new Set(chunk.map((m) => m.kind))].slice(0, 5),
      };
      let status = 'sent'; let error = null;
      try {
        const r = await fetch(env.BREVO_URL || 'https://api.brevo.com/v3/smtp/email', { method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) });
        if (!r.ok) { status = 'failed'; error = `${r.status} ${(await r.text()).slice(0, 200)}`; }
      } catch (e) { status = 'failed'; error = String(e.message || e).slice(0, 200); }
      for (const m of chunk) log.push({ ...m, status, error });
    }
  }
  // journal : 7 colonnes, 14 lignes par requête (limite de 100 paramètres)
  const stmts = [];
  for (let i = 0; i < log.length; i += 14) {
    const part = log.slice(i, i + 14);
    stmts.push(db.prepare(`INSERT INTO mail_log (exam_id, kind, ref, to_email, subject, status, error) VALUES ${part.map(() => '(?,?,?,?,?,?,?)').join(',')}`)
      .bind(...part.flatMap((m) => [m.exam_id ?? null, m.kind, m.ref ?? null, m.to || '', m.subject, m.status, m.error ?? null])));
  }
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return { sent: log.filter((m) => m.status === 'sent').length, skipped: log.filter((m) => m.status === 'skipped').length, failed: log.filter((m) => m.status === 'failed').length, ready: mailReady(env) };
}

// Envoi après la réponse, pour ne pas faire attendre la personne
function later(c, p) { try { c.executionCtx.waitUntil(p.catch(() => {})); } catch { return p.catch(() => {}); } return null; }

// ---------- les messages ----------
const studentLink = (url, code) => `${url}/#/?role=etudiant&code=${encodeURIComponent(code)}`;
function slotOf(planning, cand) {
  const d = planning.days.find((x) => x.date === cand.day);
  const s = d?.series[(cand.series || 1) - 1];
  return { date: cand.day, convocation: s?.convocation || '', start: s?.start || '' };
}
export function convocationMail(url, exam, planning, cand, kind = 'convocation') {
  const t = slotOf(planning, cand);
  const tomorrow = kind === 'rappel';
  return {
    kind, exam_id: exam.id, ref: String(cand.id), to: cand.email, name: `${cand.first_name} ${cand.last_name}`,
    subject: tomorrow ? `C'est demain : ECOS blancs, convocation à ${t.convocation}` : `Ta convocation aux ${exam.name}`,
    html: layout({
      title: tomorrow ? `À demain, ${cand.first_name} !` : `Ta convocation, ${cand.first_name}`,
      intro: tomorrow ? `Petit rappel pour ton passage aux ECOS blancs de demain.${t.start && Number(t.start.split(':')[0]) < 12 && planning.welcome_morning ? ` ${esc(planning.welcome_morning)} : viens un peu en avance !` : ''}`
        : `Ta place aux <b>${esc(exam.name)}</b> est réservée. Voici ton créneau : ton parcours salle par salle et ton QR code d'émargement sont dans ton espace.`,
      rows: [['Date', esc(longDate(t.date))], ['Convocation', esc(t.convocation)], ['Début des stations', esc(t.start)],
        ...(planning.place ? [['Lieu', esc(planning.place)]] : []), ...(cand.number ? [['Ton numéro', esc(cand.number)]] : []), ['Ton code d\'accès', `<span style="letter-spacing:2px">${esc(cand.code)}</span>`]],
      button: { url: studentLink(url, cand.code), label: 'Ouvrir mon espace' },
      after: tomorrow ? 'Un empêchement ? Libère ta place depuis ton espace : une personne de la liste d\'attente la récupère.'
        : 'Tu veux changer de créneau ? Les échanges entre étudiants se font aussi depuis ton espace.',
    }),
  };
}

export function registerMail(app, h) {
  const { need, httpError, all, one, run, parse } = h;

  app.get('/mail/status', need('admin'), async (c) => {
    const db = c.env.DB;
    const [S, log, counts] = await Promise.all([getSettings(db),
      all(db, 'SELECT m.id, m.kind, m.to_email, m.subject, m.status, m.error, m.created_at, e.name AS exam_name FROM mail_log m LEFT JOIN exams e ON e.id = m.exam_id ORDER BY m.id DESC LIMIT 60'),
      all(db, "SELECT status, COUNT(*) AS n FROM mail_log WHERE created_at > datetime('now', '-30 days') GROUP BY status")]);
    return c.json({ ready: mailReady(c.env), from: c.env.MAIL_FROM || null, missing: ['BREVO_API_KEY', 'MAIL_FROM'].filter((k) => !c.env[k]), settings: S, log, counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
  });
  app.put('/mail/settings', need('admin'), async (c) => {
    const b = await c.req.json();
    const S = { ...(await getSettings(c.env.DB)) };
    for (const k of ['auto_swap', 'auto_waitlist', 'auto_volunteer', 'auto_reminder']) if (k in b) S[k] = !!b[k];
    if ('reply_to' in b) S.reply_to = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.reply_to).trim()) ? String(b.reply_to).trim() : '';
    await run(c.env.DB, "INSERT INTO settings (key, value) VALUES ('mail', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(S));
    return c.json(S);
  });
  app.post('/mail/test', need('admin'), async (c) => {
    const { to } = await c.req.json();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(to || ''))) throw httpError(400, 'Adresse invalide');
    const url = await siteUrl(c.env, c.env.DB, c);
    const r = await sendMails(c.env, c.env.DB, [{ kind: 'test', to, subject: 'Test des e-mails ECOS blancs', html: layout({ title: 'Ça marche !', intro: 'Les e-mails automatiques de la plateforme ECOS blancs sont bien configurés.', button: { url, label: 'Ouvrir la plateforme' } }) }]);
    if (!r.ready) {
      const miss = ['BREVO_API_KEY', 'MAIL_FROM'].filter((k) => !c.env[k]);
      throw httpError(400, `Il manque ${miss.join(' et ')} dans les variables du Worker (Paramètres, Variables et secrets, pas les variables de build).`);
    }
    if (r.failed) throw httpError(502, 'Brevo a refusé l\'envoi : regarde le journal ci-dessous.');
    return c.json(r);
  });

  async function examCtx(c) {
    const exam = await one(c.env.DB, 'SELECT * FROM exams WHERE id = ?', c.req.param('id'));
    if (!exam) throw httpError(404, 'Session introuvable');
    if (exam.anonymized_at) throw httpError(400, 'Session anonymisée : plus aucune adresse.');
    return { exam, planning: normalizePlanning(parse(exam.planning, null), exam), url: await siteUrl(c.env, c.env.DB, c) };
  }

  app.get('/exams/:id/mail', need('admin'), async (c) => {
    const rows = await all(c.env.DB, 'SELECT kind, status, COUNT(*) AS n, MAX(created_at) AS last FROM mail_log WHERE exam_id = ? GROUP BY kind, status', c.req.param('id'));
    const pending = await one(c.env.DB, `SELECT COUNT(*) AS n FROM candidates c WHERE c.exam_id = ? AND c.status != 'annule' AND c.day IS NOT NULL AND COALESCE(c.email, '') != ''
      AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'convocation' AND m.ref = CAST(c.id AS TEXT) AND m.status = 'sent')`, c.req.param('id'));
    return c.json({ ready: mailReady(c.env), rows, convocations_pending: pending.n });
  });

  app.post('/exams/:id/mail/convocations', need('admin'), async (c) => {
    const { exam, planning, url } = await examCtx(c);
    const { all: everyone = false } = await c.req.json().catch(() => ({}));
    const cands = await all(c.env.DB, `SELECT c.* FROM candidates c WHERE c.exam_id = ? AND c.status != 'annule' AND c.day IS NOT NULL
      ${everyone ? '' : "AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'convocation' AND m.ref = CAST(c.id AS TEXT) AND m.status = 'sent')"}`, exam.id);
    if (!cands.length) return c.json({ sent: 0, skipped: 0, failed: 0, ready: mailReady(c.env), none: true });
    return c.json(await sendMails(c.env, c.env.DB, cands.map((x) => convocationMail(url, exam, planning, x))));
  });

  app.post('/exams/:id/mail/resultats', need('admin'), async (c) => {
    const { exam, url } = await examCtx(c);
    if (!exam.show_results) throw httpError(400, 'Les résultats ne sont pas encore ouverts aux étudiants (onglet Réglages).');
    const cands = await all(c.env.DB, `SELECT c.* FROM candidates c WHERE c.exam_id = ? AND c.status != 'annule'
      AND EXISTS (SELECT 1 FROM evaluations v WHERE v.candidate_id = c.id)
      AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'resultats' AND m.ref = CAST(c.id AS TEXT) AND m.status = 'sent')`, exam.id);
    return c.json(await sendMails(c.env, c.env.DB, cands.map((x) => ({
      kind: 'resultats', exam_id: exam.id, ref: String(x.id), to: x.email, name: `${x.first_name} ${x.last_name}`,
      subject: `Tes résultats des ${exam.name} sont en ligne`,
      html: layout({ title: `Tes résultats sont en ligne, ${x.first_name}`,
        intro: `Ta note station par station, ton rang, ce qui a manqué dans chaque grille${exam.corrections_published ? ', les corrections' : ''} et ton plan de révision personnalisé t'attendent dans ton espace.`,
        button: { url: studentLink(url, x.code), label: 'Voir mes résultats' },
        after: 'Deux minutes pour nous dire ce que tu as pensé de la session ? Le questionnaire est en haut de ton espace. Merci !' }),
    }))));
  });

  // ---------- anonymisation ----------
  app.post('/exams/:id/anonymize', need('admin'), async (c) => {
    const db = c.env.DB;
    const exam = await one(db, 'SELECT * FROM exams WHERE id = ?', c.req.param('id'));
    if (!exam) throw httpError(404, 'Session introuvable');
    const { confirm } = await c.req.json();
    if (String(confirm || '').trim() !== exam.name.trim()) throw httpError(400, 'Recopie exactement le nom de la session pour confirmer.');
    if (examState(exam).eval.open) throw httpError(400, 'Ferme d\'abord la saisie des grilles (onglet Réglages, saisie forcée fermée).');
    if (exam.anonymized_at) throw httpError(400, 'Session déjà anonymisée.');
    // évaluateurs : un pseudonyme stable par personne, pour garder les statistiques de binômes
    const names = (await all(db, 'SELECT DISTINCT evaluator_name AS n FROM evaluations WHERE exam_id = ? ORDER BY lower(evaluator_name)', exam.id)).map((r) => r.n);
    const seen = new Map(); const ren = [];
    for (const n of names) { const k = n.toLowerCase().replace(/\s*\(2e saisie\)$/, ''); if (!seen.has(k)) seen.set(k, `Évaluateur ${seen.size + 1}`); ren.push([n, seen.get(k) + (/\(2e saisie\)$/i.test(n) ? ' (2e saisie)' : '')]); }
    const id = exam.id;
    const stmts = [
      db.prepare(`UPDATE candidates SET first_name = 'Candidat', last_name = COALESCE(number, 'n° ' || id), email = NULL, phone = NULL,
        code = lower(hex(randomblob(10))), checkin = NULL, extra = json_object('anonymized', 1, 'tarif', json_extract(extra, '$.tarif'), 'adherent', json_extract(extra, '$.adherent'))
        WHERE exam_id = ?`).bind(id),
      db.prepare("DELETE FROM auth_sessions WHERE kind = 'etudiant' AND subject_id IN (SELECT id FROM candidates WHERE exam_id = ?)").bind(id),
      db.prepare('UPDATE evaluations SET comment = NULL, ip = NULL WHERE exam_id = ?').bind(id),
      db.prepare('DELETE FROM swap_responses WHERE swap_id IN (SELECT id FROM swaps WHERE exam_id = ?)').bind(id),
      db.prepare('DELETE FROM swaps WHERE exam_id = ?').bind(id),
      db.prepare('DELETE FROM waitlist WHERE exam_id = ?').bind(id),
      db.prepare("UPDATE mail_log SET to_email = '', error = NULL WHERE exam_id = ?").bind(id),
      ...ren.filter(([a, b]) => a !== b).map(([a, b]) => db.prepare('UPDATE evaluations SET evaluator_name = ? WHERE exam_id = ? AND evaluator_name = ?').bind(`~${b}`, id, a)),
      db.prepare("UPDATE evaluations SET evaluator_name = substr(evaluator_name, 2) WHERE exam_id = ? AND evaluator_name LIKE '~%'").bind(id),
      db.prepare("UPDATE exams SET anonymized_at = datetime('now') WHERE id = ?").bind(id),
    ];
    await h.batch(db, stmts);
    const n = await one(db, 'SELECT COUNT(*) AS n FROM candidates WHERE exam_id = ?', id);
    return c.json({ ok: true, candidates: n.n, evaluators: seen.size });
  });
}

// ---------- envois déclenchés par une action ----------
export function notifier(c) {
  const env = c.env; const db = env.DB;
  const go = async (kind, build) => {
    const S = await getSettings(db);
    if (!S[kind]) return;
    const msgs = await build(await siteUrl(env, db, c));
    if (msgs.length) await sendMails(env, db, msgs);
  };
  return {
    // échange de créneaux conclu : les deux étudiants reçoivent leur nouvel horaire
    swap: (ids) => later(c, go('auto_swap', async (url) => {
      const rows = await db.prepare(`SELECT c.*, e.name AS exam_name, e.planning, e.starts_on, e.ends_on FROM candidates c JOIN exams e ON e.id = c.exam_id WHERE c.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all();
      return rows.results.map((x) => {
        const P = normalizePlanning(JSON.parse(x.planning || 'null'), x); const t = slotOf(P, x);
        return { kind: 'echange', exam_id: x.exam_id, ref: String(x.id), to: x.email, name: `${x.first_name} ${x.last_name}`,
          subject: `Échange confirmé : ${longDate(t.date)}, convocation à ${t.convocation}`,
          html: layout({ title: 'Ton échange de créneau est fait', intro: `Ton nouveau créneau pour les <b>${esc(x.exam_name)}</b> :`,
            rows: [['Date', esc(longDate(t.date))], ['Convocation', esc(t.convocation)], ...(x.number ? [['Ton numéro', esc(x.number)]] : [])],
            button: { url: studentLink(url, x.code), label: 'Voir mon parcours' }, after: 'Ton ancien créneau est passé à l\'autre étudiant : tu n\'as rien d\'autre à faire.' }) };
      });
    })),
    // place proposée depuis la liste d'attente
    waitlist: (candId) => later(c, go('auto_waitlist', async (url) => {
      const x = await db.prepare('SELECT c.*, e.name AS exam_name, e.planning, e.starts_on, e.ends_on FROM candidates c JOIN exams e ON e.id = c.exam_id WHERE c.id = ?').bind(candId).first();
      if (!x) return [];
      const P = normalizePlanning(JSON.parse(x.planning || 'null'), x); const t = slotOf(P, x);
      return [{ kind: 'attente', exam_id: x.exam_id, ref: String(x.id), to: x.email, name: `${x.first_name} ${x.last_name}`,
        subject: `Une place s'est libérée pour toi aux ${x.exam_name}`,
        html: layout({ title: `Bonne nouvelle, ${x.first_name} !`, intro: 'Une place s\'est libérée et elle est pour toi. Confirme ta venue depuis ton espace, sinon elle repart à la personne suivante.',
          rows: [['Date', esc(longDate(t.date))], ['Convocation', esc(t.convocation)], ...(P.place ? [['Lieu', esc(P.place)]] : []), ['Ton code d\'accès', esc(x.code)]],
          button: { url: studentLink(url, x.code), label: 'Confirmer ma venue' } }) }];
    })),
    // inscription d'un bénévole
    volunteer: (signupId) => later(c, go('auto_volunteer', async (url) => {
      const x = await db.prepare('SELECT s.code, s.exam_id, s.prefs, v.email, v.first_name, v.last_name, e.name AS exam_name FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id JOIN exams e ON e.id = s.exam_id WHERE s.id = ?').bind(signupId).first()
        .catch(() => db.prepare('SELECT s.code, s.exam_id, NULL AS prefs, v.email, v.first_name, v.last_name, e.name AS exam_name FROM volunteer_signups s JOIN volunteers v ON v.id = s.volunteer_id JOIN exams e ON e.id = s.exam_id WHERE s.id = ?').bind(signupId).first());
      if (!x) return [];
      let prefs = null; try { prefs = JSON.parse(x.prefs || 'null'); } catch { /* ancienne inscription */ }
      const isEval = prefs?.track === 'evaluateur';
      const vous = isEval; // les évaluateurs sont des médecins et des internes : on les vouvoie
      return [{ kind: isEval ? 'evaluateur' : 'benevole', exam_id: x.exam_id, ref: String(signupId), to: x.email, name: `${x.first_name} ${x.last_name}`,
        subject: isEval ? `Merci : votre inscription comme évaluateur aux ${x.exam_name}` : `Merci ${x.first_name} : ton inscription de bénévole aux ${x.exam_name}`,
        html: layout({ title: `Merci, ${x.first_name} !`,
          intro: vous ? 'Vos disponibilités sont bien notées. L\'équipe prépare le planning des salles : vous le retrouverez dans votre espace, avec la station qui vous est confiée et sa calibration (dix minutes en ligne, pour que les notes soient comparables d\'une salle à l\'autre).'
            : 'On a bien noté tes disponibilités. L\'équipe prépare le planning des salles : tu le retrouveras dans ton espace bénévole, avec la calibration de ta station.',
          rows: [[vous ? 'Votre code personnel' : 'Ton code personnel', `<span style="letter-spacing:2px">${esc(x.code)}</span>`]],
          button: { url: `${url}/#/?role=evaluateur&code=${encodeURIComponent(x.code)}`, label: vous ? 'Ouvrir mon espace évaluateur' : 'Ouvrir mon espace bénévole' },
          after: vous ? 'Le jour J, ce même code ouvre directement votre salle sur votre téléphone : la grille se remplit en deux minutes par candidat, même sans réseau.'
            : 'Le jour J, ce même code ouvre directement ta salle : pas besoin du code affiché sur la porte.' }) }];
    })),
  };
}

// ---------- tâche planifiée : rappels de la veille ----------
export async function dailyReminders(env) {
  const db = env.DB;
  const S = await getSettings(db);
  if (!S.auto_reminder) return { off: true };
  const tomorrow = parisDate(new Date(Date.now() + 864e5));
  const url = await siteUrl(env, db);
  const cands = (await db.prepare(`SELECT c.*, e.name AS exam_name, e.planning, e.starts_on, e.ends_on, e.anonymized_at FROM candidates c JOIN exams e ON e.id = c.exam_id
    WHERE c.day = ? AND c.status != 'annule' AND e.anonymized_at IS NULL
    AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'rappel' AND m.ref = CAST(c.id AS TEXT) AND m.status IN ('sent', 'skipped'))`).bind(tomorrow).all()).results;
  const vols = (await db.prepare(`SELECT a.signup_id, a.half, a.role, st.slot, s.code, s.exam_id, v.email, v.first_name, v.last_name, e.name AS exam_name, e.planning, e.starts_on, e.ends_on
    FROM assignments a JOIN volunteer_signups s ON s.id = a.signup_id JOIN volunteers v ON v.id = s.volunteer_id JOIN exams e ON e.id = a.exam_id LEFT JOIN stations st ON st.id = a.station_id
    WHERE a.day = ? AND NOT EXISTS (SELECT 1 FROM mail_log m WHERE m.kind = 'rappel_benevole' AND m.ref = a.signup_id || '|' || a.day AND m.status IN ('sent', 'skipped'))`).bind(tomorrow).all().catch(() => ({ results: [] }))).results;
  const ROLE = { evaluateur: 'évaluateur', ps: 'patient standardisé', pss: 'professionnel de santé standardisé', logistique: 'accueil et logistique' };
  const msgs = [
    ...cands.map((x) => convocationMail(url, { id: x.exam_id, name: x.exam_name }, normalizePlanning(JSON.parse(x.planning || 'null'), x), x, 'rappel')),
    ...vols.map((x) => {
      const P = normalizePlanning(JSON.parse(x.planning || 'null'), x);
      const d = P.days.find((y) => y.date === tomorrow);
      const ser = (d?.series || []).filter((s) => (Number(s.start.split(':')[0]) < 12 ? 'am' : 'pm') === x.half);
      return { kind: 'rappel_benevole', exam_id: x.exam_id, ref: `${x.signup_id}|${tomorrow}`, to: x.email, name: `${x.first_name} ${x.last_name}`,
        subject: `C'est demain : merci d'être là, ${x.first_name}`,
        html: layout({ title: 'À demain !', intro: `Merci de venir aider aux <b>${esc(x.exam_name)}</b>.`,
          rows: [['Date', esc(longDate(tomorrow))], ['Arrivée', esc(ser[0] ? `${ser[0].convocation}, ${x.half === 'am' ? 'le matin' : 'l\'après-midi'}` : x.half === 'am' ? 'le matin' : 'l\'après-midi')],
            ['Rôle', esc(ROLE[x.role] || x.role)], ...(x.slot ? [['Salle', esc(x.slot)]] : []), ...(P.place ? [['Lieu', esc(P.place)]] : [])],
          button: { url: `${url}/#/?role=evaluateur&code=${encodeURIComponent(x.code)}`, label: 'Mon espace bénévole' },
          after: 'Si ce n\'est pas déjà fait, prends cinq minutes ce soir pour la calibration de ta station.' }) };
    }),
  ];
  return msgs.length ? sendMails(env, db, msgs) : { sent: 0 };
}
