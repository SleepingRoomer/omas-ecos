"""Régénère les fichiers du logo INES dans public/img à partir de la police Rethink Sans.

Le S est la vraie lettre de la police (ExtraBold), découpée en dix bandes : cinq bleues en haut,
cinq turquoise en bas. Les bandes coupent aussi l'ombre portée lavande (le bleu à 40 %).

Prérequis (une fois) :
  pip install fonttools brotli skia-pathops
  npm pack @fontsource/rethink-sans && tar xzf fontsource-rethink-sans-*.tgz   (donne package/files/)
Usage :
  python3 scripts/brand/logo.py chemin/vers/rethink-sans-latin-800-normal.woff2
"""
import os, sys
import pathops
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

BLUE, TURQ, TURQ_LIGHT = '#2D2F84', '#00A09A', '#3FD3CB'
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'public', 'img')
f = TTFont(sys.argv[1]); gs = f.getGlyphSet(); cmap = f.getBestCmap()

def glyph(ch, x, dy=0):
    p = pathops.Path(); gs[cmap[ord(ch)]].draw(TransformPen(p.getPen(glyphSet=gs), (1, 0, 0, -1, x, 712 + dy))); return p
def rect(x0, y0, x1, y1):
    p = pathops.Path(); pen = p.getPen(); pen.moveTo((x0, y0)); pen.lineTo((x1, y0)); pen.lineTo((x1, y1)); pen.lineTo((x0, y1)); pen.closePath(); return p
def d(p):
    sp = SVGPathPen(None, ntos=lambda v: ('%.1f' % v).rstrip('0').rstrip('.')); p.draw(sp); return sp.getCommands()
PITCH, GAP = 724 / 10, 16
def bands(S, gap=GAP):
    out = []
    for i in range(10):
        y0 = -50 if i == 0 else i * PITCH + gap / 2
        y1 = 800 if i == 9 else (i + 1) * PITCH - gap / 2
        out.append(d(pathops.op(S, rect(-500, y0, 3000, y1), pathops.PathOp.INTERSECTION)))
    return out

# I, N, E, S avec une approche de -12 unités ; le S commence à x = 1468
I, N, E, S = d(glyph('I', 0)), d(glyph('N', 242)), d(glyph('E', 939)), glyph('S', 1468)
SB = bands(S)
gaps = pathops.Path()
for i in range(1, 10): gaps = pathops.op(gaps, rect(1300, i * PITCH - GAP / 2, 2300, i * PITCH + GAP / 2), pathops.PathOp.UNION)
S_SHADOW = d(pathops.op(glyph('S', 1508, 40), gaps, pathops.PathOp.DIFFERENCE))
S0B = bands(glyph('S', -6), 34)

def logo(shadow=True, letters=BLUE, top=BLUE, bot=TURQ, sh=BLUE, sho='.4'):
    s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="20 -10 2060 780" role="img"><title>INES</title>'
    if shadow: s += f'<g fill="{sh}" opacity="{sho}"><g transform="translate(40 40)"><path d="{I}"/><path d="{N}"/><path d="{E}"/></g><path d="{S_SHADOW}"/></g>'
    s += f'<g fill="{letters}"><path d="{I}"/><path d="{N}"/><path d="{E}"/></g>'
    s += f'<g fill="{top}">' + ''.join(f'<path d="{x}"/>' for x in SB[:5]) + f'</g><g fill="{bot}">' + ''.join(f'<path d="{x}"/>' for x in SB[5:]) + '</g></svg>'
    return s
def icon():
    s = f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><title>INES</title><rect width="1000" height="1000" rx="180" fill="{BLUE}"/>'
    s += '<g transform="translate(218 138)"><g fill="#FFFFFF">' + ''.join(f'<path d="{x}"/>' for x in S0B[:5]) + f'</g><g fill="{TURQ_LIGHT}">' + ''.join(f'<path d="{x}"/>' for x in S0B[5:]) + '</g></g></svg>'
    return s

files = {'ines-logo.svg': logo(), 'ines-logo-flat.svg': logo(shadow=False),
         'ines-logo-blanc.svg': logo(letters='#FFFFFF', top='#FFFFFF', bot=TURQ_LIGHT, sh='#0B0C2E', sho='.45'), 'ines-icon.svg': icon()}
for name, svg in files.items():
    open(os.path.join(OUT, name), 'w').write(svg); print(name, len(svg))
print('ines-icon-180.png : à regénérer à la main (capture de ines-icon.svg en 180 × 180).')
