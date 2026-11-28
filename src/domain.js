// Adresse principale du site : la variable SITE_URL (par exemple https://inesomas.fr), réglée dans Cloudflare.
// Tant qu'elle n'est pas réglée, rien ne change. Une fois réglée, l'ancienne adresse en workers.dev et www renvoient
// les pages vers elle (le #/… du lien suit tout seul) ; l'API reste servie partout, pour les onglets déjà ouverts.
export function canonicalRedirect(request, env) {
  if (!env.SITE_URL || !['GET', 'HEAD'].includes(request.method)) return null;
  let target; try { target = new URL(env.SITE_URL); } catch { return null; }
  const url = new URL(request.url);
  if (url.pathname.startsWith('/api/') || url.hostname === target.hostname) return null;
  if (!url.hostname.endsWith('.workers.dev') && url.hostname !== `www.${target.hostname}`) return null;
  return Response.redirect(`${target.origin}${url.pathname}${url.search}`, 302);
}
