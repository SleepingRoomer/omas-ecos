// Chaque fichier du serveur et de l'interface doit au moins se lire : une faute de frappe ne part pas en production
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

for (const dir of ['src', 'public/js']) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    test(`${dir}/${f} se lit sans erreur`, () => {
      assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', `${dir}/${f}`], { stdio: 'pipe' }));
    });
  }
}

test('le serveur se charge (toutes les routes s\'enregistrent)', async () => {
  const mod = await import('../src/index.js');
  assert.equal(typeof mod.default.fetch, 'function');
  assert.equal(typeof mod.default.scheduled, 'function');
});
