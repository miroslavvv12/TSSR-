"""Construit l'appli chiffrée dans /home/claude/app/dist à partir de /home/claude/src/site/index.html."""
import base64, re, os, json, hashlib, shutil, subprocess, sys
SITE = '/home/claude/src/site'
APP = '/home/claude/app'
DIST = APP + '/dist'
KEYS = sys.argv[1] if len(sys.argv) > 1 else APP + '/keys.json'

html = open(SITE + '/index.html', encoding='utf-8').read()

def inline(m):
    path = os.path.join(SITE, m.group(1))
    data = base64.b64encode(open(path, 'rb').read()).decode()
    return 'src="data:image/jpeg;base64,' + data + '"'

# les images sont construites en JS : src="img/${src}.jpg" -> on remplace la fonction fig/fig2 par une table d'images
imgs = {}
for folder in ('img', 'img2'):
    for f in os.listdir(os.path.join(SITE, folder)):
        imgs[folder + '/' + f[:-4]] = base64.b64encode(open(os.path.join(SITE, folder, f), 'rb').read()).decode()
used = set(re.findall(r"fig\('([a-z0-9_]+)'", html))
used2 = set(re.findall(r"fig2\('([a-z0-9_]+)'", html))
table = {('img/' + k): imgs['img/' + k] for k in used}
table.update({('img2/' + k): imgs['img2/' + k] for k in used2})
inject = '<script>const IMGS=' + json.dumps(table) + ';const IMG=p=>"data:image/jpeg;base64,"+IMGS[p];</script>\n'
html = html.replace('<script>\nconst CALC', inject + '<script>\nconst CALC', 1)
html = html.replace('src="img/${src}.jpg"', 'src="${IMG(\'img/\'+src)}"')
html = html.replace('src="img2/${src}.jpg"', 'src="${IMG(\'img2/\'+src)}"')
assert 'src="img/' not in html and 'src="img2/' not in html
html = html.replace('<meta name="theme-color"', '<meta name="robots" content="noindex, nofollow">\n<meta name="apple-mobile-web-app-capable" content="yes">\n<meta name="theme-color"', 1)
html = html.replace('<meta name="viewport" content="width=device-width, initial-scale=1">', '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">')
html = html.replace('header{position:sticky;top:0;', 'header{position:sticky;top:0;padding-top:env(safe-area-inset-top);')
upd = '''<div id="upd" style="display:none;position:fixed;bottom:calc(14px + env(safe-area-inset-bottom));left:50%;transform:translateX(-50%);background:#2a3a4c;border:1px solid #4f6a86;color:#e3edf7;padding:10px 14px;border-radius:10px;z-index:60;font-size:15px;white-space:nowrap">Nouvelle version disponible · <a href="#" id="updgo" style="color:#fff;font-weight:600">Mettre à jour</a></div>
<script>
if('serviceWorker' in navigator){navigator.serviceWorker.register('sw.js').then(reg=>{
 const show=()=>{document.getElementById('upd').style.display='block'};
 if(reg.waiting)show();
 reg.addEventListener('updatefound',()=>{const w=reg.installing;w&&w.addEventListener('statechange',()=>{if(w.state==='installed'&&navigator.serviceWorker.controller)show()})});
 document.getElementById('updgo').onclick=e=>{e.preventDefault();if(reg.waiting)reg.waiting.postMessage('skip');else location.reload()};
 reg.update();setInterval(()=>reg.update(),3600000);
}).catch(()=>{});
 let r=false;navigator.serviceWorker.addEventListener('controllerchange',()=>{if(!r){r=true;location.reload()}});}
</script>
</body>'''
html = html.replace('</body>', upd, 1)

shutil.rmtree(DIST, ignore_errors=True)
os.makedirs(DIST + '/icons')
open(APP + '/app_plain.html', 'w', encoding='utf-8').write(html)
subprocess.run(['node', APP + '/encrypt.mjs', KEYS, APP + '/app_plain.html', DIST + '/content.enc'], check=True)
os.remove(APP + '/app_plain.html')
shutil.copy(KEYS, DIST + '/keys.json')
shutil.copy(APP + '/shell.html', DIST + '/index.html')
for f in os.listdir('/home/claude/src/pwa/icons'):
    shutil.copy('/home/claude/src/pwa/icons/' + f, DIST + '/icons/' + f)
shutil.copy('/home/claude/src/pwa/manifest.webmanifest', DIST + '/manifest.webmanifest')
open(DIST + '/.nojekyll', 'w').close()
open(DIST + '/robots.txt', 'w').write('User-agent: *\nDisallow: /\n')
files = ['./', 'index.html', 'manifest.webmanifest', 'keys.json', 'content.enc'] + ['icons/' + f for f in sorted(os.listdir(DIST + '/icons'))]
h = hashlib.sha1(b''.join(open(DIST + '/' + f, 'rb').read() for f in files if f != './')).hexdigest()[:10]
sw = f'''const CACHE='tssr-{h}';
const FILES={json.dumps(files)};
self.addEventListener('install',e=>{{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES.map(f=>new Request(f,{{cache:'reload'}})))))}});
self.addEventListener('activate',e=>{{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))}});
self.addEventListener('message',e=>{{if(e.data==='skip')self.skipWaiting()}});
self.addEventListener('fetch',e=>{{if(e.request.method!=='GET')return;
 e.respondWith(caches.open(CACHE).then(c=>c.match(e.request,{{ignoreSearch:true}}).then(r=>r||fetch(e.request).catch(()=>c.match('index.html')))))}});
'''
open(DIST + '/sw.js', 'w').write(sw)
print('OK, version', h)
