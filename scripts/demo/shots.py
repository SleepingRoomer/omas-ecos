# Captures d'écran d'INES en local, après scripts/demo/seed.mjs.
# Usage : python3 scripts/demo/shots.py   (Chrome ou Chromium et le paquet playwright requis)
import asyncio, json, sys, os, shutil
HERE = os.path.dirname(os.path.abspath(__file__))
from playwright.async_api import async_playwright
S = json.load(open(os.path.join(HERE, 'seed.json')))
URL = 'http://localhost:8787/'
OUT = os.path.join(HERE, 'shots') + '/'
os.makedirs(OUT, exist_ok=True)
CHROME = shutil.which('google-chrome') or shutil.which('chromium') or None

async def login(pg, role, code, name=None):
    await pg.goto(URL + '#/'); await pg.wait_for_timeout(700)
    await pg.click(f'[data-r="{role}"]'); await pg.fill('#code', code)
    if name: await pg.fill('#name', name)
    await pg.click('#f button.primary'); await pg.wait_for_timeout(1200)

async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=CHROME) if CHROME else await p.chromium.launch()
        errs = []
        # --- équipe, ordinateur ---
        ctx = await b.new_context(viewport={'width': 1440, 'height': 900}, device_scale_factor=1.5)
        pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg, 'admin', 'test-admin')
        for name, hash_, wait in [('stations', '#/admin/session/1/stations', 1500), ('direct', '#/admin/session/1/direct', 2500),
                                  ('analyse', '#/admin/session/1/analyse', 3500), ('planning', '#/admin/session/1/planning', 1800),
                                  ('benevoles', '#/admin/session/1/benevoles', 1500), ('resultats', '#/admin/session/1/resultats', 1800)]:
            await pg.goto(URL + hash_); await pg.wait_for_timeout(wait)
            await pg.screenshot(path=OUT + f'{name}.png')
        await pg.goto(URL + f"#/station/{S['evalA1Station']}"); await pg.wait_for_timeout(1800)
        await pg.screenshot(path=OUT + 'editeur.png')
        await ctx.close()
        # --- téléphones ---
        phone = dict(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True)
        ctx = await b.new_context(**phone); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg, 'etudiant', S['upcoming']['code']); await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUT + 'convocation.png')
        await pg.evaluate('window.scrollTo(0, 700)'); await pg.wait_for_timeout(400)
        await pg.screenshot(path=OUT + 'convocation2.png')
        await ctx.close()
        ctx = await b.new_context(**phone); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg, 'etudiant', S['done']['code']); await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUT + 'resultats-etudiant.png')
        for i, y in enumerate([800, 1600, 2400]):
            await pg.evaluate(f'window.scrollTo(0, {y})'); await pg.wait_for_timeout(300)
            await pg.screenshot(path=OUT + f'resultats-etudiant-{i+1}.png')
        await ctx.close()
        ctx = await b.new_context(**phone); pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
        await login(pg, 'evaluateur', S['evalA1'], 'Dr Hugo Petit'); await pg.wait_for_timeout(800)
        await pg.screenshot(path=OUT + 'salle.png')
        cid = await pg.evaluate("fetch('/api/eval/context').then(r=>r.json()).then(j=>j.candidates.find(c=>c.series===2&&c.seat===2).id)")
        await pg.goto(URL + f'#/eval/candidat/{cid}'); await pg.wait_for_timeout(1200)
        for i in [0, 1, 2, 4, 5, 6]:
            await pg.locator('.yesno button.yes').nth(i).click(); await pg.wait_for_timeout(120)
        await pg.locator('.yesno button.no').nth(3).click(); await pg.wait_for_timeout(120)
        await pg.evaluate('window.scrollTo(0, 0)'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT + 'grille.png')
        await pg.evaluate('window.scrollTo(0, 520)'); await pg.wait_for_timeout(300)
        await pg.screenshot(path=OUT + 'grille2.png')
        await ctx.close()
        print('errors', errs)
        await b.close()
asyncio.run(main())
