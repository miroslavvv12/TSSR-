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
<link rel="manifest" href="manifest-entrainement.webmanifest">
<meta name="mobile-web-app-capable" content="yes">
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
        assert set(x) == {'t', 's', 'q', 'o', 'e', 'x', 'n'} and len(x['o']) == 4 and len(x['x']) == 3 and x['n'] in range(6), (f, x.get('q'))
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
        assert set(x) == {'t', 's', 'q', 'r', 'p', 'n'} and x['p'] and x['n'] in range(6), (f, x.get('q'))
        assert all(len(pt) == 2 and isinstance(pt[0], str) and pt[1] for pt in x['p']), (f, x['q'])
        ouv.append(x)
data_ouv = json.dumps(ouv, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
frag = re.sub(r'/\*OUV_DEBUT\*/.*?/\*OUV_FIN\*/', lambda m: '/*OUV_DEBUT*/' + data_ouv + '/*OUV_FIN*/', frag, count=1, flags=re.S)

# Simulateur Cisco (terminal + labs) : outils/cisco_sim.js, injecté entre /*CISCO_DEBUT*/ et /*CISCO_FIN*/.
sim = open(p('outils', 'cisco_sim.js'), encoding='utf-8').read().replace('</', '<\\/')
assert '/*CISCO_DEBUT*/' in frag and '/*CISCO_FIN*/' in frag
frag = re.sub(r'/\*CISCO_DEBUT\*/.*?/\*CISCO_FIN\*/', lambda m: '/*CISCO_DEBUT*/\n' + sim + '\n/*CISCO_FIN*/', frag, count=1, flags=re.S)
# Fiches à retenir : outils/fiches/*.json, injectées entre /*FICHES_DEBUT*/ et /*FICHES_FIN*/.
fiches = []
for f in sorted(glob.glob(p('outils', 'fiches', '*.json'))):
    for x in json.load(open(f, encoding='utf-8')):
        assert set(x) == {'t', 'src', 'intro', 'blocs', 'pieges'} and x['blocs'], (f, x.get('t'))
        assert x['t'] in {q['t'] for q in quiz}, ('fiche sans thème de quiz', x['t'])
        fiches.append(x)
data_fi = json.dumps(fiches, ensure_ascii=False, separators=(',', ':')).replace('</', '<\\/')
frag = re.sub(r'/\*FICHES_DEBUT\*/.*?/\*FICHES_FIN\*/', lambda m: '/*FICHES_DEBUT*/' + data_fi + '/*FICHES_FIN*/', frag, count=1, flags=re.S)
print(len(fiches), 'fiches')
# Bibliothèques QR (outils/vendor/qrcode.js MIT, outils/vendor/jsQR.js Apache 2.0), injectées entre /*QRLIB_DEBUT*/ et /*QRLIB_FIN*/.
qrlib = '\n'.join(open(p('outils', 'vendor', f), encoding='utf-8').read() for f in ('qrcode.js', 'jsQR.js')).replace('</', '<\\/')
assert '/*QRLIB_DEBUT*/' in frag and '/*QRLIB_FIN*/' in frag
frag = re.sub(r'/\*QRLIB_DEBUT\*/.*?/\*QRLIB_FIN\*/', lambda m: '/*QRLIB_DEBUT*/\n' + qrlib + '\n/*QRLIB_FIN*/', frag, count=1, flags=re.S)
# Terminal Linux (outils/linux_sim.js), injecté entre /*LINUX_DEBUT*/ et /*LINUX_FIN*/.
lx = open(p('outils', 'linux_sim.js'), encoding='utf-8').read().replace('</', '<\\/')
assert '/*LINUX_DEBUT*/' in frag and '/*LINUX_FIN*/' in frag
frag = re.sub(r'/\*LINUX_DEBUT\*/.*?/\*LINUX_FIN\*/', lambda m: '/*LINUX_DEBUT*/\n' + lx + '\n/*LINUX_FIN*/', frag, count=1, flags=re.S)
open(fp, 'w', encoding='utf-8').write(frag)
print(len(quiz), 'questions de cours,', len(ouv), 'questions ouvertes')
# Appli installable seule (PC : Edge / Chrome → « Installer ») et hors ligne : la page enregistre elle-même le service worker,
# et propose « Mettre à jour » quand une nouvelle version est arrivée.
SWJS = """<div id="updE" hidden style="position:fixed;bottom:calc(14px + env(safe-area-inset-bottom,0px));left:50%;transform:translateX(-50%);z-index:60;background:var(--accent);color:var(--accent-ink);padding:10px 14px;border-radius:10px;font:15px var(--f-ui);white-space:nowrap">Nouvelle version disponible · <a href="#" id="updEgo" style="color:inherit;font-weight:600">Mettre à jour</a></div>
<script>
if('serviceWorker' in navigator&&location.protocol!=='file:'){navigator.serviceWorker.register('sw.js').then(reg=>{
 const show=()=>{document.getElementById('updE').hidden=false};
 if(reg.waiting&&navigator.serviceWorker.controller)show();
 reg.addEventListener('updatefound',()=>{const w=reg.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)show()})});
 document.getElementById('updEgo').onclick=e=>{e.preventDefault();if(reg.waiting)reg.waiting.postMessage('skip');else location.reload()};
 reg.update();setInterval(()=>reg.update(),3600000);
}).catch(()=>{});
 let r=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!r&&!document.getElementById('updE').hidden){r=true;location.reload()}});}
</script>"""
open(p('entrainement.html'), 'w', encoding='utf-8').write(HEAD + frag + '\n' + SWJS + '\n</body>\n</html>\n')

sw = open(p('sw.js'), encoding='utf-8').read()
if '"entrainement.html"' not in sw:
    sw = sw.replace('"index.html", ', '"index.html", "entrainement.html", ', 1)
if '"manifest-entrainement.webmanifest"' not in sw:
    sw = sw.replace('"manifest.webmanifest", ', '"manifest.webmanifest", "manifest-entrainement.webmanifest", ', 1)
h = hashlib.sha1(b''.join(open(p(f), 'rb').read() for f in ('entrainement.html', 'index.html', 'content.enc'))).hexdigest()[:10]
sw = re.sub(r"tssr-[0-9a-f]+", "tssr-" + h, sw, count=1)
open(p('sw.js'), 'w', encoding='utf-8').write(sw)
print('entrainement.html construit, cache', 'tssr-' + h)
