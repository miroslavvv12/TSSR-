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
<meta name="theme-color" content="#121212">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}</style>
</head>
<body>
"""

# Questions des cours : tous les fichiers outils/quiz/*.json, injectés dans le fragment
# entre /*QUIZ_DEBUT*/ et /*QUIZ_FIN*/ (le fragment reste publiable tel quel).
import glob, json
quiz = []
for f in sorted(glob.glob(p('outils', 'quiz', '*.json'))):
    for x in json.load(open(f, encoding='utf-8')):
        assert set(x) == {'t', 's', 'q', 'o', 'e', 'x'} and len(x['o']) == 4 and len(x['x']) == 3, (f, x.get('q'))
        quiz.append(x)
data = json.dumps(quiz, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
fp = p('outils', 'entrainement.frag.html')
frag = open(fp, encoding='utf-8').read()
frag = re.sub(r'/\*QUIZ_DEBUT\*/.*?/\*QUIZ_FIN\*/', lambda m: '/*QUIZ_DEBUT*/' + data + '/*QUIZ_FIN*/', frag, count=1, flags=re.S)

# Questions ouvertes : outils/ouvertes/*.json, injectées entre /*OUV_DEBUT*/ et /*OUV_FIN*/.
# Chaque question : t (cours), s (source), q, r (réponse modèle), p (points attendus : [libellé, [mots-clés]]).
ouv = []
for f in sorted(glob.glob(p('outils', 'ouvertes', '*.json'))):
    for x in json.load(open(f, encoding='utf-8')):
        assert set(x) == {'t', 's', 'q', 'r', 'p'} and x['p'], (f, x.get('q'))
        assert all(len(pt) == 2 and isinstance(pt[0], str) and pt[1] for pt in x['p']), (f, x['q'])
        ouv.append(x)
data_ouv = json.dumps(ouv, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
frag = re.sub(r'/\*OUV_DEBUT\*/.*?/\*OUV_FIN\*/', lambda m: '/*OUV_DEBUT*/' + data_ouv + '/*OUV_FIN*/', frag, count=1, flags=re.S)
open(fp, 'w', encoding='utf-8').write(frag)
print(len(quiz), 'questions de cours,', len(ouv), 'questions ouvertes')
open(p('entrainement.html'), 'w', encoding='utf-8').write(HEAD + frag + '\n</body>\n</html>\n')

sw = open(p('sw.js'), encoding='utf-8').read()
if '"entrainement.html"' not in sw:
    sw = sw.replace('"index.html", ', '"index.html", "entrainement.html", ', 1)
h = hashlib.sha1(open(p('entrainement.html'), 'rb').read() + open(p('content.enc'), 'rb').read()).hexdigest()[:10]
sw = re.sub(r"tssr-[0-9a-f]+", "tssr-" + h, sw, count=1)
open(p('sw.js'), 'w', encoding='utf-8').write(sw)
print('entrainement.html construit, cache', 'tssr-' + h)
