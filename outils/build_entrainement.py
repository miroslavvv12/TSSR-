"""Construit entrainement.html (page autonome du site) à partir de outils/entrainement.frag.html,
puis l'ajoute au cache hors ligne de sw.js en changeant le nom du cache."""
import hashlib, os, re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
p = lambda *a: os.path.join(ROOT, *a)

HEAD = """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="theme-color" content="#111417">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
"""

frag = open(p('outils', 'entrainement.frag.html'), encoding='utf-8').read()
open(p('entrainement.html'), 'w', encoding='utf-8').write(HEAD + frag + '\n</body>\n</html>\n')

sw = open(p('sw.js'), encoding='utf-8').read()
if '"entrainement.html"' not in sw:
    sw = sw.replace('"index.html", ', '"index.html", "entrainement.html", ', 1)
h = hashlib.sha1(open(p('entrainement.html'), 'rb').read() + open(p('content.enc'), 'rb').read()).hexdigest()[:10]
sw = re.sub(r"tssr-[0-9a-f]+", "tssr-" + h, sw, count=1)
open(p('sw.js'), 'w', encoding='utf-8').write(sw)
print('entrainement.html construit, cache', 'tssr-' + h)
