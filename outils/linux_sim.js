/* =====================================================================
   Terminal Linux simulé (bash) : système de fichiers, droits UGO, utilisateurs
   et groupes, liens physiques et symboliques, processus.
   Notions tirées du cours « Initiation à Linux » (David Rodriguez) ; les
   commandes elles-mêmes sont des notions générales (hors cours).
   ===================================================================== */
const LinuxSim = (() => {
const HOST = 'tssr-pc';
const MONTHS = ['janv.', 'févr.', 'mars', 'avril', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const E = { noent: 'Aucun fichier ou dossier de ce type', acces: 'Permission non accordée', notdir: "N'est pas un dossier", isdir: 'est un dossier', exist: 'Le fichier existe', notempty: "Le dossier n'est pas vide", perm: 'Opération non permise', loop: 'Trop de niveaux de liens symboliques' };

/* ---------- création du système ---------- */
function mk(st, t, m, u, g, extra) { const ino = st.next++; st.fs[ino] = Object.assign({ t, m, u, g, mt: Date.now() }, extra || {}); return ino; }
function mkdirIn(st, dir, name, m, u, g) { const ino = mk(st, 'd', m, u, g, { k: {}, p: dir }); st.fs[dir].k[name] = ino; return ino; }
function mkfileIn(st, dir, name, m, u, g, data) { const ino = mk(st, 'f', m, u, g, { d: data || '' }); st.fs[dir].k[name] = ino; return ino; }
function newSys() {
  const st = { fs: {}, next: 2, cwd: '/home/dimitri', user: 'dimitri', stack: [], seen: {}, hist: [], pend: null, nextPid: 1200,
    users: [
      { n: 'root', uid: 0, gid: 0, home: '/root', pw: null },
      { n: 'www-data', uid: 33, gid: 33, home: '/var/www', pw: null },
      { n: 'dimitri', uid: 1000, gid: 1000, home: '/home/dimitri', pw: 'tssr' },
      { n: 'alice', uid: 1001, gid: 1001, home: '/home/alice', pw: 'alice' }],
    groups: [{ n: 'root', gid: 0, m: [] }, { n: 'sudo', gid: 27, m: ['dimitri'] }, { n: 'www-data', gid: 33, m: [] }, { n: 'shadow', gid: 42, m: [] }, { n: 'dimitri', gid: 1000, m: [] }, { n: 'alice', gid: 1001, m: [] }],
    procs: [
      { pid: 1, pp: 0, u: 0, c: 'init' }, { pid: 312, pp: 1, u: 0, c: 'sshd' }, { pid: 420, pp: 1, u: 0, c: 'cron' },
      { pid: 610, pp: 1, u: 33, c: 'apache2' }, { pid: 611, pp: 610, u: 33, c: 'apache2' },
      { pid: 845, pp: 1, u: 1000, c: 'bash' }] };
  const R = 1; st.fs[R] = { t: 'd', m: 0o755, u: 0, g: 0, k: {}, p: R, mt: Date.now() };
  const d = (n, m = 0o755, u = 0, g = 0, at = R) => mkdirIn(st, at, n, m, u, g);
  for (const n of ['bin', 'boot', 'dev', 'lib', 'media', 'mnt', 'opt', 'proc', 'sbin', 'srv', 'sys', 'usr', 'var']) d(n);
  d('tmp', 0o1777); const etc = d('etc'); const home = d('home'); d('root', 0o700);
  for (const c of ['bash', 'ls', 'cat', 'cp', 'mv', 'rm', 'chmod', 'mkdir', 'ps']) mkfileIn(st, st.fs[R].k.bin, c, 0o755, 0, 0, '(programme)');
  for (const c of ['useradd', 'usermod', 'groupadd', 'init']) mkfileIn(st, st.fs[R].k.sbin, c, 0o755, 0, 0, '(programme)');
  for (const c of ['sda', 'sda1', 'tty1', 'null']) mkfileIn(st, st.fs[R].k.dev, c, 0o660, 0, 0, '');
  mkfileIn(st, st.fs[R].k.boot, 'vmlinuz', 0o644, 0, 0, '(noyau Linux)');
  mkfileIn(st, etc, 'hostname', 0o644, 0, 0, HOST + '\n');
  mkfileIn(st, etc, 'inittab', 0o644, 0, 0, '# Niveau d\'exécution par défaut\nid:5:initdefault:\n');
  mkfileIn(st, etc, 'fstab', 0o644, 0, 0, '/dev/sda1  /  ext4  defaults  0  1\n');
  mkfileIn(st, etc, 'passwd', 0o644, 0, 0); mkfileIn(st, etc, 'group', 0o644, 0, 0); mkfileIn(st, etc, 'shadow', 0o640, 0, 42);
  const log = d('log', 0o755, 0, 0, st.fs[R].k.var); mkfileIn(st, log, 'syslog', 0o640, 0, 0, 'nov. 26 08:00:01 tssr-pc systemd[1]: Démarrage terminé.\nnov. 26 08:00:05 tssr-pc sshd[312]: Serveur en écoute sur le port 22.\nnov. 26 08:02:10 tssr-pc cron[420]: (root) CMD (sauvegarde)\n');
  d('www', 0o755, 33, 33, st.fs[R].k.var);
  for (const u of st.users.filter(x => x.home.startsWith('/home/'))) { const h = d(u.n, 0o750, u.uid, u.gid, home); mkfileIn(st, h, '.bashrc', 0o644, u.uid, u.gid, '# Configuration du shell bash\n'); }
  syncEtc(st); return st;
}
function syncEtc(st) {
  const etc = st.fs[1].k.etc, K = st.fs[etc].k;
  st.fs[K.passwd].d = st.users.map(u => `${u.n}:x:${u.uid}:${u.gid}::${u.home}:${u.uid === 33 ? '/usr/sbin/nologin' : '/bin/bash'}`).join('\n') + '\n';
  st.fs[K.group].d = st.groups.map(g => `${g.n}:x:${g.gid}:${g.m.join(',')}`).join('\n') + '\n';
  st.fs[K.shadow].d = st.users.map(u => `${u.n}:${u.pw ? '$6$tssr$' + btoa(u.n + u.pw).replace(/=/g, '') : '*'}:20000:0:99999:7:::`).join('\n') + '\n';
}

/* ---------- utilisateurs ---------- */
const U = (st, n) => st.users.find(u => u.n === n);
const UID = (st, uid) => st.users.find(u => u.uid === uid);
const G = (st, n) => st.groups.find(g => g.n === n);
const GID = (st, gid) => st.groups.find(g => g.gid === gid);
const cur = st => U(st, st.user);
function gidsOf(st, u) { return [u.gid, ...st.groups.filter(g => g.m.includes(u.n)).map(g => g.gid)].filter((x, i, a) => a.indexOf(x) === i); }
function can(st, node, bit, u) { u = u || cur(st); if (u.uid === 0) return bit !== 1 || node.t === 'd' || (node.m & 0o111) !== 0; const sh = node.u === u.uid ? 6 : gidsOf(st, u).includes(node.g) ? 3 : 0; return ((node.m >> sh) & bit) !== 0; }

/* ---------- chemins ---------- */
function absOf(st, ino) { if (ino === 1) return '/'; const parts = []; let i = ino; while (i !== 1) { const p = st.fs[i].p; const name = Object.keys(st.fs[p].k).find(k => st.fs[p].k[k] === i); parts.unshift(name); i = p; } return '/' + parts.join('/'); }
function expandHome(st, p) { if (p === '~' || p.startsWith('~/')) return cur(st).home + p.slice(1); const m = /^~([a-z_][\w-]*)(\/.*)?$/.exec(p); if (m && U(st, m[1])) return U(st, m[1]).home + (m[2] || ''); return p; }
// Résout un chemin. Renvoie { ino, dir, name } ou { err, at } ; ino = null si le dernier élément n'existe pas.
function walk(st, path, follow = true, depth = 0) {
  if (depth > 8) return { err: E.loop };
  path = expandHome(st, path);
  let at = path.startsWith('/') ? 1 : walk(st, st.cwd, true, depth + 1).ino;
  if (at == null) at = 1;
  const comps = path.split('/').filter(c => c && c !== '.');
  if (!comps.length) return { ino: at, dir: st.fs[at].p, name: '.' };
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i], last = i === comps.length - 1, node = st.fs[at];
    if (node.t !== 'd') return { err: E.notdir };
    if (!can(st, node, 1)) return { err: E.acces };
    if (c === '..') { at = node.p; if (last) return { ino: at, dir: st.fs[at].p, name: '..' }; continue; }
    const ch = node.k[c];
    if (ch == null) return last ? { ino: null, dir: at, name: c } : { err: E.noent };
    const cn = st.fs[ch];
    if (cn.t === 'l' && (!last || follow)) {
      const tgt = cn.l.startsWith('/') ? cn.l : absOf(st, at).replace(/\/$/, '') + '/' + cn.l;
      const r = walk(st, tgt, true, depth + 1); if (r.err) return r;
      if (last) return r.ino == null ? { err: E.noent, dangling: true } : r;
      if (r.ino == null) return { err: E.noent };
      at = r.ino; continue;
    }
    if (last) return { ino: ch, dir: at, name: c };
    at = ch;
  }
  return { ino: at, dir: st.fs[at].p, name: comps[comps.length - 1] };
}
function absPath(st, p) { const r = walk(st, p, false); if (r.err) return null; if (r.ino != null && st.fs[r.ino].t === 'd') return absOf(st, r.ino); return absOf(st, r.dir).replace(/\/$/, '') + '/' + r.name; }
function links(st, ino) { let n = 0; for (const x of Object.values(st.fs)) if (x.t === 'd') for (const [k, v] of Object.entries(x.k)) if (v === ino) n++; const me = st.fs[ino]; if (me.t === 'd') n = 2 + Object.values(me.k).filter(v => st.fs[v] && st.fs[v].t === 'd').length; return n; }
function unlink(st, dir, name) { const ino = st.fs[dir].k[name]; delete st.fs[dir].k[name]; if (ino != null && st.fs[ino] && st.fs[ino].t !== 'd' && links(st, ino) === 0) delete st.fs[ino]; }

/* ---------- affichage ---------- */
function modeStr(n) { const t = n.t === 'd' ? 'd' : n.t === 'l' ? 'l' : '-'; let s = ''; for (let sh = 6; sh >= 0; sh -= 3) { const v = n.m >> sh; s += (v & 4 ? 'r' : '-') + (v & 2 ? 'w' : '-') + (v & 1 ? 'x' : '-'); } if (n.m & 0o1000) s = s.slice(0, 8) + (n.m & 1 ? 't' : 'T'); return t + s; }
function dateStr(ms) { const d = new Date(ms); return `${MONTHS[d.getMonth()].padEnd(5)} ${String(d.getDate()).padStart(2)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }
const sizeOf = n => n.t === 'd' ? 4096 : n.t === 'l' ? n.l.length : new TextEncoder().encode(n.d).length;
const uname = (st, uid) => (UID(st, uid) || { n: String(uid) }).n, gname = (st, gid) => (GID(st, gid) || { n: String(gid) }).n;
function prompt(st) { if (st.pend && st.pend.prompt != null) return st.pend.prompt; const u = cur(st); let p = st.cwd; if (p === u.home) p = '~'; else if (p.startsWith(u.home + '/')) p = '~' + p.slice(u.home.length); return `${u.n}@${HOST}:${p}${u.uid === 0 ? '#' : '$'} `; }

/* ---------- analyse de la ligne ---------- */
function tokenize(line) {
  const out = []; let t = '', q = null, any = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === q) q = null; else t += c; continue; }
    if (c === '"' || c === "'") { q = c; any = true; continue; }
    if (c === ' ' || c === '\t') { if (t || any) out.push(t); t = ''; any = false; continue; }
    if (c === '|' || c === '>' || c === '&') { if (t || any) out.push(t); t = ''; any = false; if (c === '>' && line[i + 1] === '>') { out.push({ op: '>>' }); i++; } else out.push({ op: c }); continue; }
    t += c;
  }
  if (q) return { err: 'bash: fin de fichier inattendue en cherchant « ' + q + ' »' };
  if (t || any) out.push(t); return out;
}
function vars(st, s) { const u = cur(st); return s.replace(/\$(USER|HOME|PWD|HOSTNAME)\b/g, (m, v) => ({ USER: u.n, HOME: u.home, PWD: st.cwd, HOSTNAME: HOST }[v])); }
function glob(st, a) {
  if (!/[*?]/.test(a)) return [a];
  const i = a.lastIndexOf('/'), base = i < 0 ? '' : a.slice(0, i + 1), pat = a.slice(i + 1);
  const r = walk(st, base || '.'); if (r.err || r.ino == null || st.fs[r.ino].t !== 'd') return [a];
  const re = new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
  const m = Object.keys(st.fs[r.ino].k).filter(n => re.test(n) && (pat.startsWith('.') || !n.startsWith('.'))).sort();
  return m.length ? m.map(n => base + n) : [a];
}
function opts(args, known) { const o = {}, rest = []; let stop = false; for (const a of args) { if (!stop && a === '--') { stop = true; continue; } if (!stop && /^-[a-zA-Z]+$/.test(a)) { for (const c of a.slice(1)) o[c] = true; } else rest.push(a); } return [o, rest]; }

/* ---------- commandes ---------- */
const HELP = {
  pwd: 'affiche le dossier courant', cd: 'change de dossier (cd /etc, cd .., cd ~)', ls: 'liste un dossier (-l détails, -a fichiers cachés, -i numéros d\'inode)', tree: 'affiche une arborescence',
  mkdir: 'crée un dossier (-p : avec les parents)', rmdir: 'supprime un dossier vide', touch: 'crée un fichier vide', cat: 'affiche un fichier', echo: 'affiche du texte (echo "texte" > fichier pour écrire)',
  cp: 'copie (-r pour un dossier)', mv: 'déplace ou renomme', rm: 'supprime (-r pour un dossier)', ln: 'crée un lien physique (ln -s : symbolique)', file: 'indique le type d\'un fichier', find: 'cherche des fichiers (find /home -name "*.txt")',
  chmod: 'change les droits (chmod 750 f, chmod u+x f)', chown: 'change le propriétaire (chown bob:compta f)', chgrp: 'change le groupe',
  id: 'affiche UID, GID et groupes', whoami: 'affiche l\'utilisateur courant', groups: 'affiche les groupes', su: 'change d\'utilisateur (su - alice)', sudo: 'exécute une commande en root', exit: 'quitte la session su',
  useradd: 'crée un utilisateur (-m : avec son dossier personnel)', userdel: 'supprime un utilisateur (-r : et son dossier)', usermod: 'modifie un utilisateur (usermod -aG groupe user)', groupadd: 'crée un groupe', passwd: 'change un mot de passe',
  ps: 'liste les processus (ps -ef : tous)', pstree: 'affiche l\'arbre des processus', kill: 'arrête un processus (kill PID)', sleep: 'attend (sleep 300 & : en arrière-plan)',
  grep: 'filtre les lignes (grep motif fichier, ou après |)', head: 'premières lignes', tail: 'dernières lignes', wc: 'compte (wc -l : lignes)', history: 'historique des commandes', clear: 'efface l\'écran', hostname: 'nom de la machine', man: 'aide d\'une commande', help: 'liste des commandes' };
const ADMIN = ['useradd', 'userdel', 'usermod', 'groupadd'];

function run(st, line) {
  const raw = line; line = line.trim();
  if (!line) return '';
  if (line === 'clear') { st.hist.push(raw); return { clear: true }; }
  st.hist.push(raw); if (st.hist.length > 200) st.hist.shift();
  const tk = tokenize(line); if (tk.err) return tk.err;
  // arrière-plan « & »
  let bg = false; if (tk.length && tk[tk.length - 1].op === '&') { bg = true; tk.pop(); }
  // redirection
  let redir = null; const ri = tk.findIndex(x => x.op === '>' || x.op === '>>');
  if (ri >= 0) { const f = tk[ri + 1]; if (typeof f !== 'string') return 'bash: erreur de syntaxe près du symbole inattendu « newline »'; redir = { op: tk[ri].op, f: vars(st, f) }; tk.splice(ri, 2); }
  // tubes
  const cmds = [[]]; for (const x of tk) { if (x.op === '|') cmds.push([]); else if (typeof x === 'string') cmds[cmds.length - 1].push(x); else return 'bash: erreur de syntaxe près du symbole inattendu « ' + x.op + ' »'; }
  if (cmds.some(c => !c.length)) return 'bash: erreur de syntaxe près du symbole inattendu « | »';
  let input = null, out = '', err = '';
  for (const [ci, c] of cmds.entries()) {
    st.piped = ci < cmds.length - 1 || !!redir;
    let args = c.map(a => vars(st, a)); args = [args[0], ...args.slice(1).flatMap(a => glob(st, a))];
    const r = cmd(st, args, input, bg); st.piped = false;
    err += r.err ? (err ? '\n' : '') + r.err : '';
    input = r.out || ''; out = input;
  }
  if (redir) {
    const r = walk(st, redir.f);
    if (r.err) return (err ? err + '\n' : '') + 'bash: ' + redir.f + ': ' + r.err;
    if (r.ino != null) { const n = st.fs[r.ino]; if (n.t === 'd') return 'bash: ' + redir.f + ': ' + E.isdir; if (!can(st, n, 2)) return 'bash: ' + redir.f + ': ' + E.acces; n.d = (redir.op === '>>' ? n.d : '') + out; n.mt = Date.now(); }
    else { const dn = st.fs[r.dir]; if (!can(st, dn, 2) || !can(st, dn, 1)) return 'bash: ' + redir.f + ': ' + E.acces; const u = cur(st); mkfileIn(st, r.dir, r.name, 0o664 & ~(u.uid === 0 ? 0o020 : 0), u.uid, u.gid, out); }
    st.seen['redir:' + absPath(st, redir.f)] = true;
    return err;
  }
  return [err, out.replace(/\n$/, '')].filter(Boolean).join('\n');
}

function cmd(st, args, input, bg) {
  const [c, ...a] = args; const u = cur(st);
  const ok = s => ({ out: s == null ? '' : (s && !s.endsWith('\n') ? s + '\n' : s) });
  const ko = s => ({ err: s });
  const need = (r, p) => r.err ? `${c}: impossible d'accéder à '${p}': ${r.err}` : r.ino == null ? `${c}: impossible d'accéder à '${p}': ${E.noent}` : null;
  st.seen[c] = true;
  switch (c) {
  case 'help': return ok('Commandes disponibles :\n' + Object.entries(HELP).map(([k, v]) => '  ' + k.padEnd(9) + v).join('\n') + '\nAstuce : Tab complète, ↑ rappelle les commandes, « man commande » donne l\'aide.');
  case 'man': return a[0] && HELP[a[0]] ? ok(`${a[0]} : ${HELP[a[0]]}`) : ko(`Il n'y a pas de page de manuel pour ${a[0] || '?'}.`);
  case 'clear': return { out: '', clear: true };
  case 'pwd': return ok(st.cwd);
  case 'hostname': return ok(HOST);
  case 'whoami': return ok(u.n);
  case 'history': return ok(st.hist.map((h, i) => String(i + 1).padStart(5) + '  ' + h).join('\n'));
  case 'uname': return ok(a.includes('-a') ? `Linux ${HOST} 6.8.0-tssr #1 SMP x86_64 GNU/Linux` : 'Linux');
  case 'nano': case 'vi': case 'vim': return ko(`${c} : éditeur non disponible dans ce simulateur. Écris avec : echo "texte" > fichier (ou >> pour ajouter).`);
  case 'cd': {
    const p = a[0] == null ? u.home : a[0] === '-' ? (st.old || st.cwd) : a[0];
    const r = walk(st, p);
    if (r.err || r.ino == null) return ko(`bash: cd: ${a[0]}: ${r.err || E.noent}`);
    const n = st.fs[r.ino]; if (n.t !== 'd') return ko(`bash: cd: ${a[0]}: ${E.notdir}`);
    if (!can(st, n, 1)) return ko(`bash: cd: ${a[0]}: ${E.acces}`);
    st.old = st.cwd; st.cwd = absOf(st, r.ino); st.seen['cd:' + st.cwd] = true; return ok('');
  }
  case 'ls': {
    const [o, ps] = opts(a); const paths = ps.length ? ps : ['.']; const blocks = [];
    if (o.l) st.seen['ls-l'] = true; if (o.i) st.seen['ls-i'] = true; if (o.l && o.i) st.seen['ls-li'] = true; if (o.a) st.seen['ls-a'] = true;
    const line = (name, ino) => { const n = st.fs[ino]; let s = ''; if (o.i) s += String(ino).padStart(6) + ' '; if (!o.l) return s + name; return s + `${modeStr(n)} ${String(links(st, ino)).padStart(2)} ${uname(st, n.u).padEnd(8)} ${gname(st, n.g).padEnd(8)} ${String(sizeOf(n)).padStart(5)} ${dateStr(n.mt)} ${name}${n.t === 'l' ? ' -> ' + n.l : ''}`; };
    let errs = [];
    for (const p of paths) {
      const r = walk(st, p, !o.l || /\/$/.test(p)); const e = need(r, p); if (e) { errs.push(`ls: impossible d'accéder à '${p}': ${r.err || E.noent}`); continue; }
      const n = st.fs[r.ino];
      if (n.t !== 'd' || o.d) { blocks.push(line(p, r.ino)); continue; }
      if (!can(st, n, 4)) { errs.push(`ls: impossible d'ouvrir le dossier '${p}': ${E.acces}`); continue; }
      st.seen['ls:' + absOf(st, r.ino)] = true;
      let names = Object.keys(n.k).filter(x => o.a || !x.startsWith('.')).sort((x, y) => x.replace(/^\./, '').localeCompare(y.replace(/^\./, '')));
      const ent = names.map(x => [x, n.k[x]]); if (o.a) ent.unshift(['.', r.ino], ['..', n.p]);
      const body = o.l ? ['total ' + ent.length * 4, ...ent.map(([x, i]) => line(x, i))].join('\n') : ent.map(([x, i]) => line(x, i)).join(o.i || st.piped ? '\n' : '  ');
      blocks.push((paths.length > 1 ? p + ' :\n' : '') + body);
    }
    return { out: blocks.join('\n\n') + (blocks.length ? '\n' : ''), err: errs.join('\n') || undefined };
  }
  case 'tree': {
    const p = a[0] || '.'; const r = walk(st, p); const e = need(r, p); if (e) return ko(e);
    const L = [p]; let nd = 0, nf = 0;
    const rec = (ino, pre) => { const n = st.fs[ino]; if (!can(st, n, 4)) return; const ks = Object.keys(n.k).filter(x => !x.startsWith('.')).sort(); ks.forEach((k, i) => { const ch = n.k[k], cn = st.fs[ch], last = i === ks.length - 1; L.push(pre + (last ? '└── ' : '├── ') + k + (cn.t === 'l' ? ' -> ' + cn.l : '')); if (cn.t === 'd') { nd++; rec(ch, pre + (last ? '    ' : '│   ')); } else nf++; }); };
    if (st.fs[r.ino].t === 'd') rec(r.ino, ''); st.seen['tree'] = true;
    return ok(L.join('\n') + `\n\n${nd} dossiers, ${nf} fichiers`);
  }
  case 'cat': {
    if (!a.length) return ok(input || '');
    let out = '', errs = [];
    for (const p of a) {
      const r = walk(st, p);
      if (r.err || r.ino == null) { errs.push(`cat: ${p}: ${r.err || E.noent}`); st.seen['catfail:' + absPath(st, p)] = st.user; continue; }
      const n = st.fs[r.ino]; if (n.t === 'd') { errs.push(`cat: ${p}: ${E.isdir}`); continue; }
      const ap = absPath(st, p);
      if (!can(st, n, 4)) { errs.push(`cat: ${p}: ${E.acces}`); st.seen['denied:' + ap] = st.user; continue; }
      out += n.d; st.seen['cat:' + ap] = st.user; st.seen['catok:' + ap + ':' + st.user] = true;
    }
    return { out, err: errs.join('\n') || undefined };
  }
  case 'echo': { const n = a[0] === '-n'; return { out: (n ? a.slice(1) : a).join(' ') + (n ? '' : '\n') }; }
  case 'grep': {
    const [o, r] = opts(a); if (!r.length) return ko('Utilisation : grep [OPTION]... MOTIFS [FICHIER]...');
    const pat = o.i ? r[0].toLowerCase() : r[0]; let txt = input || '';
    if (r[1]) { const w = walk(st, r[1]); if (w.err || w.ino == null) return ko(`grep: ${r[1]}: ${w.err || E.noent}`); const n = st.fs[w.ino]; if (!can(st, n, 4)) return ko(`grep: ${r[1]}: ${E.acces}`); txt = n.d || ''; }
    const L = txt.split('\n').filter(l => l && ((o.i ? l.toLowerCase() : l).includes(pat) !== !!o.v)); st.seen['grep'] = true; if (r[1]) st.seen['grep:' + absPath(st, r[1])] = true;
    return ok(L.join('\n'));
  }
  case 'head': case 'tail': {
    let n = 10, f = null; for (let i = 0; i < a.length; i++) { if (a[i] === '-n') n = +a[++i]; else if (/^-\d+$/.test(a[i])) n = +a[i].slice(1); else f = a[i]; }
    let txt = input || ''; if (f) { const w = walk(st, f); if (w.err || w.ino == null) return ko(`${c}: impossible d'ouvrir '${f}' en lecture: ${w.err || E.noent}`); if (!can(st, st.fs[w.ino], 4)) return ko(`${c}: impossible d'ouvrir '${f}' en lecture: ${E.acces}`); txt = st.fs[w.ino].d; }
    const L = txt.replace(/\n$/, '').split('\n'); return ok((c === 'head' ? L.slice(0, n) : L.slice(-n)).join('\n'));
  }
  case 'wc': { let txt = input || ''; const f = a.find(x => !x.startsWith('-')); if (f) { const w = walk(st, f); if (w.err || w.ino == null) return ko(`wc: ${f}: ${w.err || E.noent}`); txt = st.fs[w.ino].d; } const l = (txt.match(/\n/g) || []).length; return ok(a.includes('-l') ? String(l) + (f ? ' ' + f : '') : `${l} ${txt.split(/\s+/).filter(Boolean).length} ${txt.length}${f ? ' ' + f : ''}`); }
  case 'touch': case 'mkdir': {
    const [o, ps] = opts(a); if (!ps.length) return ko(`${c}: opérande manquant`); const errs = [];
    for (const p of ps) {
      if (c === 'mkdir' && o.p) { const ep = expandHome(st, p); let base = ep.startsWith('/') ? '/' : ''; let bad = null; for (const part of ep.split('/').filter(Boolean)) { base = base ? (base.endsWith('/') ? base : base + '/') + part : part; const r = walk(st, base); if (r.err) { bad = r.err; break; } if (r.ino == null) { const dn = st.fs[r.dir]; if (!can(st, dn, 2)) { bad = E.acces; break; } mkdirIn(st, r.dir, r.name, 0o775 & ~(u.uid === 0 ? 0o020 : 0), u.uid, u.gid); } else if (st.fs[r.ino].t !== 'd') { bad = E.exist; break; } } if (bad) errs.push(`mkdir: impossible de créer le dossier « ${p} »: ${bad}`); else st.seen['mkdir:' + absPath(st, p)] = true; continue; }
      const r = walk(st, p);
      if (r.err) { errs.push(c === 'touch' ? `touch: impossible de faire un touch '${p}': ${r.err}` : `mkdir: impossible de créer le dossier « ${p} »: ${r.err}`); continue; }
      if (r.ino != null) { if (c === 'mkdir') errs.push(`mkdir: impossible de créer le dossier « ${p} »: ${E.exist}`); else st.fs[r.ino].mt = Date.now(); continue; }
      const dn = st.fs[r.dir]; if (!can(st, dn, 2)) { errs.push(c === 'touch' ? `touch: impossible de faire un touch '${p}': ${E.acces}` : `mkdir: impossible de créer le dossier « ${p} »: ${E.acces}`); continue; }
      if (c === 'mkdir') mkdirIn(st, r.dir, r.name, 0o775 & ~(u.uid === 0 ? 0o020 : 0), u.uid, u.gid); else mkfileIn(st, r.dir, r.name, 0o664 & ~(u.uid === 0 ? 0o020 : 0), u.uid, u.gid, '');
      st.seen[c + ':' + absPath(st, p)] = true;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'rmdir': {
    const errs = []; for (const p of a) { const r = walk(st, p, false); if (r.err || r.ino == null) { errs.push(`rmdir: impossible de supprimer '${p}': ${r.err || E.noent}`); continue; } const n = st.fs[r.ino]; if (n.t !== 'd') { errs.push(`rmdir: impossible de supprimer '${p}': ${E.notdir}`); continue; } if (Object.keys(n.k).length) { errs.push(`rmdir: impossible de supprimer '${p}': ${E.notempty}`); continue; } if (!can(st, st.fs[r.dir], 2)) { errs.push(`rmdir: impossible de supprimer '${p}': ${E.acces}`); continue; } unlink(st, r.dir, r.name); }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'rm': {
    const [o, ps] = opts(a); if (!ps.length) return ko('rm: opérande manquant'); const errs = [];
    for (const p of ps) {
      const r = walk(st, p, false); if (r.err || r.ino == null) { if (!o.f) errs.push(`rm: impossible de supprimer '${p}': ${r.err || E.noent}`); continue; }
      const n = st.fs[r.ino]; if (n.t === 'd' && !o.r && !o.R) { errs.push(`rm: impossible de supprimer '${p}': ${E.isdir}`); continue; }
      if (!can(st, st.fs[r.dir], 2)) { errs.push(`rm: impossible de supprimer '${p}': ${E.acces}`); continue; }
      if (r.ino === 1) { errs.push("rm: il est dangereux d'opérer récursivement sur '/'"); continue; }
      const ap = absPath(st, p); const kill = ino => { const x = st.fs[ino]; if (x && x.t === 'd') { for (const k of Object.keys(x.k)) { const ch = x.k[k]; delete x.k[k]; kill(ch); } delete st.fs[ino]; } else if (x && links(st, ino) === 0) delete st.fs[ino]; };
      unlink(st, r.dir, r.name); if (n.t === 'd') kill(r.ino); st.seen['rm:' + ap] = true;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'cp': case 'mv': {
    const [o, ps] = opts(a); if (ps.length < 2) return ko(`${c}: opérande de fichier cible manquant après '${ps[0] || ''}'`);
    const dst = ps.pop(); const dr = walk(st, dst); const errs = [];
    const intoDir = dr.ino != null && st.fs[dr.ino].t === 'd';
    if (ps.length > 1 && !intoDir) return ko(`${c}: la cible '${dst}' n'est pas un dossier`);
    for (const p of ps) {
      const r = walk(st, p, c === 'cp'); if (r.err || r.ino == null) { errs.push(`${c}: impossible d'évaluer '${p}': ${r.err || E.noent}`); continue; }
      const n = st.fs[r.ino];
      let tdir, tname; if (intoDir) { tdir = dr.ino; tname = r.name; } else if (dr.err) { errs.push(`${c}: impossible de créer '${dst}': ${dr.err}`); continue; } else { tdir = dr.dir; tname = dr.name; }
      if (!can(st, st.fs[tdir], 2)) { errs.push(`${c}: impossible de créer '${dst}': ${E.acces}`); continue; }
      const ex = st.fs[tdir].k[tname]; if (ex != null && st.fs[ex].t === 'd' && n.t !== 'd') { errs.push(`${c}: impossible d'écraser le dossier '${dst}'`); continue; }
      if (c === 'mv') { if (!can(st, st.fs[r.dir], 2)) { errs.push(`mv: impossible de déplacer '${p}': ${E.acces}`); continue; } if (n.t === 'd') { let x = tdir; while (x !== 1) { if (x === r.ino) break; x = st.fs[x].p; } if (x === r.ino) { errs.push(`mv: impossible de déplacer '${p}' vers un sous-dossier de lui-même`); continue; } } delete st.fs[r.dir].k[r.name]; if (ex != null) unlink(st, tdir, tname); st.fs[tdir].k[tname] = r.ino; if (n.t === 'd') n.p = tdir; }
      else {
        if (!can(st, n, 4)) { errs.push(`cp: impossible d'ouvrir '${p}' en lecture: ${E.acces}`); continue; }
        if (n.t === 'd' && !o.r && !o.R) { errs.push(`cp: -r non spécifié ; omission du dossier '${p}'`); continue; }
        const copy = (ino, dir, name) => { const x = st.fs[ino]; if (x.t === 'd') { const ni = mkdirIn(st, dir, name, x.m, u.uid, u.gid); for (const [k, v] of Object.entries(x.k)) copy(v, ni, k); } else if (dir === tdir && name === tname && ex != null && st.fs[ex].t === 'f') { st.fs[ex].d = x.d; st.fs[ex].mt = Date.now(); } else mkfileIn(st, dir, name, x.m, u.uid, u.gid, x.d); };
        copy(r.ino, tdir, tname);
      }
      st.seen[c + ':' + absPath(st, p) + '>' + absOf(st, tdir).replace(/\/$/, '') + '/' + tname] = true;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'ln': {
    const [o, ps] = opts(a); if (ps.length !== 2) return ko('ln: opérande manquant (ln [-s] cible nom_du_lien)');
    const [tgt, name] = ps; const nr = walk(st, name, false); if (nr.err) return ko(`ln: ${name}: ${nr.err}`);
    if (nr.ino != null) return ko(`ln: impossible de créer le lien '${name}': ${E.exist}`);
    if (!can(st, st.fs[nr.dir], 2)) return ko(`ln: impossible de créer le lien '${name}': ${E.acces}`);
    if (o.s) { const ino = mk(st, 'l', 0o777, u.uid, u.gid, { l: tgt }); st.fs[nr.dir].k[nr.name] = ino; st.seen['ln-s'] = true; return ok(''); }
    const tr = walk(st, tgt); if (tr.err || tr.ino == null) return ko(`ln: impossible d'accéder à '${tgt}': ${tr.err || E.noent}`);
    if (st.fs[tr.ino].t === 'd') return ko(`ln: '${tgt}': les liens physiques ne sont pas permis pour les dossiers`);
    st.fs[nr.dir].k[nr.name] = tr.ino; st.seen['ln'] = true; return ok('');
  }
  case 'file': return ok(a.map(p => { const r = walk(st, p, false); if (r.err || r.ino == null) return `${p}: impossible d'ouvrir (${r.err || E.noent})`; const n = st.fs[r.ino]; return `${p}: ` + (n.t === 'd' ? 'directory' : n.t === 'l' ? `symbolic link to ${n.l}` : n.d === '(programme)' ? 'ELF 64-bit LSB executable' : n.d ? 'ASCII text' : 'empty'); }).join('\n'));
  case 'find': {
    const p = a[0] && !a[0].startsWith('-') ? a[0] : '.'; const ni = a.indexOf('-name'); const pat = ni >= 0 ? a[ni + 1] : null; const ti = a.indexOf('-type'); const typ = ti >= 0 ? a[ti + 1] : null;
    const r = walk(st, p); if (r.err || r.ino == null) return ko(`find: '${p}': ${r.err || E.noent}`);
    const re = pat ? new RegExp('^' + pat.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;
    const out = [], errs = []; const rec = (ino, path, name) => { const n = st.fs[ino]; if ((!re || re.test(name)) && (!typ || (typ === 'd') === (n.t === 'd') && (typ !== 'l' || n.t === 'l'))) out.push(path); if (n.t === 'd') { if (!can(st, n, 4) || !can(st, n, 1)) { errs.push(`find: '${path}': ${E.acces}`); return; } for (const k of Object.keys(n.k).sort()) rec(n.k[k], path.replace(/\/$/, '') + '/' + k, k); } };
    rec(r.ino, p, p.split('/').filter(Boolean).pop() || p); st.seen['find'] = true;
    return { out: out.join('\n') + (out.length ? '\n' : ''), err: errs.join('\n') || undefined };
  }
  case 'chmod': {
    if (a.length < 2) return ko('chmod: opérande manquant'); const spec = a[0], errs = [];
    for (const p of a.slice(1)) {
      const r = walk(st, p); if (r.err || r.ino == null) { errs.push(`chmod: impossible d'accéder à '${p}': ${r.err || E.noent}`); continue; }
      const n = st.fs[r.ino]; if (u.uid !== 0 && n.u !== u.uid) { errs.push(`chmod: modification des droits de '${p}': ${E.perm}`); continue; }
      if (/^[0-7]{3,4}$/.test(spec)) n.m = parseInt(spec, 8);
      else { let m = n.m; for (const part of spec.split(',')) { const mm = /^([ugoa]*)([+=-])([rwxt]*)$/.exec(part); if (!mm) return ko(`chmod: mode incorrect : « ${spec} »`); const who = mm[1] || 'a'; let bits = 0; for (const w of who.replace('a', 'ugo')) { const sh = { u: 6, g: 3, o: 0 }[w]; for (const x of mm[3]) if (x !== 't') bits |= ({ r: 4, w: 2, x: 1 }[x]) << sh; if (mm[2] === '=') m &= ~(7 << sh); } if (mm[3].includes('t')) bits |= 0o1000; if (mm[2] === '-') m &= ~bits; else m |= bits; } n.m = m; }
      st.seen['chmod:' + absPath(st, p)] = spec;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'chown': case 'chgrp': {
    const [o, ps] = opts(a); if (ps.length < 2) return ko(`${c}: opérande manquant`);
    let [us, gs] = c === 'chgrp' ? [null, ps[0]] : ps[0].split(/[:.]/); const nu = us ? U(st, us) : null, ng = gs ? G(st, gs) : null;
    if (us && !nu) return ko(`chown: utilisateur incorrect : « ${ps[0]} »`); if (gs && !ng) return ko(`${c}: groupe incorrect : « ${gs} »`);
    const errs = [];
    for (const p of ps.slice(1)) {
      const r = walk(st, p); if (r.err || r.ino == null) { errs.push(`${c}: impossible d'accéder à '${p}': ${r.err || E.noent}`); continue; }
      const n = st.fs[r.ino];
      if (u.uid !== 0 && (nu || n.u !== u.uid || (ng && !gidsOf(st, u).includes(ng.gid)))) { errs.push(`${c}: modification du propriétaire de '${p}': ${E.perm}`); continue; }
      const apply = ino => { const x = st.fs[ino]; if (nu) x.u = nu.uid; if (ng) x.g = ng.gid; if (o.R && x.t === 'd') Object.values(x.k).forEach(apply); }; apply(r.ino);
      st.seen[c + ':' + absPath(st, p)] = true;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'id': case 'groups': {
    const t = a[0] ? U(st, a[0]) : u; if (!t) return ko(`${c}: '${a[0]}' : utilisateur inexistant`);
    st.seen[c + ':' + t.n] = true; const gs = gidsOf(st, t);
    if (c === 'groups') return ok((a[0] ? t.n + ' : ' : '') + gs.map(g => gname(st, g)).join(' '));
    return ok(`uid=${t.uid}(${t.n}) gid=${t.gid}(${gname(st, t.gid)}) groupes=${gs.map(g => `${g}(${gname(st, g)})`).join(',')}`);
  }
  case 'sudo': {
    if (!a.length) return ko('usage: sudo commande');
    if (u.uid !== 0 && !G(st, 'sudo').m.includes(u.n)) { st.seen['sudo-refus:' + u.n] = true; return ko(`${u.n} n'est pas dans le fichier sudoers.`); }
    if (a[0] === '-i' || (a[0] === 'su' && a.length === 1)) { st.stack.push({ user: st.user, cwd: st.cwd }); st.user = 'root'; st.cwd = '/root'; return ok(''); }
    const save = st.user; st.user = 'root'; let r; try { r = cmd(st, a, input, bg); } finally { if (st.user === 'root' && !(a[0] === 'su')) st.user = save; }
    st.seen['sudo:' + a[0]] = true; return r;
  }
  case 'su': {
    const dash = a[0] === '-' || a[0] === '-l'; const name = (dash ? a[1] : a[0]) || 'root'; const t = U(st, name);
    if (!t) return ko(`su : l'utilisateur ${name} n'existe pas`);
    const go = () => { st.stack.push({ user: st.user, cwd: st.cwd }); st.user = t.n; if (dash) st.cwd = t.home; st.seen['su:' + t.n] = true; return ''; };
    if (u.uid === 0) return ok(go());
    if (!t.pw) { st.pend = { prompt: 'Mot de passe : ', secret: true, fn: () => 'su : Échec de l\'authentification' + (t.uid === 0 ? '\n(Sur Ubuntu, le compte root est verrouillé : utilise sudo -i ou sudo commande.)' : '') }; return ok(''); }
    st.pend = { prompt: 'Mot de passe : ', secret: true, fn: pw => pw === t.pw ? go() : 'su : Échec de l\'authentification' }; return ok('');
  }
  case 'exit': case 'logout': {
    if (!st.stack.length) return ko('Ceci est le shell principal du lab : il ne se ferme pas.');
    const s = st.stack.pop(); st.user = s.user; st.cwd = s.cwd; return ok('déconnexion');
  }
  case 'passwd': {
    const t = a[0] ? U(st, a[0]) : u; if (!t) return ko(`passwd : l'utilisateur « ${a[0]} » n'existe pas`);
    if (t !== u && u.uid !== 0) return ko('passwd : Vous ne pouvez pas afficher ou modifier les informations de mot de passe pour ' + t.n + '.');
    st.pend = { prompt: 'Nouveau mot de passe : ', secret: true, fn: p1 => { st.pend = { prompt: 'Retapez le nouveau mot de passe : ', secret: true, fn: p2 => { if (p1 !== p2) return 'Les mots de passe ne correspondent pas.\npasswd : Erreur de manipulation du jeton d\'authentification'; if (!p1) return 'Aucun mot de passe fourni.'; t.pw = p1; syncEtc(st); st.seen['passwd:' + t.n] = true; return 'passwd : le mot de passe a été mis à jour avec succès'; } }; return ''; } };
    return ok('');
  }
  case 'useradd': case 'userdel': case 'usermod': case 'groupadd': case 'groupdel': {
    if (u.uid !== 0) return ko(`${c} : Permission non accordée.\n${c} : impossible de verrouiller /etc/passwd ; veuillez réessayer plus tard.\n(Il faut être root : sudo ${args.join(' ')})`);
    if (c === 'groupadd') { const n = a.find(x => !x.startsWith('-')); if (!n) return ko('Utilisation : groupadd [options] GROUPE'); if (G(st, n)) return ko(`groupadd : le groupe « ${n} » existe déjà`); const gid = Math.max(1000, ...st.groups.map(g => g.gid)) + 1; st.groups.push({ n, gid, m: [] }); syncEtc(st); st.seen['groupadd:' + n] = true; return ok(''); }
    if (c === 'groupdel') { const g = G(st, a[0]); if (!g) return ko(`groupdel : le groupe « ${a[0]} » n'existe pas`); st.groups = st.groups.filter(x => x !== g); syncEtc(st); return ok(''); }
    if (c === 'useradd') {
      let m = false, g = null, gl = [], n = null; for (let i = 0; i < a.length; i++) { if (a[i] === '-m') m = true; else if (a[i] === '-g') g = a[++i]; else if (a[i] === '-G') gl = (a[++i] || '').split(','); else if (a[i] === '-s' || a[i] === '-d' || a[i] === '-c') i++; else n = a[i]; }
      if (!n) return ko('Utilisation : useradd [options] IDENTIFIANT'); if (U(st, n)) return ko(`useradd : l'utilisateur « ${n} » existe déjà`);
      if (g && !G(st, g)) return ko(`useradd : le groupe « ${g} » n'existe pas`); for (const x of gl) if (!G(st, x)) return ko(`useradd : le groupe « ${x} » n'existe pas`);
      const uid = Math.max(1000, ...st.users.map(x => x.uid)) + 1; let gid;
      if (g) gid = G(st, g).gid; else { if (G(st, n)) return ko(`useradd : le groupe ${n} existe. Si vous voulez ajouter cet utilisateur à ce groupe, utilisez -g.`); gid = Math.max(uid, ...st.groups.map(x => x.gid + 1)); st.groups.push({ n, gid, m: [] }); }
      gl.forEach(x => G(st, x).m.push(n)); const home = '/home/' + n; st.users.push({ n, uid, gid, home, pw: null });
      if (m) { const hr = walk(st, '/home'); const h = mkdirIn(st, hr.ino, n, 0o750, uid, gid); mkfileIn(st, h, '.bashrc', 0o644, uid, gid, '# Configuration du shell bash\n'); }
      syncEtc(st); st.seen['useradd:' + n] = m ? 'm' : true; return ok('');
    }
    if (c === 'userdel') { const r = a.includes('-r'); const n = a.find(x => !x.startsWith('-')); const t = U(st, n); if (!t) return ko(`userdel : l'utilisateur « ${n} » n'existe pas`); if (t.uid === 0) return ko('userdel : impossible de supprimer root'); st.users = st.users.filter(x => x !== t); st.groups.forEach(g => g.m = g.m.filter(x => x !== n)); const own = st.groups.find(g => g.gid === t.gid && g.n === n); if (own) st.groups = st.groups.filter(g => g !== own); if (r) { const hr = walk(st, t.home); if (hr.ino != null) { cmd(st, ['rm', '-r', t.home]); } } syncEtc(st); return ok(''); }
    // usermod
    let ag = false, gl = null, n = null; for (let i = 0; i < a.length; i++) { if (a[i] === '-aG' || a[i] === '-Ga') { ag = true; gl = a[++i]; } else if (a[i] === '-a') ag = true; else if (a[i] === '-G') gl = a[++i]; else n = a[i]; }
    const t = U(st, n); if (!t) return ko(`usermod : l'utilisateur « ${n} » n'existe pas`); if (!gl) return ko('Utilisation : usermod -aG GROUPE IDENTIFIANT');
    const names = gl.split(','); for (const x of names) if (!G(st, x)) return ko(`usermod : le groupe « ${x} » n'existe pas`);
    if (!ag) { st.groups.forEach(g => g.m = g.m.filter(x => x !== n)); st.seen['usermod-G-sans-a'] = true; }
    names.forEach(x => { const g = G(st, x); if (!g.m.includes(n)) g.m.push(n); }); syncEtc(st); st.seen['usermod:' + n + ':' + names.join(',')] = true; return ok('');
  }
  case 'ps': {
    const all = a.some(x => /^(-e|-ef|aux|-aux|ax|-A)$/.test(x)); const L = [];
    const mine = st.procs.filter(p => all || (p.u === u.uid && p.c !== 'init'));
    if (all && a.some(x => /aux/.test(x))) { L.push('USER         PID  %CPU %MEM COMMAND'); for (const p of st.procs) L.push(uname(st, p.u).padEnd(10) + String(p.pid).padStart(6) + '   0.0  0.1 ' + p.c); L.push(u.n.padEnd(10) + String(st.nextPid).padStart(6) + '   0.0  0.0 ps aux'); }
    else if (all) { L.push('UID          PID    PPID  CMD'); for (const p of st.procs) L.push(uname(st, p.u).padEnd(10) + String(p.pid).padStart(6) + String(p.pp).padStart(8) + '  ' + p.c); L.push(u.n.padEnd(10) + String(st.nextPid).padStart(6) + String(845).padStart(8) + '  ps ' + a.join(' ')); }
    else { L.push('    PID TTY          TIME CMD'); for (const p of mine) L.push(String(p.pid).padStart(7) + ' pts/0    00:00:00 ' + p.c); L.push(String(st.nextPid).padStart(7) + ' pts/0    00:00:00 ps'); }
    st.seen[all ? 'ps-all' : 'ps'] = true; return ok(L.join('\n'));
  }
  case 'pstree': {
    const L = []; const kids = pid => st.procs.filter(p => p.pp === pid).sort((x, y) => x.pid - y.pid);
    const showPid = a.includes('-p');
    const lab = p => p.c + (showPid ? `(${p.pid})` : '');
    // une ligne par processus, indentée sous son parent
    const out = []; const draw = (p, pre, isLast, root) => { out.push(root ? lab(p) : pre + (isLast ? '└─' : '├─') + lab(p)); const ks = kids(p.pid); ks.forEach((k, i) => draw(k, root ? '' : pre + (isLast ? '  ' : '│ '), i === ks.length - 1, false)); };
    const init = st.procs.find(p => p.pid === 1); draw(init, '', true, true); st.seen['pstree'] = true; return ok(out.join('\n'));
  }
  case 'kill': {
    const ps = a.filter(x => !/^-/.test(x)); if (!ps.length) return ko('kill : utilisation : kill [-s sigspec | -n signum | -sigspec] pid');
    const errs = [];
    for (const x of ps) {
      const pid = +x; const p = st.procs.find(q => q.pid === pid);
      if (!p) { errs.push(`bash: kill: (${x}) - Aucun processus de ce type`); continue; }
      if (u.uid !== 0 && p.u !== u.uid) { errs.push(`bash: kill: (${x}) - ${E.perm}`); st.seen['kill-refus:' + pid] = true; continue; }
      if (pid === 1) { errs.push(u.uid === 0 ? '(init ignore ce signal : le processus 1 ne peut pas être tué)' : `bash: kill: (1) - ${E.perm}`); continue; }
      if (p.c === 'bash' && p.pid === 845) { errs.push('(Tu allais fermer ton propre shell : ce simulateur l\'empêche.)'); continue; }
      st.procs = st.procs.filter(q => q !== p); st.procs.forEach(q => { if (q.pp === pid) { q.pp = 1; st.seen['orphelin:' + q.pid] = true; } }); st.seen['kill:' + p.c + ':' + pid] = true;
    }
    return { out: '', err: errs.join('\n') || undefined };
  }
  case 'sleep': { if (!bg) return ok('(Sans « & », le terminal attendrait la fin. Essaie : sleep 300 &)'); const pid = ++st.nextPid; st.procs.push({ pid, pp: 845, u: u.uid, c: 'sleep ' + (a[0] || '') }); st.nextPid++; return ok(`[1] ${pid}`); }
  case '':
    return ok('');
  default:
    if (/^\.?\.?\//.test(c)) { const r = walk(st, c); if (r.err || r.ino == null) return ko(`bash: ${c}: ${r.err || E.noent}`); const n = st.fs[r.ino]; if (n.t === 'd') return ko(`bash: ${c}: ${E.isdir}`); if (!can(st, n, 1) || !can(st, n, 4)) { st.seen['exec-refus:' + absPath(st, c)] = true; return ko(`bash: ${c}: ${E.acces}`); } st.seen['exec:' + absPath(st, c)] = st.user; return ok(n.d.split('\n').filter(l => /^echo /.test(l)).map(l => l.slice(5).replace(/^["']|["']$/g, '')).join('\n') || '(le script s\'exécute)'); }
    return ko(`${c} : commande introuvable` + (HELP[c.toLowerCase()] ? ' (Linux distingue les majuscules : tape ' + c.toLowerCase() + ')' : ''));
  }
}

function exec(st, line) {
  if (st.pend) { const p = st.pend; st.pend = null; const r = p.fn(line); return { out: r || '' }; }
  const r = run(st, line); if (r && r.clear) return { out: '', clear: true };
  return { out: r };
}
function complete(st, line) {
  const m = /^(.*?)(\S*)$/.exec(line); const before = m[1], word = m[2];
  if (!before.trim()) { const c = Object.keys(HELP).filter(k => k.startsWith(word)); return c.length === 1 ? before + c[0] + ' ' : line; }
  const i = word.lastIndexOf('/'); const base = i < 0 ? '' : word.slice(0, i + 1), part = word.slice(i + 1);
  const r = walk(st, base || '.'); if (r.err || r.ino == null || st.fs[r.ino].t !== 'd' || !can(st, st.fs[r.ino], 4)) return line;
  const c = Object.keys(st.fs[r.ino].k).filter(n => n.startsWith(part) && (part.startsWith('.') || !n.startsWith('.')));
  if (!c.length) return line;
  if (c.length === 1) { const n = st.fs[st.fs[r.ino].k[c[0]]]; return before + base + c[0] + (n.t === 'd' ? '/' : ' '); }
  let pre = c[0]; for (const x of c) while (!x.startsWith(pre)) pre = pre.slice(0, -1); return before + base + pre;
}
function node(st, path, as = 'root') { const save = st.user, sc = st.cwd; st.user = as; const r = walk(st, path, false); st.user = save; st.cwd = sc; return r.ino != null ? st.fs[r.ino] : null; }
return { newSys, exec, prompt, complete, node, U, G, gidsOf, links, walk, syncEtc, HELP };
})();
if (typeof module !== 'undefined') module.exports = LinuxSim;

/* =====================================================================
   Labs Linux (vérifiés automatiquement) — notions du cours « Initiation à Linux »
   ===================================================================== */
const LinuxLabs = (() => {
const L = LinuxSim;
const nd = (st, p) => L.node(st, p);
const H = '/home/dimitri';
const LABS = [
{ id: 'arbo', n: 1, niv: 1, titre: "Se repérer dans l'arborescence", src: 'Cours Initiation à Linux, p. 12 et 17-18',
  intro: "Sous Linux, tout est fichier, et tout part d'une seule racine « / ». Promène-toi dans les dossiers vus en cours.",
  setup: st => st,
  tasks: [
    ['Affiche le dossier où tu te trouves.', 'pwd', st => !!st.seen.pwd],
    ['Liste le contenu de la racine /.', 'ls /', st => !!st.seen['ls:/']],
    ['Va dans le dossier de configuration du système et liste-le.', 'cd /etc\nls', st => !!st.seen['cd:/etc'] && !!st.seen['ls:/etc']],
    ['Affiche la liste des utilisateurs (fichier /etc/passwd).', 'cat /etc/passwd\n(une ligne par utilisateur : nom, UID, GID, dossier personnel, shell)', st => !!st.seen['cat:/etc/passwd']],
    ['Liste le dossier des périphériques.', 'ls /dev\n(tout est fichier : même un disque, comme sda)', st => !!st.seen['ls:/dev']],
    ['Reviens dans ton dossier personnel et affiche aussi les fichiers cachés.', 'cd   (ou cd ~)\nls -a\n(les fichiers qui commencent par un point sont cachés)', st => st.cwd === H && !!st.seen['ls-a']],
    ['Affiche l\'arborescence de /home.', 'tree /home', st => !!st.seen.tree]] },
{ id: 'fich', n: 2, niv: 2, titre: 'Fichiers et dossiers', src: 'Cours Initiation à Linux, p. 17-19',
  intro: "Crée une petite arborescence de révision dans ton dossier personnel, puis manipule des fichiers.",
  setup: st => { L.exec(st, 'echo "a supprimer" > brouillon.txt'); st.hist = []; st.seen = {}; return st; },
  tasks: [
    ['Crée les dossiers ~/tssr/cours (avec ses parents) et ~/tssr/archives.', 'mkdir -p ~/tssr/cours\nmkdir ~/tssr/archives', st => { const c = nd(st, H + '/tssr/cours'), a = nd(st, H + '/tssr/archives') || nd(st, H + '/tssr/anciens'); return !!c && c.t === 'd' && !!a && a.t === 'd'; }],
    ['Écris « Tout est fichier » dans ~/tssr/cours/linux.txt.', 'echo "Tout est fichier" > ~/tssr/cours/linux.txt', st => { const n = nd(st, H + '/tssr/cours/linux.txt'); return !!n && /tout est fichier/i.test(n.d); }],
    ['Ajoute une 2e ligne « Linux est multi-utilisateur » sans effacer la première.', 'echo "Linux est multi-utilisateur" >> ~/tssr/cours/linux.txt\n(>> ajoute, > écrase)', st => { const n = nd(st, H + '/tssr/cours/linux.txt'); return !!n && /tout est fichier/i.test(n.d) && /multi-utilisateur/i.test(n.d); }],
    ['Copie linux.txt dans ~/tssr/archives sous le nom linux_sauvegarde.txt.', 'cp ~/tssr/cours/linux.txt ~/tssr/archives/linux_sauvegarde.txt', st => { const n = nd(st, H + '/tssr/archives/linux_sauvegarde.txt') || nd(st, H + '/tssr/anciens/linux_sauvegarde.txt'); return !!n && /multi-utilisateur/i.test(n.d); }],
    ['Renomme ~/tssr/archives en ~/tssr/anciens.', 'mv ~/tssr/archives ~/tssr/anciens', st => !nd(st, H + '/tssr/archives') && !!nd(st, H + '/tssr/anciens/linux_sauvegarde.txt')],
    ['Supprime le fichier brouillon.txt de ton dossier personnel.', 'rm ~/brouillon.txt', st => !nd(st, H + '/brouillon.txt')],
    ['Affiche le contenu de linux.txt.', 'cat ~/tssr/cours/linux.txt', st => !!st.seen['cat:' + H + '/tssr/cours/linux.txt']]] },
{ id: 'droits', n: 3, niv: 3, titre: 'Les droits UGO', src: 'Cours Initiation à Linux, p. 22-25',
  intro: "Chaque fichier a des droits pour le propriétaire (u), le groupe (g) et les autres (o) : r = 4, w = 2, x = 1. Alice (mot de passe : alice) est une autre utilisatrice de la machine.",
  setup: st => { L.exec(st, 'echo "echo Bonjour TSSR" > script.sh'); L.exec(st, 'echo "mon mot de passe de messagerie" > secret.txt'); L.exec(st, 'chmod 755 ~'); st.hist = []; st.seen = {}; return st; },
  tasks: [
    ['Affiche les droits détaillés de ton dossier personnel.', 'ls -l', st => !!st.seen['ls-l']],
    ['Essaie de lancer ./script.sh : refusé, il n\'est pas exécutable.', './script.sh', st => !!st.seen['exec-refus:' + H + '/script.sh'] || !!st.seen['exec:' + H + '/script.sh']],
    ['Donne au script les droits de l\'exemple du cours : propriétaire 111, groupe 100, autres 101.', 'chmod 745 script.sh\n(111 = 7, 100 = 4, 101 = 5)', st => { const n = nd(st, H + '/script.sh'); return !!n && n.m === 0o745; }],
    ['Lance le script.', './script.sh', st => !!st.seen['exec:' + H + '/script.sh']],
    ['Rends secret.txt lisible et modifiable par toi seul.', 'chmod 600 secret.txt\n(ou chmod go-rwx secret.txt)', st => { const n = nd(st, H + '/secret.txt'); return !!n && n.m === 0o600; }],
    ['Deviens alice et essaie de lire ton secret : refusé.', 'su - alice   (mot de passe : alice)\ncat /home/dimitri/secret.txt', st => st.seen['denied:' + H + '/secret.txt'] === 'alice'],
    ['Toujours en alice, lis script.sh : autorisé, car les « autres » ont r.', 'cat /home/dimitri/script.sh\npuis exit', st => !!st.seen['catok:' + H + '/script.sh:alice']],
    ['Reviens en dimitri.', 'exit', st => st.user === 'dimitri' && !!st.seen['su:alice']]] },
{ id: 'users', n: 4, niv: 3, titre: 'Utilisateurs et groupes', src: 'Cours Initiation à Linux, p. 22-25',
  intro: "Crée un compte et un dossier partagé pour le service comptabilité. Ces commandes demandent les droits root : utilise sudo.",
  setup: st => st,
  tasks: [
    ['Essaie de lire /etc/shadow (les mots de passe chiffrés) : refusé.', 'cat /etc/shadow', st => !!st.seen['denied:/etc/shadow']],
    ['Crée l\'utilisateur bob avec son dossier personnel.', 'sudo useradd -m bob', st => !!L.U(st, 'bob') && !!nd(st, '/home/bob')],
    ['Crée le groupe compta.', 'sudo groupadd compta', st => !!L.G(st, 'compta')],
    ['Ajoute bob au groupe compta, sans lui retirer ses autres groupes.', 'sudo usermod -aG compta bob\n(sans -a, -G remplacerait tous ses groupes secondaires)', st => !!L.G(st, 'compta') && L.G(st, 'compta').m.includes('bob')],
    ['Vérifie l\'identité et les groupes de bob.', 'id bob', st => !!st.seen['id:bob']],
    ['Crée /srv/compta, donne-le à root et au groupe compta.', 'sudo mkdir /srv/compta\nsudo chown root:compta /srv/compta', st => { const n = nd(st, '/srv/compta'); return !!n && n.u === 0 && L.G(st, 'compta') && n.g === L.G(st, 'compta').gid; }],
    ['Droits : tout pour le propriétaire et le groupe, rien pour les autres.', 'sudo chmod 770 /srv/compta', st => { const n = nd(st, '/srv/compta'); return !!n && n.m === 0o770; }],
    ['Vérifie la ligne de compta dans /etc/group.', 'grep compta /etc/group', st => !!st.seen['grep:/etc/group']]] },
{ id: 'liens', n: 5, niv: 4, titre: 'Inodes et liens', src: 'Cours Initiation à Linux, p. 19-20',
  intro: "Un fichier est identifié par un inode. Un lien physique est un autre nom pour le même inode ; un lien symbolique pointe vers un chemin.",
  setup: st => { L.exec(st, 'echo "Notes de cours Linux" > cours.txt'); st.hist = []; st.seen = {}; return st; },
  tasks: [
    ['Crée un lien physique cours_dur vers cours.txt.', 'ln cours.txt cours_dur', st => { const a = L.walk(st, H + '/cours_dur', false); return a.ino != null && st.fs[a.ino].t === 'f' && !!st.seen.ln; }],
    ['Crée un lien symbolique cours_sym vers cours.txt.', 'ln -s cours.txt cours_sym', st => { const a = L.walk(st, H + '/cours_sym', false); return a.ino != null && st.fs[a.ino].t === 'l'; }],
    ['Affiche les numéros d\'inode : cours.txt et cours_dur ont le même.', 'ls -li', st => !!st.seen['ls-li']],
    ['Supprime cours.txt.', 'rm cours.txt', st => !nd(st, H + '/cours.txt') && !!st.seen['rm:' + H + '/cours.txt']],
    ['Lis cours_dur : le contenu existe toujours (l\'inode a encore un nom).', 'cat cours_dur', st => !!st.seen['cat:' + H + '/cours_dur']],
    ['Lis cours_sym : le lien est cassé (son chemin n\'existe plus).', 'cat cours_sym', st => !!st.seen['catfail:' + H + '/cours_sym']]] },
{ id: 'proc', n: 6, niv: 4, titre: 'Processus', src: 'Cours Initiation à Linux, p. 26-27',
  intro: "Chaque programme lancé devient un processus avec un numéro (PID). Les processus forment un arbre dont la racine est init (PID 1).",
  setup: st => { st.procs.push({ pid: 880, pp: 845, u: 1000, c: 'lanceur.sh' }, { pid: 881, pp: 880, u: 1000, c: 'calcul' }, { pid: 901, pp: 845, u: 1000, c: 'tache_bloquee' }); return st; },
  tasks: [
    ['Liste tous les processus de la machine, avec leur parent (PPID).', 'ps -ef', st => !!st.seen['ps-all']],
    ['Affiche l\'arbre des processus avec leurs numéros.', 'pstree -p\n(init est la racine)', st => !!st.seen.pstree],
    ['Essaie d\'arrêter le daemon sshd (PID 312) : refusé, il appartient à root.', 'kill 312', st => !!st.seen['kill-refus:312']],
    ['Arrête le processus tache_bloquee.', 'kill 901', st => !st.procs.some(p => p.pid === 901)],
    ['Arrête lanceur.sh (PID 880) mais pas son enfant calcul.', 'kill 880', st => !st.procs.some(p => p.pid === 880) && st.procs.some(p => p.pid === 881)],
    ['Vérifie : calcul, devenu orphelin, est rattaché à init.', 'pstree -p   (ou ps -ef : son PPID vaut 1)', st => { const p = st.procs.find(x => x.pid === 881); return !!p && p.pp === 1 && !!st.seen['orphelin:881'] && (!!st.seen.pstree); }],
    ['Lance sleep 300 en arrière-plan, puis vérifie qu\'il apparaît.', 'sleep 300 &\nps', st => st.procs.some(p => /^sleep/.test(p.c))]] },
{ id: 'libre', n: 7, niv: 0, titre: 'Bac à sable', src: '',
  intro: "Aucune consigne : entraîne-toi librement. Tape help pour la liste des commandes.", setup: st => st, tasks: [] },
];
return { LABS };
})();
if (typeof module !== 'undefined') module.exports.LABS = LinuxLabs.LABS;

/* =====================================================================
   Interface (section #linux)
   ===================================================================== */
if (typeof document !== 'undefined') (function () {
  const root = document.getElementById('linux'); if (!root) return;
  const S = LinuxSim, LABS = LinuxLabs.LABS;
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'tssr-linux'; let ST = {}; try { ST = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { }
  ST.labs = ST.labs || {};
  const out = q('#lxOut'), inp = q('#lxIn'), ps = q('#lxPs');
  let lab, st, screen = '', hpos = 0, showAll = false, armReset = false;
  const save = () => { try { ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { st: JSON.stringify(st, (k, v) => k === 'pend' ? undefined : v) }); localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { } };
  function fresh(l) { const s = S.newSys(); l.setup(s); s.seen = {}; s.hist = []; return s; }
  function load(id, reset) {
    lab = LABS.find(l => l.id === id) || LABS[0]; ST.cur = lab.id; st = null;
    const sv = !reset && ST.labs[lab.id] && ST.labs[lab.id].st; if (sv) { try { st = JSON.parse(sv); } catch (e) { st = null; } }
    if (!st) st = fresh(lab); st.pend = null;
    screen = `Terminal Linux simulé (Ubuntu) : connecté en tant que dimitri sur ${'tssr-pc'}.\nTape help pour la liste des commandes. Tab complète, ↑ rappelle les commandes.\n\n`;
    hpos = st.hist.length; showAll = false; armReset = false; renderLabs(); renderBrief(); paint(); check(); save();
  }
  function renderLabs() {
    const ok = LABS.filter(l => ST.labs[l.id] && ST.labs[l.id].done).length;
    q('#lxCount').textContent = `${ok}/${LABS.filter(l => l.tasks.length).length} labs réussis`;
    q('#lxLabs').innerHTML = LABS.map(l => { const s = ST.labs[l.id] || {}, cur = l.id === lab.id;
      const etat = !l.tasks.length ? 'Terminal libre, sans tâche' : s.done ? '✓ Réussi' : s.n ? `${s.n}/${l.tasks.length} tâches faites` : 'Pas encore fait';
      return `<button class="sc" data-v="${l.id}"${cur ? ' aria-current="true"' : ''}><span class="tag">Lab ${l.n}${l.niv ? ' · niveau ' + l.niv : ''}${cur ? ' · dernier ouvert' : ''}</span><b>${esc(l.titre)}</b><small>${etat}</small></button>`; }).join('');
    qa('#lxLabs .sc').forEach(b => b.onclick = () => { if (b.dataset.v !== lab.id) load(b.dataset.v); openLab(); });
  }
  function openLab() { q('#lxPick').hidden = true; q('#lxView').hidden = false; window.scrollTo({ top: 0 }); paint(); if (matchMedia('(pointer:fine)').matches) inp.focus(); }
  q('#lxBack').onclick = () => { renderLabs(); q('#lxView').hidden = true; q('#lxPick').hidden = false; window.scrollTo({ top: 0 }); };
  q('#lxPick').addEventListener('labs', renderLabs);

  // Tâche en cours (affichée seule au-dessus du terminal sur téléphone)
  let curF = -2, curN = null, full = false;
  function curReset() { curF = -2; curN = null; full = !lab.tasks.length; q('#lxCurR').textContent = 'Recommencer ce lab'; q('#lxView').classList.toggle('full', full); q('#lxAll').textContent = 'Voir toutes les tâches et le schéma'; }
  function curTask() {
    const box = q('#lxCur'); if (!lab.tasks.length) { box.hidden = true; return; } box.hidden = false;
    const res = qa('#lxTasks li[data-i]').map(li => li.classList.contains('ok')), f = res.indexOf(false), n = res.filter(Boolean).length;
    const gained = curN != null && n > curN; curN = n;
    q('#lxCurE').textContent = `Lab ${lab.n} · ` + (f < 0 ? 'terminé' : `tâche ${f + 1}/${res.length}`) + (gained ? ' · ✓ tâche validée' : '');
    if (f === curF) return; curF = f;
    q('#lxCurT').textContent = f < 0 ? '✓ Lab réussi : toutes les tâches sont validées.' : lab.tasks[f][0];
    q('#lxCurH').hidden = f < 0; q('#lxCurH').textContent = 'Indice'; q('#lxCurP').hidden = true; q('#lxCurP').textContent = f < 0 ? '' : lab.tasks[f][1];
  }
  q('#lxCurH').onclick = () => { const h = q('#lxCurP'); h.hidden = !h.hidden; q('#lxCurH').textContent = h.hidden ? 'Indice' : 'Cacher l\'indice'; };
  q('#lxCurR').onclick = () => { q('#lxReset').click(); q('#lxCurR').textContent = q('#lxReset').textContent; };
  q('#lxAll').onclick = () => { full = !full; q('#lxView').classList.toggle('full', full); q('#lxAll').textContent = full ? 'Masquer le détail' : 'Voir toutes les tâches et le schéma'; };
  // Clavier ouvert sur téléphone : garder la ligne de saisie visible.
  inp.addEventListener('focus', () => { if (innerWidth < 1024) setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); });
  function renderBrief() {
    curReset();
    q('#lxTitle').textContent = `Lab ${lab.n} · ${lab.titre}`;
    q('#lxLvl').innerHTML = `Niveau ${lab.niv}<span class="d" aria-hidden="true">${'●'.repeat(lab.niv)}${'○'.repeat(5 - lab.niv)}</span>`;
    q('#lxIntro').textContent = lab.intro; q('#lxSrc').textContent = lab.src ? 'Notions : ' + lab.src + ' · commandes : notions générales (hors cours)' : '';
    q('#lxTasks').innerHTML = lab.tasks.map(([t, h], i) => `<li data-i="${i}"><span class="mk" aria-hidden="true">○</span><span class="tx">${esc(t)}</span><button class="link hb" data-i="${i}">Indice</button><pre class="hint" hidden>${esc(h)}</pre></li>`).join('') || '<li class="free">Pas de tâche : essaie ce que tu veux (help pour la liste).</li>';
    qa('#lxTasks .hb').forEach(b => b.onclick = () => { const p = b.parentElement.querySelector('.hint'); p.hidden = !p.hidden; b.textContent = p.hidden ? 'Indice' : 'Cacher'; });
    q('#lxSol').hidden = !lab.tasks.length; q('#lxSol').textContent = 'Voir toutes les solutions'; q('#lxReset').textContent = 'Recommencer ce lab';
  }
  function paint() { out.textContent = screen; ps.textContent = S.prompt(st); inp.type = st.pend && st.pend.secret ? 'password' : 'text'; out.scrollTop = out.scrollHeight; }
  function write(s) { screen += s; const L = screen.split('\n'); if (L.length > 600) screen = L.slice(-600).join('\n'); }
  function check() {
    if (!lab.tasks.length) { q('#lxProg').textContent = ''; q('#lxDone').hidden = true; curTask(); return; }
    let n = 0; lab.tasks.forEach(([, , ok], i) => { let r = false; try { r = !!ok(st); } catch (e) { } if (r) n++; const li = q(`#lxTasks li[data-i="${i}"]`); li.classList.toggle('ok', r); li.querySelector('.mk').textContent = r ? '✓' : '○'; });
    ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { n });
    const all = n === lab.tasks.length; q('#lxProg').textContent = `${n}/${lab.tasks.length} tâches` + (all ? ' · Lab réussi ✓' : ''); q('#lxDone').hidden = !all; curTask();
    if (all && !(ST.labs[lab.id] && ST.labs[lab.id].done)) { ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { done: true }); renderLabs(); }
  }
  function run(raw) {
    const secret = st.pend && st.pend.secret; write(S.prompt(st) + (secret ? '' : raw) + '\n');
    const r = S.exec(st, raw); if (r.clear) screen = ''; else if (r.out) write(r.out.replace(/\n?$/, '\n'));
    hpos = st.hist.length; inp.value = ''; paint(); check(); save();
  }
  inp.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); run(inp.value); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (!st.pend) inp.value = S.complete(st, inp.value); return; }
    if ((e.key === 'c' || e.key === 'C') && e.ctrlKey) { e.preventDefault(); write(S.prompt(st) + inp.value + '^C\n'); inp.value = ''; st.pend = null; paint(); return; }
    if ((e.key === 'l' || e.key === 'L') && e.ctrlKey) { e.preventDefault(); screen = ''; paint(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const h = st.hist; hpos = Math.max(0, Math.min(h.length, hpos + (e.key === 'ArrowUp' ? -1 : 1))); inp.value = h[hpos] || ''; }
  });
  out.addEventListener('click', () => { if (!getSelection().toString()) inp.focus(); });
  q('#lxTab').onclick = () => { if (!st.pend) inp.value = S.complete(st, inp.value); inp.focus(); };
  q('#lxUp').onclick = () => { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); inp.focus(); };
  q('#lxCtc').onclick = () => { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true })); inp.focus(); };
  q('#lxClr').onclick = () => { screen = ''; paint(); inp.focus(); };
  q('#lxHelp').onclick = () => { run('help'); inp.focus(); };
  q('#lxSol').onclick = () => { showAll = !showAll; qa('#lxTasks .hint').forEach(p => p.hidden = !showAll); qa('#lxTasks .hb').forEach(b => b.textContent = showAll ? 'Cacher' : 'Indice'); q('#lxSol').textContent = showAll ? 'Cacher les solutions' : 'Voir toutes les solutions'; };
  q('#lxReset').onclick = () => { if (!armReset) { armReset = true; q('#lxReset').textContent = 'Confirmer : tout effacer'; return; } load(lab.id, true); };
  load(ST.cur || LABS[0].id);
})();
