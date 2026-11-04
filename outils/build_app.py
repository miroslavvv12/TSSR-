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

# les images sont construites en JS : src="imgN/${src}.jpg" via fig/fig2/fig3... -> table d'images inline
# (générique : gère img, img2, img3 et tout futur dossier imgN avec son helper figN)
table = {}
folders = sorted(d for d in os.listdir(SITE) if re.fullmatch(r'img\d*', d) and os.path.isdir(os.path.join(SITE, d)))
for folder in folders:
    n = folder[3:]
    for k in set(re.findall(r"fig" + n + r"\('([a-z0-9_]+)'", html)):
        table[folder + '/' + k] = base64.b64encode(open(os.path.join(SITE, folder, k + '.jpg'), 'rb').read()).decode()
    html = html.replace('src="' + folder + '/${src}.jpg"', 'src="${IMG(\'' + folder + '/\'+src)}"')
inject = '<script>const IMGS=' + json.dumps(table) + ';const IMG=p=>"data:image/jpeg;base64,"+IMGS[p];</script>\n'
html = html.replace('<script>\nconst CALC', inject + '<script>\nconst CALC', 1)
assert not re.search(r'src="img\d*/', html), 'un dossier d images n est pas géré'
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
os.remove(APP + "/app_plain.html")
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
