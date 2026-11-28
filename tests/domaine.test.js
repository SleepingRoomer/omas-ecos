import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalRedirect } from '../src/domain.js';

const env = { SITE_URL: 'https://inesomas.fr' };
const go = (url, e = env, method = 'GET') => canonicalRedirect(new Request(url, { method }), e);

test('sans SITE_URL, aucune redirection', () => {
  assert.equal(go('https://omas-ecos.exemple.workers.dev/', {}), null);
});

test('workers.dev et www renvoient vers l\'adresse principale', () => {
  const r = go('https://omas-ecos.exemple.workers.dev/?x=1');
  assert.equal(r.status, 302);
  assert.equal(r.headers.get('Location'), 'https://inesomas.fr/?x=1');
  assert.equal(go('https://www.inesomas.fr/').headers.get('Location'), 'https://inesomas.fr/');
});

test('l\'adresse principale, l\'API, les écritures et les autres hôtes ne bougent pas', () => {
  assert.equal(go('https://inesomas.fr/'), null);
  assert.equal(go('https://omas-ecos.exemple.workers.dev/api/me'), null);
  assert.equal(go('https://omas-ecos.exemple.workers.dev/', env, 'POST'), null);
  assert.equal(go('http://localhost:8787/'), null);
  assert.equal(go('https://omas-ecos.exemple.workers.dev/', { SITE_URL: 'pas une adresse' }), null);
});
