/* =====================================================================
   Simulateur Cisco IOS pédagogique (routeur ISR + switch 2960, simplifié)
   - Moteur pur (sans DOM) : CiscoSim.* — testable avec Node.
   - Interface : se branche sur la section #cisco si elle existe.
   ===================================================================== */
const CiscoSim = (() => {
'use strict';

/* ---------- IP ---------- */
const ip2n = s => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s)); if (!m) return null; const o = m.slice(1).map(Number); if (o.some(x => x > 255)) return null; return (o[0] * 16777216 + (o[1] << 16) + (o[2] << 8) + o[3]) >>> 0; };
const n2ip = n => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.');
const pmask = p => p ? (0xFFFFFFFF << (32 - p)) >>> 0 : 0;
const plen = m => { for (let p = 0; p <= 32; p++) if (pmask(p) === m) return p; return -1; };
const netOf = (ip, m) => (ip & m) >>> 0;
const cfulLen = n => { const a = n >>> 24; return a < 128 ? 8 : a < 192 ? 16 : 24; };
const hex8 = n => '0x' + n.toString(16).toUpperCase().padStart(8, '0');

/* ---------- Interfaces ---------- */
const IFT = [['gigabitethernet', 'GigabitEthernet', 'Gi'], ['fastethernet', 'FastEthernet', 'Fa'], ['serial', 'Serial', 'Se'], ['vlan', 'Vlan', 'Vl'], ['loopback', 'Loopback', 'Lo']];
function parseIf(s) {
  const m = /^([a-z]+)\s*(\d+(?:\/\d+)*)(?:\.(\d+))?$/i.exec(String(s).trim()); if (!m) return null;
  const t = m[1].toLowerCase(); const f = IFT.filter(x => x[0].startsWith(t)); if (f.length !== 1) return null;
  return { base: f[0][1] + m[2], sub: m[3] != null ? +m[3] : null, type: f[0][1] };
}
const shortIf = n => { for (const [, l, s] of IFT) if (n.startsWith(l)) return s + n.slice(l.length); return n; };
function blankIf(router) { return { ip: null, mask: null, shut: router, desc: '', mode: 'access', vlan: 1, native: 1, allowed: null, encap: null, voice: null, helper: null, clock: null, nonego: false, tenc: false, portfast: false }; }
const ifSort = (a, b) => { const k = s => s.replace(/\d+/g, d => d.padStart(4, '0')); return k(a) < k(b) ? -1 : 1; };

/* ---------- Appareils ---------- */
const CFG = ['hostname', 'secret', 'enpw', 'dl', 'pwenc', 'banner', 'con', 'vty', 'ifs', 'routes', 'rip', 'vlans', 'gw'];
function newDev(kind, id) {
  const d = { id, kind, mode: 'user', cur: null, pend: null, seen: {}, startup: null };
  Object.assign(d, defaults(kind));
  return d;
}
function defaults(kind) {
  const d = { hostname: kind === 'router' ? 'Router' : 'Switch', secret: null, enpw: null, dl: true, pwenc: false, banner: null, con: { pw: null, login: false }, vty: { pw: null, login: false }, ifs: {}, routes: [], rip: null, vlans: null, gw: null };
  if (kind === 'router') { for (const n of ['GigabitEthernet0/0', 'GigabitEthernet0/1', 'Serial0/0/0', 'Serial0/0/1']) d.ifs[n] = blankIf(true); }
  else {
    for (let i = 1; i <= 24; i++) d.ifs['FastEthernet0/' + i] = blankIf(false);
    for (const n of ['GigabitEthernet0/1', 'GigabitEthernet0/2']) d.ifs[n] = blankIf(false);
    d.ifs.Vlan1 = blankIf(true);
    d.vlans = { 1: 'default', 1002: 'fddi-default', 1003: 'token-ring-default', 1004: 'fddinet-default', 1005: 'trnet-default' };
  }
  return d;
}
const snap = d => JSON.stringify(CFG.map(k => d[k]));
function loadSnap(d, s) { const dd = s ? JSON.parse(s) : null; const def = defaults(d.kind); CFG.forEach((k, i) => { d[k] = dd ? dd[i] : def[k]; }); }
const saved = d => d.startup != null && d.startup === snap(d);
function newPC(id, ip, mask, gw) { return { id, kind: 'pc', ip: ip2n(ip), mask: ip2n(mask), gw: gw ? ip2n(gw) : null, seen: {} }; }
const isSwPort = (d, n) => d.kind === 'switch' && !n.startsWith('Vlan');
const allowedHas = (al, v) => al == null || al.includes(v);
function parseVlist(s) { const out = []; for (const p of String(s).split(',')) { const m = /^(\d+)(?:-(\d+))?$/.exec(p.trim()); if (!m) return null; const a = +m[1], b = m[2] ? +m[2] : a; if (a < 1 || b > 4094 || b < a) return null; for (let v = a; v <= b; v++) out.push(v); } return out; }
function fmtVlist(l) { if (l == null) return 'all'; const s = [...new Set(l)].sort((a, b) => a - b); const r = []; for (let i = 0; i < s.length; i++) { let j = i; while (j + 1 < s.length && s[j + 1] === s[j] + 1) j++; r.push(j > i ? s[i] + '-' + s[j] : '' + s[i]); i = j; } return r.join(','); }

/* ---------- Réseau : couche 2, état des interfaces, adresses ---------- */
function linkPeer(N, dev, ifn) { for (const [a, ia, b, ib] of N.links) { if (a === dev && ia === ifn) return [b, ib]; if (b === dev && ib === ifn) return [a, ia]; } return null; }
function side(N, dev, ifn) {
  const d = N.devs[dev];
  if (d.kind === 'pc') return { up: true, untag: dev + ':nic', tag: {} };
  const i = d.ifs[ifn]; if (!i || i.shut) return { up: false };
  if (d.kind === 'router') { const tag = {}; for (const [n, s] of Object.entries(d.ifs)) if (s.encap != null && n.startsWith(ifn + '.') && !s.shut) tag[s.encap] = dev + ':' + n; return { up: true, untag: dev + ':' + ifn, tag }; }
  if (i.mode === 'trunk') { const tag = {}; for (const v of Object.keys(d.vlans).map(Number)) { if (v >= 1002 || v === i.native) continue; if (allowedHas(i.allowed, v)) tag[v] = dev + ':v' + v; } return { up: true, untag: d.vlans[i.native] && allowedHas(i.allowed, i.native) ? dev + ':v' + i.native : null, tag }; }
  return { up: true, untag: d.vlans[i.vlan] ? dev + ':v' + i.vlan : null, tag: {} };
}
function physUp(N, dev, ifn) { const d = N.devs[dev]; const i = d.ifs[ifn]; if (!i || i.shut) return false; const p = linkPeer(N, dev, ifn); return !!p && side(N, p[0], p[1]).up; }
function ifStatus(N, dev, ifn) {
  const d = N.devs[dev], i = d.ifs[ifn];
  if (i.shut) return ['administratively down', 'down'];
  if (ifn.startsWith('Loopback')) return ['up', 'up'];
  if (ifn.includes('.')) { const base = ifn.split('.')[0]; const bs = ifStatus(N, dev, base); return bs[0] === 'up' && bs[1] === 'up' ? ['up', 'up'] : (d.ifs[base].shut ? ['administratively down', 'down'] : ['down', 'down']); }
  if (ifn.startsWith('Vlan')) {
    const v = +ifn.slice(4); if (!d.vlans[v]) return ['up', 'down'];
    const any = Object.keys(d.ifs).filter(n => isSwPort(d, n)).some(n => { const p = d.ifs[n]; if (!physUp(N, dev, n)) return false; return p.mode === 'trunk' ? (allowedHas(p.allowed, v)) : p.vlan === v; });
    return any ? ['up', 'up'] : ['up', 'down'];
  }
  return physUp(N, dev, ifn) ? ['up', 'up'] : ['down', 'down'];
}
function build(N) {
  const P = {}; const f = x => { while (P[x] && P[x] !== x) x = P[x]; return x; }; const u = (a, b) => { a = f(a); b = f(b); if (a !== b) P[a] = b; };
  for (const [a, ia, b, ib] of N.links) { const sa = side(N, a, ia), sb = side(N, b, ib); if (!sa.up || !sb.up) continue; if (sa.untag && sb.untag) u(sa.untag, sb.untag); for (const v in sa.tag) if (sb.tag[v]) u(sa.tag[v], sb.tag[v]); }
  const owners = [];
  for (const d of Object.values(N.devs)) {
    if (d.kind === 'pc') { if (d.ip != null) owners.push({ dev: d.id, ifn: 'nic', ip: d.ip, mask: d.mask, key: d.id + ':nic' }); continue; }
    for (const [n, i] of Object.entries(d.ifs)) {
      if (i.ip == null) continue; const st = ifStatus(N, d.id, n); if (st[0] !== 'up' || st[1] !== 'up') continue;
      owners.push({ dev: d.id, ifn: n, ip: i.ip, mask: i.mask, key: n.startsWith('Vlan') ? d.id + ':v' + n.slice(4) : d.id + ':' + n });
    }
  }
  const C = { find: f, owners, N }; C.rip = ripAll(C); C.rt = {};
  for (const d of Object.values(N.devs)) if (d.kind === 'router') C.rt[d.id] = rtable(C, d);
  return C;
}
function rtable(C, d) {
  const R = []; const mine = C.owners.filter(o => o.dev === d.id);
  for (const o of mine) { const l = plen(o.mask); R.push({ code: 'C', net: netOf(o.ip, o.mask), len: l, ifn: o.ifn }); if (l < 32) R.push({ code: 'L', net: o.ip, len: 32, ifn: o.ifn }); }
  const conn = R.filter(r => r.code === 'C');
  for (const s of d.routes) {
    const len = plen(s.mask); if (len < 0) continue;
    if (s.nh != null) { const c = conn.find(r => netOf(s.nh, pmask(r.len)) === r.net); if (!c) continue; R.push({ code: 'S', net: s.net, len, nh: s.nh, ifn: c.ifn, ad: 1 }); }
    else if (s.ifn) { const st = d.ifs[s.ifn] && ifStatus(C.N, d.id, s.ifn); if (!st || st[1] !== 'up') continue; R.push({ code: 'S', net: s.net, len, ifn: s.ifn, ad: 1 }); }
  }
  for (const r of (C.rip[d.id] || [])) if (!R.some(x => (x.code === 'C' || x.code === 'S') && x.net === r.net && x.len === r.len)) R.push(r);
  return R;
}
function lookup(R, dst) { let best = null; for (const r of R) if (netOf(dst, pmask(r.len)) === r.net && (!best || r.len > best.len || (r.len === best.len && (r.ad || 0) < (best.ad || 0)))) best = r; return best; }
function ripAll(C) {
  const N = C.N, res = {}; const routers = Object.values(N.devs).filter(d => d.kind === 'router' && d.rip);
  const en = {}, tbl = {};
  for (const r of routers) {
    en[r.id] = C.owners.filter(o => o.dev === r.id && r.rip.nets.some(n => { const L = cfulLen(n); return netOf(o.ip, pmask(L)) === netOf(n, pmask(L)); }));
    tbl[r.id] = {}; for (const o of en[r.id]) { const l = plen(o.mask); tbl[r.id][netOf(o.ip, o.mask) + '/' + l] = { net: netOf(o.ip, o.mask), len: l, metric: 0 }; }
  }
  const nb = []; for (const r of routers) for (const n of routers) { if (r === n) continue; for (const a of en[r.id]) for (const b of en[n.id]) if (C.find(a.key) === C.find(b.key) && netOf(a.ip, a.mask) === netOf(b.ip, b.mask)) nb.push({ r, n, via: b.ip, ifn: a.ifn }); }
  const compat = (rcv, snd) => !((rcv.rip.v === 2 && snd.rip.v !== 2) || (rcv.rip.v === 1 && snd.rip.v === 2));
  const connAll = id => C.owners.filter(o => o.dev === id).map(o => netOf(o.ip, o.mask) + '/' + plen(o.mask));
  for (let it = 0; it < 16; it++) for (const { r, n, via, ifn } of nb) {
    if (!compat(r, n)) continue; const cn = connAll(r.id);
    for (const [k, e] of Object.entries(tbl[n.id])) { const m = e.metric + 1; if (m > 15 || cn.includes(k)) continue; const cur = tbl[r.id][k]; if (!cur || cur.metric > m) tbl[r.id][k] = { net: e.net, len: e.len, metric: m, nh: via, ifn, learned: true }; }
  }
  for (const r of routers) res[r.id] = Object.values(tbl[r.id]).filter(e => e.learned).map(e => ({ code: 'R', net: e.net, len: e.len, nh: e.nh, ifn: e.ifn, metric: e.metric, ad: 120 }));
  return res;
}
function owns(C, dev, ip) { return C.owners.some(o => o.dev === dev && o.ip === ip); }
function hop(C, dev, dst) {
  const d = C.N.devs[dev];
  if (d.kind === 'pc') { if (d.ip == null) return null; if (netOf(dst, d.mask) === netOf(d.ip, d.mask)) return { key: dev + ':nic', target: dst, src: d.ip }; if (d.gw == null) return null; return { key: dev + ':nic', target: d.gw, src: d.ip }; }
  if (d.kind === 'switch') { const sv = C.owners.filter(o => o.dev === dev); for (const o of sv) if (netOf(dst, o.mask) === netOf(o.ip, o.mask)) return { key: o.key, target: dst, src: o.ip }; if (d.gw != null) for (const o of sv) if (netOf(d.gw, o.mask) === netOf(o.ip, o.mask)) return { key: o.key, target: d.gw, src: o.ip }; return null; }
  const e = lookup(C.rt[dev], dst); if (!e) return null;
  const o = C.owners.find(x => x.dev === dev && x.ifn === e.ifn); if (!o) return null;
  if (e.code === 'C') return { key: o.key, target: dst, src: o.ip };
  if (e.nh != null) return { key: o.key, target: e.nh, src: o.ip };
  return { key: o.key, target: dst, src: o.ip };
}
function deliver(C, from, dst) {
  let dev = from, src = null, hops = 0;
  for (let i = 0; i < 20; i++) {
    if (owns(C, dev, dst)) return { ok: true, dev, src, hops };
    const h = hop(C, dev, dst); if (!h) return { ok: false, why: i === 0 ? 'noroute' : 'drop' };
    if (i === 0) src = h.src; const seg = C.find(h.key);
    const nx = C.owners.find(o => o.ip === h.target && C.find(o.key) === seg); if (!nx) return { ok: false, why: 'arp' };
    if (nx.dev !== dev && C.N.devs[nx.dev].kind === 'router' && nx.ip !== dst) hops++;
    dev = nx.dev;
  }
  return { ok: false, why: 'loop' };
}
function ping(N, from, dstIp) {
  const dst = typeof dstIp === 'number' ? dstIp : ip2n(dstIp); if (dst == null) return { ok: false };
  const C = build(N); const a = deliver(C, from, dst); if (!a.ok) return a;
  if (a.src == null) return { ok: true, hops: 0 };
  const b = deliver(C, a.dev, a.src); return b.ok ? { ok: true, hops: a.hops } : { ok: false, why: 'retour' };
}

/* ---------- Analyse des commandes ---------- */
// Chaque commande : motif (mots-clés + paramètres), fonction, type d'appareil éventuel.
// Paramètres : A.B.C.D, MASK, IF, IFR, WORD, LINE (reste de la ligne), N, VLIST, NH (IP ou interface).
const HELP = {
  'enable': "Turn on privileged commands", 'disable': 'Turn off privileged commands', 'configure': 'Enter configuration mode', 'terminal': 'Configure from the terminal',
  'show': 'Show running system information', 'running-config': 'Current operating configuration', 'startup-config': 'Contents of startup configuration', 'ip': 'IP information',
  'interface': 'Select an interface to configure', 'interfaces': 'Interface status and configuration', 'brief': 'Brief summary of IP status and configuration', 'route': 'IP routing table',
  'vlan': 'VTP VLAN status', 'trunk': 'Trunking characteristics and information', 'version': 'System hardware and software status', 'protocols': 'IP routing protocol process parameters and statistics',
  'copy': 'Copy from one file to another', 'write': 'Write running configuration to memory', 'memory': 'Write to NV memory', 'erase': 'Erase a filesystem', 'reload': 'Halt and perform a cold restart',
  'ping': 'Send echo messages', 'exit': 'Exit from the EXEC', 'logout': 'Exit from the EXEC', 'end': 'Exit from configure mode', 'do': 'To run exec commands in config mode',
  'hostname': 'Set system\'s network name', 'secret': 'Assign the privileged level secret', 'password': 'Assign the terminal connection password', 'no': 'Negate a command or set its defaults',
  'domain-lookup': 'Enable IP Domain Name System hostname translation', 'service': 'Modify use of network based services', 'password-encryption': 'Encrypt system passwords',
  'banner': 'Define a login banner', 'motd': 'Set Message of the Day banner', 'range': 'interface range command', 'default-gateway': 'Specify default gateway (if not routing IP)',
  'router': 'Enable a routing process', 'rip': 'Routing Information Protocol (RIP)', 'line': 'Configure a terminal line', 'console': 'Primary terminal line', 'vty': 'Virtual terminal',
  'address': 'Set the IP address of an interface', 'shutdown': 'Shutdown the selected interface', 'description': 'Interface specific description', 'helper-address': 'Specify a destination address for UDP broadcasts',
  'clock': 'Configure serial interface clock', 'rate': 'Configure serial interface clock speed', 'encapsulation': 'Set encapsulation type for an interface', 'dot1q': 'IEEE 802.1Q Virtual LAN',
  'switchport': 'Set switching mode characteristics', 'mode': 'Set trunking mode of the interface', 'access': 'Set access mode characteristics of the interface', 'native': 'Set trunking native characteristics when interface is in trunking mode',
  'allowed': 'Set allowed VLAN characteristics when interface is in trunking mode', 'add': 'add VLANs to the current list', 'all': 'all VLANs', 'nonegotiate': 'Device will not engage in negotiation protocol on this interface',
  'voice': 'Voice appliance attributes', 'spanning-tree': 'Spanning Tree Subsystem', 'portfast': 'Enable an interface to move directly to forwarding on link up',
  'network': 'Enable routing on an IP network', 'auto-summary': 'Enable automatic network number summarization', 'passive-interface': 'Suppress routing updates on an interface',
  'name': 'Ascii name of the VLAN', 'login': 'Enable password checking', 'logging': 'Modify message logging facilities', 'synchronous': 'Synchronized message output',
  'exec-timeout': 'Set the EXEC timeout', 'history': 'Display the session command history', 'clock rate': '', 'A.B.C.D': 'IP address', 'MASK': 'IP subnet mask', 'WORD': 'Text',
  'LINE': 'Text', 'N': 'Number', 'VLIST': 'VLAN IDs of the allowed VLANs', 'IF': 'Interface name (ex. g0/0)', 'IFR': 'Interface range (ex. f0/1-5)', 'NH': 'Forwarding router\'s address or interface',
};
const CMD = {}; const add = (modes, pat, fn, kind) => { for (const m of modes.split(' ')) (CMD[m] = CMD[m] || []).push({ p: pat.split(' '), fn, kind }); };
const CFGM = 'conf if subif swport svi ifr router vlan line';
const IFM = { if: 1, subif: 1, swport: 1, svi: 1, ifr: 1 };

function tokenize(raw) {
  const t = []; const re = /\S+/g; let m; while ((m = re.exec(raw))) t.push({ s: m[0], i: m.index });
  // « int g 0/0 » → « int g0/0 » ; « interface range f0/1 - 5 » → un seul jeton
  for (let k = 1; k < t.length; k++) {
    const prev = t[k - 1].s.toLowerCase();
    if ('range'.startsWith(prev) && prev.length >= 1 && k >= 2 && 'interface'.startsWith(t[k - 2].s.toLowerCase())) { const rest = t.slice(k); t.splice(k, rest.length, { s: rest.map(x => x.s).join(''), i: t[k].i }); break; }
    if (/^[a-z]+$/i.test(t[k].s) && t[k + 1] && /^\d/.test(t[k + 1].s) && ('interface'.startsWith(prev) && prev.length >= 2 || prev === 'passive-interface') && IFT.some(x => x[0].startsWith(t[k].s.toLowerCase()))) { t[k] = { s: t[k].s + t[k + 1].s, i: t[k].i }; t.splice(k + 1, 1); }
  }
  return t;
}
function okParam(p, s) {
  switch (p) {
    case 'A.B.C.D': case 'MASK': return ip2n(s) != null;
    case 'IF': return parseIf(s) != null;
    case 'IFR': return /^[a-z]+\d+\/\d+(-\d+)?(,[a-z]*\d+\/\d+(-\d+)?)*$/i.test(s);
    case 'WORD': return true;
    case 'N': return /^\d+$/.test(s);
    case 'VLIST': return parseVlist(s) != null;
    case 'NH': return ip2n(s) != null || parseIf(s) != null;
  }
  return false;
}
const isParam = p => /^[A-Z.]+$/.test(p) && p !== 'LINE' || p === 'A.B.C.D';
function match(d, raw) {
  const mode = d.mode; const list = (CMD[mode] || []).filter(c => !c.kind || c.kind === d.kind);
  const toks = tokenize(raw); if (!toks.length) return { empty: true };
  let alive = list.map(c => ({ c, args: [], done: false }));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i].s, tl = t.toLowerCase();
    const live = alive.filter(a => !a.done && a.c.p.length > i);
    const kws = [...new Set(live.map(a => a.c.p[i]).filter(p => !isParam(p) && p !== 'LINE' && p.startsWith(tl)))];
    let chosen = kws.includes(tl) ? [tl] : kws;
    if (chosen.length > 1) return { err: 'ambig', tok: t };
    const next = [];
    for (const a of alive) {
      if (a.done) { next.push(a); continue; }
      const p = a.c.p[i]; if (p === undefined) continue;
      if (p === 'LINE') { next.push({ c: a.c, args: [...a.args, raw.slice(toks[i].i)], done: true }); continue; }
      if (isParam(p)) { if (okParam(p, t)) next.push({ c: a.c, args: [...a.args, t], done: false }); continue; }
      if (chosen.length === 1 && p === chosen[0]) next.push({ c: a.c, args: a.args, done: false });
    }
    // si un mot-clé correspond, il passe avant un paramètre au même endroit
    const kwHit = chosen.length === 1 && next.some(a => a.c.p[i] === chosen[0]);
    alive = kwHit ? next.filter(a => a.c.p[i] === chosen[0] || (a.done && a.c.p.indexOf('LINE') < i)) : next;
    if (!alive.length) return { err: 'invalid', pos: toks[i].i };
  }
  const full = alive.filter(a => a.done || a.c.p.length === toks.length);
  if (!full.length) return { err: 'incomplete' };
  return { c: full[0].c, args: full[0].args };
}
function helpFor(d, raw) {
  const endsSpace = /\s$/.test(raw) || raw === '';
  const toks = tokenize(raw); const list = (CMD[d.mode] || []).filter(c => !c.kind || c.kind === d.kind);
  const known = endsSpace ? toks : toks.slice(0, -1); const partial = endsSpace ? '' : toks[toks.length - 1].s.toLowerCase();
  let alive = list;
  for (let i = 0; i < known.length; i++) { const t = known[i].s.toLowerCase(); const kws = [...new Set(alive.map(c => c.p[i]).filter(p => p && !isParam(p) && p !== 'LINE' && p.startsWith(t)))]; const ch = kws.includes(t) ? [t] : kws; alive = alive.filter(c => { const p = c.p[i]; if (p === undefined) return false; if (p === 'LINE') return true; if (isParam(p)) return okParam(p, known[i].s); return ch.length === 1 && p === ch[0]; }); }
  const i = known.length; const opts = new Map(); let cr = false;
  for (const c of alive) { const p = c.p[i]; if (p === undefined) { cr = true; continue; } if (c.p[i - 1] === 'LINE') { cr = true; continue; } if (p.startsWith(partial) || isParam(p) || p === 'LINE') opts.set(p, HELP[p] || ''); }
  if (!endsSpace) { const ks = [...opts.keys()].filter(k => !isParam(k) && k !== 'LINE'); return ks.length ? ks.sort().join('  ') : '% Unrecognized command'; }
  const rows = [...opts.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([k, h]) => '  ' + k.padEnd(18) + ' ' + h); if (cr) rows.push('  <cr>');
  return rows.length ? rows.join('\n') : '% Unrecognized command';
}
function complete(d, raw) {
  const toks = tokenize(raw); if (!toks.length || /\s$/.test(raw)) return raw;
  const list = (CMD[d.mode] || []).filter(c => !c.kind || c.kind === d.kind); let alive = list;
  for (let i = 0; i < toks.length - 1; i++) { const t = toks[i].s.toLowerCase(); const kws = [...new Set(alive.map(c => c.p[i]).filter(p => p && !isParam(p) && p !== 'LINE' && p.startsWith(t)))]; const ch = kws.includes(t) ? [t] : kws; alive = alive.filter(c => { const p = c.p[i]; if (p === undefined) return false; if (isParam(p) || p === 'LINE') return true; return ch.length === 1 && p === ch[0]; }); }
  const last = toks[toks.length - 1]; const kws = [...new Set(alive.map(c => c.p[toks.length - 1]).filter(p => p && !isParam(p) && p !== 'LINE' && p.startsWith(last.s.toLowerCase())))];
  if (kws.length === 1) return raw.slice(0, last.i) + kws[0] + ' ';
  return raw;
}

/* ---------- Exécution ---------- */
const PROMPT = { user: '>', priv: '#', conf: '(config)#', if: '(config-if)#', swport: '(config-if)#', svi: '(config-if)#', subif: '(config-subif)#', ifr: '(config-if-range)#', router: '(config-router)#', vlan: '(config-vlan)#', line: '(config-line)#' };
function prompt(d) { if (d.kind === 'pc') return 'C:\\>'; if (d.pend && d.pend.prompt != null) return d.pend.prompt; return d.hostname + PROMPT[d.mode]; }
function setMode(d, m) { d.mode = m; d.seen[m] = true; }
function exec(N, devId, raw) {
  const d = N.devs[devId]; if (d.kind === 'pc') return pcExec(N, d, raw);
  if (d.pend) { const p = d.pend; d.pend = null; return p.fn(raw); }
  if (/^\s*\^z\s*$/i.test(raw)) raw = 'end';
  if (/\?\s*$/.test(raw)) return { out: helpFor(d, raw.replace(/\?\s*$/, '')), keep: raw.replace(/\?\s*$/, '') };
  let m = match(d, raw);
  // Comme sur un vrai IOS : une commande de configuration globale tapée dans un sous-mode est acceptée et ramène en (config)
  if (m.err && d.mode !== 'conf' && CFGM.split(' ').includes(d.mode)) { const keep = d.mode; d.mode = 'conf'; const g = match(d, raw); if (!g.err && !g.empty) { d.cur = null; m = g; } else d.mode = keep; }
  if (m.empty) return { out: '' };
  if (m.err === 'ambig') return { out: `% Ambiguous command:  "${raw.trim()}"` };
  if (m.err === 'incomplete') return { out: '% Incomplete command.' };
  if (m.err === 'invalid') { const first = (raw.trim().split(/\s+/)[0] || '').toLowerCase(); const tip = d.mode !== 'priv' && d.mode !== 'user' && first.length >= 2 && ('show'.startsWith(first) || 'ping'.startsWith(first) || 'copy'.startsWith(first) || 'write'.startsWith(first)) ? '\n(Astuce : en mode configuration, ajoute « do » devant : do ' + raw.trim() + ')' : ''; return { out: ' '.repeat(prompt(d).length + m.pos) + '^\n% Invalid input detected at \'^\' marker.' + tip, caret: true }; }
  const r = m.c.fn(N, d, m.args, raw); d.seen['cmd:' + m.c.p.filter(p => !isParam(p) && p !== 'LINE').join(' ')] = true;
  return typeof r === 'string' ? { out: r } : (r || { out: '' });
}
function ifMsgs(N, d, n, wasUp) { const up = ifStatus(N, d.id, n)[1] === 'up'; if (up === wasUp) return ''; const st = up ? 'up' : 'down'; return `%LINK-5-CHANGED: Interface ${n}, changed state to ${up ? 'up' : 'administratively down'}\n` + (up || wasUp ? `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to ${st}` : ''); }
function curIfs(d) { return Array.isArray(d.cur) ? d.cur : [d.cur]; }
function forIfs(N, d, f) { const out = []; for (const n of curIfs(d)) { const r = f(d.ifs[n], n); if (r) out.push(r); } return out.join('\n'); }
function logout(N, d) {
  setMode(d, 'user'); d.cur = null;
  const go = () => {
    const ban = d.banner ? d.banner + '\n' : '';
    if (d.con.login && d.con.pw) { let tries = 0; const ask = () => ({ prompt: 'Password: ', secret: true, fn: pw => { if (pw === d.con.pw) { d.pend = null; return { out: '' }; } if (++tries >= 3) { d.pend = { prompt: '', fn: () => ({ out: '' }) }; return { out: '% Bad passwords' }; } d.pend = ask(); return { out: '' }; } }); d.pend = ask(); return { out: ban + '\nUser Access Verification\n' }; }
    return { out: ban };
  };
  d.pend = { prompt: '', fn: go };
  return { out: `\n${d.hostname} con0 is now available\n\n\n\n\n\nPress RETURN to get started.` };
}
function confirm(d, msg, then) { d.pend = { prompt: msg, fn: a => (/^\s*(y|yes|o|oui)?\s*$/i.test(a) ? then() : { out: '%Aborted' }) }; return { out: '' }; }
function doSave(d) { d.startup = snap(d); d.seen.saved = true; return 'Building configuration...\n[OK]'; }
function encPw(s) { let h = 0x1f; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ('0822' + h.toString(16).toUpperCase().padStart(8, '0') + (s.length * 7).toString(16).toUpperCase()).slice(0, 4 + s.length * 2); }
function secretHash(s) { let h = 7; for (const c of s) h = (h * 33 + c.charCodeAt(0)) >>> 0; return '$1$mERr$' + h.toString(36).padStart(7, 'x') + 'Qb5LzN9Xm0'; }

/* --- Mode utilisateur / privilégié --- */
add('user', 'enable', (N, d) => {
  if (d.secret || d.enpw) { let tries = 0; const ask = () => ({ prompt: 'Password: ', secret: true, fn: pw => { if (pw === (d.secret || d.enpw)) { setMode(d, 'priv'); return { out: '' }; } if (++tries >= 3) return { out: '% Bad secrets\n' }; d.pend = ask(); return { out: '' }; } }); d.pend = ask(); return { out: '' }; }
  setMode(d, 'priv'); return '';
});
add('user priv', 'exit', (N, d) => logout(N, d)); add('user priv', 'logout', (N, d) => logout(N, d));
add('priv', 'disable', (N, d) => { setMode(d, 'user'); return ''; });
add('priv', 'configure terminal', (N, d) => { setMode(d, 'conf'); return 'Enter configuration commands, one per line.  End with CNTL/Z.'; });
const SHOWS = [
  ['show running-config', (N, d) => runCfg(N, d)],
  ['show startup-config', (N, d) => d.startup ? runCfg(N, Object.assign({}, d, Object.fromEntries(CFG.map((k, i) => [k, JSON.parse(d.startup)[i]]))), true) : 'startup-config is not present'],
  ['show ip interface brief', (N, d) => sipib(N, d)],
  ['show ip route', (N, d) => d.kind === 'router' ? sir(N, d) : (d.gw != null ? 'Default gateway is ' + n2ip(d.gw) + '\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty' : 'Default gateway is not set\n\nHost               Gateway           Last Use    Total Uses  Interface\nICMP redirect cache is empty')],
  ['show vlan brief', (N, d) => svb(N, d), 'switch'], ['show vlan', (N, d) => svb(N, d), 'switch'],
  ['show interfaces trunk', (N, d) => sit(N, d), 'switch'],
  ['show ip protocols', (N, d) => sip(N, d), 'router'],
  ['show version', (N, d) => d.kind === 'router' ? `Cisco IOS Software, C1900 Software (C1900-UNIVERSALK9-M), Version 15.1(4)M4, RELEASE SOFTWARE (fc2)\nTechnical Support: http://www.cisco.com/techsupport\n\nROM: System Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)\n\n${d.hostname} uptime is 1 hour, 12 minutes\nSystem image file is "flash0:c1900-universalk9-mz.SPA.151-4.M4.bin"\n\nCisco CISCO1941/K9 (revision 1.0) with 491520K/32768K bytes of memory.\n2 Gigabit Ethernet interfaces\n2 Low-speed serial(sync/async) network interface(s)\n255K bytes of non-volatile configuration memory.\n249856K bytes of ATA System CompactFlash 0 (Read/Write)\n\nConfiguration register is 0x2102` : `Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE4, RELEASE SOFTWARE (fc1)\n\nROM: Bootstrap program is C2960 boot loader\n\n${d.hostname} uptime is 1 hour, 12 minutes\nSystem image file is "flash:c2960-lanbasek9-mz.150-2.SE4.bin"\n\ncisco WS-C2960-24TT-L (PowerPC405) processor with 65536K bytes of memory.\n24 FastEthernet interfaces\n2 Gigabit Ethernet interfaces\n64K bytes of flash-simulated non-volatile configuration memory.\n\nConfiguration register is 0xF`],
  ['show history', (N, d) => (d.hist || []).slice(-10).map(h => '  ' + h).join('\n')],
];
for (const [p, f, k] of SHOWS) { add('priv', p, (N, d) => { d.seen[p] = true; return f(N, d); }, k); }
for (const [p, f, k] of SHOWS.filter(s => /ip interface brief|version|history/.test(s[0]))) add('user', p, (N, d) => { d.seen[p] = true; return f(N, d); }, k);
add('priv', 'copy running-config startup-config', (N, d) => { d.pend = { prompt: 'Destination filename [startup-config]? ', fn: () => ({ out: doSave(d) }) }; return { out: '' }; });
add('priv', 'write memory', (N, d) => doSave(d)); add('priv', 'write', (N, d) => doSave(d));
add('priv', 'erase startup-config', (N, d) => { d.pend = { prompt: 'Erasing the nvram filesystem will remove all configuration files! Continue? [confirm]', fn: a => (/^\s*(y|yes)?\s*$/i.test(a) ? (d.startup = null, { out: '[OK]\nErase of nvram: complete' }) : { out: '%Aborted' }) }; return { out: '' }; });
add('priv', 'reload', (N, d) => {
  const boot = () => { loadSnap(d, d.startup); d.cur = null; setMode(d, 'user'); d.seen.reload = true; return { out: `\nSystem Bootstrap, Version 15.1(4)M4, RELEASE SOFTWARE (fc1)\nInitializing memory for ECC\n\nReadonly ROMMON initialized\nboot of "flash:..." using boot helper "bootflash:"\n${d.startup ? '' : '\n         --- System Configuration Dialog ---\n\nWould you like to enter the initial configuration dialog? [yes/no]: no\n'}\nPress RETURN to get started!\n` }; };
  const proceed = () => { d.pend = { prompt: 'Proceed with reload? [confirm]', fn: a => (/^\s*(y|yes)?\s*$/i.test(a) ? boot() : { out: '' }) }; return { out: '' }; };
  if (!saved(d)) { d.pend = { prompt: 'System configuration has been modified. Save? [yes/no]: ', fn: a => { if (/^\s*y/i.test(a)) { const o = doSave(d); const r = proceed(); r.out = o; return r; } if (/^\s*n/i.test(a)) return proceed(); return { out: '% Please answer \'yes\' or \'no\'.' }; } }; return { out: '' }; }
  return proceed();
});
const pingOut = (dst, ok) => `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${dst}, timeout is 2 seconds:\n${ok ? '!!!!!' : '.....'}\nSuccess rate is ${ok ? '100 percent (5/5), round-trip min/avg/max = 1/1/2 ms' : '0 percent (0/5)'}`;
add('user priv', 'ping A.B.C.D', (N, d, [ip]) => { const r = ping(N, d.id, ip); d.seen['ping ' + ip] = r.ok; d.seen.ping = true; return pingOut(ip, r.ok); });

/* --- Configuration globale --- */
add(CFGM, 'exit', (N, d) => { if (d.mode === 'conf') setMode(d, 'priv'); else { setMode(d, 'conf'); d.cur = null; } return ''; });
add(CFGM, 'end', (N, d) => { setMode(d, 'priv'); d.cur = null; return ''; });
add(CFGM, 'do LINE', (N, d, [line]) => { const m = d.mode, c = d.cur; d.mode = 'priv'; const r = exec(N, d.id, line); const back = () => { d.mode = m; d.cur = c; }; if (d.pend) { const pf = d.pend.fn; d.pend.fn = a => { const rr = pf(a); if (!d.pend) back(); return rr; }; } else back(); return r; });
add('conf', 'hostname WORD', (N, d, [h]) => { if (!/^[a-z][a-z0-9-]{0,62}$/i.test(h)) return '% Hostname contains one or more illegal characters.'; d.hostname = h; return ''; });
add('conf', 'enable secret WORD', (N, d, [s]) => { d.secret = s; return ''; });
add('conf', 'enable password WORD', (N, d, [s]) => { d.enpw = s; return ''; });
add('conf', 'no enable secret', (N, d) => { d.secret = null; return ''; });
add('conf', 'no enable password', (N, d) => { d.enpw = null; return ''; });
add('conf', 'no ip domain-lookup', (N, d) => { d.dl = false; return ''; });
add('conf', 'ip domain-lookup', (N, d) => { d.dl = true; return ''; });
add('conf', 'service password-encryption', (N, d) => { d.pwenc = true; return ''; });
add('conf', 'no service password-encryption', (N, d) => { d.pwenc = false; return ''; });
add('conf', 'banner motd LINE', (N, d, [l]) => { const t = l.trim(); const c = t[0]; const e = t.indexOf(c, 1); d.banner = (e > 0 ? t.slice(1, e) : t.slice(1)).trim(); return ''; });
add('conf', 'no banner motd', (N, d) => { d.banner = null; return ''; });
function enterIf(N, d, name) {
  const p = parseIf(name); if (!p) return '% Invalid interface';
  let n = p.base;
  if (p.type === 'Vlan') { if (d.kind !== 'switch') return '% Invalid input detected at \'^\' marker.'; const v = +p.base.slice(4); if (v < 1 || v > 4094) return '% Invalid input detected at \'^\' marker.'; if (!d.ifs[n]) d.ifs[n] = blankIf(true); d.cur = n; setMode(d, 'svi'); return ''; }
  if (p.type === 'Loopback') { if (d.kind !== 'router') return '% Invalid input detected at \'^\' marker.'; if (!d.ifs[n]) d.ifs[n] = Object.assign(blankIf(false)); d.cur = n; setMode(d, 'if'); return ''; }
  if (!d.ifs[n]) return '% Invalid input detected at \'^\' marker.';
  if (p.sub != null) { if (d.kind !== 'router') return '% Invalid input detected at \'^\' marker.'; n = n + '.' + p.sub; if (!d.ifs[n]) d.ifs[n] = Object.assign(blankIf(false)); d.cur = n; setMode(d, 'subif'); return ''; }
  d.cur = n; setMode(d, d.kind === 'switch' ? 'swport' : 'if'); return '';
}
add('conf if subif swport svi ifr', 'interface IF', (N, d, [n]) => enterIf(N, d, n));
add('conf if subif swport svi ifr', 'interface range IFR', (N, d, [r]) => {
  const out = [];
  for (const part of r.split(',')) { const m = /^([a-z]*)(\d+)\/(\d+)(?:-(\d+))?$/i.exec(part); if (!m) return '% Invalid interface range'; const p = parseIf((m[1] || 'f') + m[2] + '/' + m[3]); if (!p) return '% Invalid interface range'; const a = +m[3], b = m[4] ? +m[4] : a; for (let k = a; k <= b; k++) { const n = p.type + m[2] + '/' + k; if (!d.ifs[n]) return '% Invalid interface range'; out.push(n); } }
  d.cur = out; setMode(d, 'ifr'); return '';
}, 'switch');
add('conf', 'no interface IF', (N, d, [n]) => { const p = parseIf(n); const name = p && (p.sub != null ? p.base + '.' + p.sub : p.base); if (!name || !d.ifs[name] || !(p.sub != null || p.type === 'Vlan' || p.type === 'Loopback')) return '% Invalid input detected at \'^\' marker.'; delete d.ifs[name]; return ''; });
function parseRoute(args) { const [a, m, nh] = args; const net = ip2n(a), mask = ip2n(m); if (plen(mask) < 0) return { err: '%Inconsistent address and mask' }; if (netOf(net, mask) !== net) return { err: '%Inconsistent address and mask' }; const r = { net, mask }; if (nh != null) { if (ip2n(nh) != null) r.nh = ip2n(nh); else { const p = parseIf(nh); r.ifn = p && (p.sub != null ? p.base + '.' + p.sub : p.base); } } return r; }
add('conf', 'ip route A.B.C.D MASK NH', (N, d, args) => { const r = parseRoute(args); if (r.err) return r.err; if (r.ifn && !d.ifs[r.ifn]) return '% Invalid input detected at \'^\' marker.'; d.routes = d.routes.filter(x => !(x.net === r.net && x.mask === r.mask && x.nh === r.nh && x.ifn === r.ifn)); d.routes.push(r); return ''; }, 'router');
add('conf', 'no ip route A.B.C.D MASK NH', (N, d, args) => { const r = parseRoute(args); const before = d.routes.length; d.routes = d.routes.filter(x => !(x.net === r.net && x.mask === r.mask && (x.nh === r.nh && x.ifn === r.ifn))); return before === d.routes.length ? '%No matching route to delete' : ''; }, 'router');
add('conf', 'no ip route A.B.C.D MASK', (N, d, args) => { const r = parseRoute(args); const before = d.routes.length; d.routes = d.routes.filter(x => !(x.net === r.net && x.mask === r.mask)); return before === d.routes.length ? '%No matching route to delete' : ''; }, 'router');
add('conf', 'ip default-gateway A.B.C.D', (N, d, [g]) => { d.gw = ip2n(g); return ''; }, 'switch');
add('conf', 'no ip default-gateway', (N, d) => { d.gw = null; return ''; }, 'switch');
add('conf vlan', 'vlan N', (N, d, [v]) => { v = +v; if (v < 1 || v > 4094) return '% Invalid input detected at \'^\' marker.'; if (v >= 1002 && v <= 1005) return `Default VLAN ${v} may not have its name changed.`; if (!d.vlans[v]) d.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); d.cur = v; setMode(d, 'vlan'); return ''; }, 'switch');
add('conf', 'no vlan N', (N, d, [v]) => { v = +v; if (v === 1 || (v >= 1002 && v <= 1005)) return `%Default VLAN ${v} may not be deleted.`; delete d.vlans[v]; return ''; }, 'switch');
add('vlan', 'name WORD', (N, d, [n]) => { d.vlans[d.cur] = n.slice(0, 32); return ''; }, 'switch');
add('conf', 'router rip', (N, d) => { if (!d.rip) d.rip = { v: null, nets: [], noauto: false, passive: [] }; setMode(d, 'router'); return ''; }, 'router');
add('conf', 'no router rip', (N, d) => { d.rip = null; return ''; }, 'router');
add('router', 'version N', (N, d, [v]) => { if (v !== '1' && v !== '2') return '% Invalid input detected at \'^\' marker.'; d.rip.v = +v; return ''; });
add('router', 'no version', (N, d) => { d.rip.v = null; return ''; });
add('router', 'network A.B.C.D', (N, d, [a]) => { const n = ip2n(a); const c = netOf(n, pmask(cfulLen(n))); if (!d.rip.nets.includes(c)) d.rip.nets.push(c); return ''; });
add('router', 'no network A.B.C.D', (N, d, [a]) => { const n = ip2n(a); const c = netOf(n, pmask(cfulLen(n))); d.rip.nets = d.rip.nets.filter(x => x !== c); return ''; });
add('router', 'no auto-summary', (N, d) => { d.rip.noauto = true; return ''; });
add('router', 'auto-summary', (N, d) => { d.rip.noauto = false; return ''; });
add('router', 'passive-interface IF', (N, d, [n]) => { const p = parseIf(n); if (p && !d.rip.passive.includes(p.base)) d.rip.passive.push(p.base); return ''; });
add('conf', 'line console N', (N, d, [n]) => { if (n !== '0') return '% Invalid input detected at \'^\' marker.'; d.cur = 'con'; setMode(d, 'line'); return ''; });
add('conf', 'line vty N N', (N, d, [a, b]) => { if (+a > +b || +b > 15) return '% Invalid input detected at \'^\' marker.'; d.cur = 'vty'; setMode(d, 'line'); return ''; });
add('line', 'password WORD', (N, d, [p]) => { d[d.cur].pw = p; return ''; });
add('line', 'no password', (N, d) => { d[d.cur].pw = null; return ''; });
add('line', 'login', (N, d) => { const l = d[d.cur]; l.login = true; return l.pw ? '' : '% Login disabled on line, until \'password\' is set'; });
add('line', 'no login', (N, d) => { d[d.cur].login = false; return ''; });
add('line', 'logging synchronous', () => '');
add('line', 'exec-timeout N N', () => '');

/* --- Interfaces --- */
function setIp(N, d, n, a, m) {
  const i = d.ifs[n]; const ip = ip2n(a), mask = ip2n(m); const l = plen(mask);
  if (l < 0) return `% Bad mask ${hex8(mask)} for address ${a}`;
  if (l < 31 && (netOf(ip, mask) === ip || (ip | (~mask >>> 0)) >>> 0 === ip)) return `% Bad mask /${l} for address ${a}`;
  if (n.includes('.') && i.encap == null) return '% Configuring IP routing on a LAN subinterface is only allowed if that\nsubinterface is already configured as part of an IEEE 802.10, IEEE 802.1Q,\nor ISL vLAN.';
  for (const [o, oi] of Object.entries(d.ifs)) { if (o === n || oi.ip == null) continue; const ml = Math.min(l, plen(oi.mask)); if (netOf(ip, pmask(ml)) === netOf(oi.ip, pmask(ml))) return `% ${n2ip(netOf(ip, mask))} overlaps with ${o}`; }
  i.ip = ip; i.mask = mask; return '';
}
add('if subif svi', 'ip address A.B.C.D MASK', (N, d, [a, m]) => setIp(N, d, d.cur, a, m));
add('if subif svi', 'no ip address', (N, d) => { const i = d.ifs[d.cur]; i.ip = i.mask = null; return ''; });
add('if subif svi swport ifr', 'shutdown', (N, d) => forIfs(N, d, (i, n) => { const was = ifStatus(N, d.id, n)[1] === 'up'; i.shut = true; return `%LINK-5-CHANGED: Interface ${n}, changed state to administratively down` + (was ? `\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to down` : ''); }));
add('if subif svi swport ifr', 'no shutdown', (N, d) => forIfs(N, d, (i, n) => { if (!i.shut) return ''; i.shut = false; const st = ifStatus(N, d.id, n); return `%LINK-5-CHANGED: Interface ${n}, changed state to ${st[0] === 'up' ? 'up' : 'down'}` + (st[1] === 'up' ? `\n%LINEPROTO-5-UPDOWN: Line protocol on Interface ${n}, changed state to up` : ''); }));
add('if subif svi swport ifr', 'description LINE', (N, d, [t]) => { forIfs(N, d, i => { i.desc = t.trim(); }); return ''; });
add('if subif svi swport ifr', 'no description', (N, d) => { forIfs(N, d, i => { i.desc = ''; }); return ''; });
add('if subif svi', 'ip helper-address A.B.C.D', (N, d, [a]) => { d.ifs[d.cur].helper = ip2n(a); return ''; });
add('if subif svi', 'no ip helper-address', (N, d) => { d.ifs[d.cur].helper = null; return ''; });
add('if', 'clock rate N', (N, d, [r]) => { if (!d.cur.startsWith('Serial')) return '% Invalid input detected at \'^\' marker.'; d.ifs[d.cur].clock = +r; return ''; });
add('subif', 'encapsulation dot1q N', (N, d, [v]) => { v = +v; if (v < 1 || v > 4094) return '% Invalid input detected at \'^\' marker.'; d.ifs[d.cur].encap = v; return ''; });
add('swport ifr', 'switchport mode access', (N, d) => { forIfs(N, d, i => { i.mode = 'access'; }); return ''; });
add('swport ifr', 'switchport mode trunk', (N, d) => { forIfs(N, d, i => { i.mode = 'trunk'; }); return ''; });
add('swport ifr', 'switchport access vlan N', (N, d, [v]) => { v = +v; if (v < 1 || v > 4094) return '% Invalid input detected at \'^\' marker.'; let msg = ''; if (!d.vlans[v]) { d.vlans[v] = 'VLAN' + String(v).padStart(4, '0'); msg = '% Access VLAN does not exist. Creating vlan ' + v; } forIfs(N, d, i => { i.vlan = v; }); return msg; });
add('swport ifr', 'no switchport access vlan', (N, d) => { forIfs(N, d, i => { i.vlan = 1; }); return ''; });
add('swport ifr', 'switchport trunk native vlan N', (N, d, [v]) => { forIfs(N, d, i => { i.native = +v; }); return ''; });
add('swport ifr', 'switchport trunk allowed vlan VLIST', (N, d, [l]) => { const v = parseVlist(l); forIfs(N, d, i => { i.allowed = v; }); return ''; });
add('swport ifr', 'switchport trunk allowed vlan add VLIST', (N, d, [l]) => { const v = parseVlist(l); forIfs(N, d, i => { if (i.allowed) i.allowed = [...new Set([...i.allowed, ...v])]; }); return ''; });
add('swport ifr', 'switchport trunk allowed vlan all', (N, d) => { forIfs(N, d, i => { i.allowed = null; }); return ''; });
add('swport ifr', 'switchport trunk encapsulation dot1q', (N, d) => { forIfs(N, d, i => { i.tenc = true; }); return ''; });
add('swport ifr', 'switchport nonegotiate', (N, d) => { forIfs(N, d, i => { i.nonego = true; }); return ''; });
add('swport ifr', 'switchport voice vlan N', (N, d, [v]) => { forIfs(N, d, i => { i.voice = +v; }); return ''; });
add('swport ifr', 'spanning-tree portfast', (N, d) => { forIfs(N, d, i => { i.portfast = true; }); return '%Warning: portfast should only be enabled on ports connected to a single\n host. Connecting hubs, concentrators, switches, bridges, etc... to this\n interface  when portfast is enabled, can cause temporary bridging loops.\n Use with CAUTION'; });

/* ---------- Affichages ---------- */
function runCfg(N, d, startup) {
  const L = []; const p = s => L.push(s);
  p(startup ? 'Using 1 bytes' : 'Building configuration...'); p(''); p(startup ? '' : 'Current configuration : 1 bytes'); p('!'); p('version ' + (d.kind === 'router' ? '15.1' : '15.0'));
  p(d.pwenc ? 'service password-encryption' : 'no service password-encryption'); p('!'); p('hostname ' + d.hostname); p('!');
  if (d.secret) p('enable secret 5 ' + secretHash(d.secret));
  if (d.enpw) p('enable password ' + (d.pwenc ? '7 ' + encPw(d.enpw) : d.enpw));
  p('!'); if (!d.dl) { p('no ip domain-lookup'); p('!'); }
  if (d.kind === 'switch') { const vs = Object.keys(d.vlans).map(Number).filter(v => v > 1 && v < 1002); for (const v of vs) { p('vlan ' + v); p(' name ' + d.vlans[v]); p('!'); } }
  for (const n of Object.keys(d.ifs).sort(ifSort)) {
    const i = d.ifs[n]; p('interface ' + n); if (i.desc) p(' description ' + i.desc);
    if (isSwPort(d, n)) {
      if (i.mode === 'access' && i.vlan !== 1) p(' switchport access vlan ' + i.vlan);
      if (i.mode === 'trunk') { if (i.tenc) p(' switchport trunk encapsulation dot1q'); if (i.native !== 1) p(' switchport trunk native vlan ' + i.native); if (i.allowed) p(' switchport trunk allowed vlan ' + fmtVlist(i.allowed)); }
      if (i.mode === 'trunk') p(' switchport mode trunk'); else if (i.vlan !== 1 || i.voice) p(' switchport mode access');
      if (i.voice) p(' switchport voice vlan ' + i.voice); if (i.nonego) p(' switchport nonegotiate'); if (i.portfast) p(' spanning-tree portfast');
    } else {
      if (i.encap != null) p(' encapsulation dot1Q ' + i.encap);
      p(i.ip != null ? ' ip address ' + n2ip(i.ip) + ' ' + n2ip(i.mask) : ' no ip address');
      if (i.helper != null) p(' ip helper-address ' + n2ip(i.helper));
      if (!n.includes('.') && !n.startsWith('Vlan') && !n.startsWith('Loopback') && d.kind === 'router') p(' duplex auto\n speed auto');
      if (i.clock) p(' clock rate ' + i.clock);
    }
    if (i.shut) p(' shutdown'); p('!');
  }
  if (d.rip) { p('router rip'); if (d.rip.v) p(' version ' + d.rip.v); for (const pi of d.rip.passive) p(' passive-interface ' + pi); for (const n of d.rip.nets) p(' network ' + n2ip(n)); if (d.rip.noauto) p(' no auto-summary'); p('!'); }
  if (d.gw != null) { p('ip default-gateway ' + n2ip(d.gw)); p('!'); }
  if (d.kind === 'router') { p('ip classless'); for (const r of d.routes) p('ip route ' + n2ip(r.net) + ' ' + n2ip(r.mask) + ' ' + (r.nh != null ? n2ip(r.nh) : r.ifn)); p('!'); }
  if (d.banner) { p('banner motd ^C' + d.banner + '^C'); p('!'); }
  const line = (name, l) => { p(name); if (l.pw) p(' password ' + (d.pwenc ? '7 ' + encPw(l.pw) : l.pw)); if (l.login) p(' login'); };
  line('line con 0', d.con); p('!'); line('line vty 0 4', d.vty); p('!'); p('end');
  return L.join('\n').replace('Current configuration : 1 bytes', 'Current configuration : ' + (L.join('\n').length) + ' bytes');
}
function sipib(N, d) {
  const L = ['Interface              IP-Address      OK? Method Status                Protocol'];
  for (const n of Object.keys(d.ifs).sort(ifSort)) { const i = d.ifs[n]; const st = ifStatus(N, d.id, n); L.push(n.padEnd(23) + (i.ip != null ? n2ip(i.ip) : 'unassigned').padEnd(16) + 'YES ' + (i.ip != null ? 'manual' : 'unset ').padEnd(7) + st[0].padEnd(22) + st[1]); }
  return L.join('\n');
}
function sir(N, d) {
  const C = build(N); const R = C.rt[d.id].slice().sort((a, b) => a.net - b.net || a.len - b.len);
  const def = R.find(r => r.len === 0);
  const L = ['Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP', '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area', '       * - candidate default, U - per-user static route', '', 'Gateway of last resort is ' + (def ? (def.nh != null ? n2ip(def.nh) : 'reached via ' + def.ifn) + ' to network 0.0.0.0' : 'not set'), ''];
  for (const r of R) {
    const code = (r.code + (r.len === 0 ? '*' : '')).padEnd(5); const dst = n2ip(r.net) + '/' + r.len;
    if (r.code === 'C' || r.code === 'L') L.push(code + '   ' + dst + ' is directly connected, ' + r.ifn);
    else if (r.code === 'S') L.push(code + dst + (r.nh != null ? ' [1/0] via ' + n2ip(r.nh) : ' is directly connected, ' + r.ifn));
    else L.push(code + dst + ' [120/' + r.metric + '] via ' + n2ip(r.nh) + ', 00:00:' + String(10 + r.metric * 7).padStart(2, '0') + ', ' + r.ifn);
  }
  return L.join('\n');
}
function svb(N, d) {
  const L = ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------'];
  for (const v of Object.keys(d.vlans).map(Number).sort((a, b) => a - b)) {
    const ports = Object.keys(d.ifs).filter(n => isSwPort(d, n) && d.ifs[n].mode === 'access' && d.ifs[n].vlan === v).sort(ifSort).map(shortIf);
    const lines = []; for (let k = 0; k < ports.length; k += 4) lines.push(ports.slice(k, k + 4).join(', '));
    L.push(String(v).padEnd(5) + d.vlans[v].padEnd(33) + (v >= 1002 ? 'act/unsup' : 'active   ') + ' ' + (lines[0] || ''));
    for (const l of lines.slice(1)) L.push(' '.repeat(48) + l);
  }
  return L.join('\n');
}
function sit(N, d) {
  const T = Object.keys(d.ifs).filter(n => isSwPort(d, n) && d.ifs[n].mode === 'trunk' && physUp(N, d.id, n)).sort(ifSort);
  if (!T.length) return '';
  const L = ['Port        Mode         Encapsulation  Status        Native vlan'];
  for (const n of T) L.push(shortIf(n).padEnd(12) + 'on'.padEnd(13) + '802.1q'.padEnd(15) + 'trunking'.padEnd(14) + d.ifs[n].native);
  L.push('', 'Port        Vlans allowed on trunk'); for (const n of T) L.push(shortIf(n).padEnd(12) + (d.ifs[n].allowed ? fmtVlist(d.ifs[n].allowed) : '1-4094'));
  L.push('', 'Port        Vlans allowed and active in management domain'); for (const n of T) L.push(shortIf(n).padEnd(12) + fmtVlist(Object.keys(d.vlans).map(Number).filter(v => v < 1002 && allowedHas(d.ifs[n].allowed, v))));
  return L.join('\n');
}
function sip(N, d) {
  if (!d.rip) return '';
  const nets = d.rip.nets.map(n => '    ' + n2ip(n)).join('\n');
  return `Routing Protocol is "rip"\nSending updates every 30 seconds, next due in 12 seconds\nInvalid after 180 seconds, hold down 180, flushed after 240\nDefault version control: send version ${d.rip.v || 1}, receive ${d.rip.v ? 'version ' + d.rip.v : 'any version'}\nAutomatic network summarization is ${d.rip.noauto ? 'not ' : ''}in effect\nMaximum path: 4\nRouting for Networks:\n${nets}\nPassive Interface(s):\n${d.rip.passive.map(p => '    ' + p).join('\n')}\nRouting Information Sources:\n  Gateway         Distance      Last Update\nDistance: (default is 120)`;
}

/* ---------- PC (invite Windows) ---------- */
function pcExec(N, d, raw) {
  const t = raw.trim(); const tl = t.toLowerCase(); d.seen[tl] = true;
  if (!t) return { out: '' };
  if (/^ipconfig(\s+\/all)?$/.test(tl)) return { out: `\nConfiguration IP de Windows\n\nCarte Ethernet Ethernet :\n\n   Adresse IPv4. . . . . . . . . . . . . .: ${d.ip != null ? n2ip(d.ip) : '0.0.0.0'}\n   Masque de sous-réseau. . . . . . . . . : ${d.mask != null ? n2ip(d.mask) : '0.0.0.0'}\n   Passerelle par défaut. . . . . . . . . : ${d.gw != null ? n2ip(d.gw) : ''}\n` };
  const m = /^ping\s+(\S+)$/.exec(tl);
  if (m) {
    if (ip2n(m[1]) == null) return { out: `La requête Ping n'a pas pu trouver l'hôte ${m[1]}. Vérifiez le nom et essayez à nouveau.` };
    const r = ping(N, d.id, m[1]); d.seen['ping ' + m[1]] = r.ok;
    const ttl = 255 - (r.hops || 0);
    const lines = r.ok ? Array(4).fill(`Réponse de ${m[1]} : octets=32 temps<1ms TTL=${ttl}`) : Array(4).fill('Délai d\'attente de la demande dépassé.');
    return { out: `\nEnvoi d'une requête 'Ping'  ${m[1]} avec 32 octets de données :\n${lines.join('\n')}\n\nStatistiques Ping pour ${m[1]}:\n    Paquets : envoyés = 4, reçus = ${r.ok ? 4 : 0}, perdus = ${r.ok ? 0 : 4} (perte ${r.ok ? 0 : 100}%),` };
  }
  if (tl === 'help' || tl === '?') return { out: 'Commandes disponibles sur ce PC : ipconfig, ping <adresse IP>' };
  return { out: `'${t.split(/\s+/)[0]}' n'est pas reconnu en tant que commande interne\nou externe, un programme exécutable ou un fichier de commandes.` };
}

/* ---------- Réseaux de départ ---------- */
function mkNet(devs, links) { const N = { devs: {}, links: [] }; for (const d of devs) N.devs[d.id] = d; N.links = links.map(([a, ia, b, ib]) => [a, canon(N, a, ia), b, canon(N, b, ib)]); return N; }
function canon(N, dev, i) { if (N.devs[dev].kind === 'pc') return 'nic'; const p = parseIf(i); return p.base; }
function preset(N, dev, lines, save = true) { const d = N.devs[dev]; d.mode = 'priv'; for (const l of lines) { exec(N, dev, l); d.pend = null; } d.mode = 'user'; d.cur = null; d.seen = {}; if (save) d.startup = snap(d); }
const R = id => newDev('router', id), SW = id => newDev('switch', id);

return { ip2n, n2ip, parseIf, newDev, newPC, mkNet, preset, exec, prompt, helpFor, complete, ping, build, snap, saved, ifStatus, R, SW, CMD, match };
})();
if (typeof module !== 'undefined') module.exports = CiscoSim;

/* =====================================================================
   Labs : tâches vérifiées automatiquement sur l'état du réseau simulé
   ===================================================================== */
const CiscoLabs = (() => {
const S = CiscoSim; const ip = S.ip2n;
const dv = (N, id) => N.devs[id];
const I = (N, id, n) => dv(N, id).ifs[n] || {};
const hasIp = (N, id, n, a, m) => I(N, id, n).ip === ip(a) && I(N, id, n).mask === ip(m);
const up = (N, id, n) => !!dv(N, id).ifs[n] && S.ifStatus(N, id, n)[1] === 'up';
const route = (N, id, net, mask, nh) => dv(N, id).routes.some(r => r.net === ip(net) && r.mask === ip(mask) && (nh == null || r.nh === ip(nh)));
const pingOk = (N, from, to) => S.ping(N, from, to).ok;
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const ripOn = (N, id, ...nets) => { const r = dv(N, id).rip; return !!r && r.v === 2 && nets.every(n => r.nets.includes(ip(n))); };
const vlanName = (N, id, v, name) => norm(dv(N, id).vlans && dv(N, id).vlans[v]) === norm(name);
const access = (N, id, n, v) => I(N, id, n).mode === 'access' && I(N, id, n).vlan === v;
const trunk = (N, id, n) => I(N, id, n).mode === 'trunk';
const allSaved = (N, ids) => ids.every(id => S.saved(dv(N, id)));

const LABS = [
{
 id: 'base', n: 1, niv: 1, titre: 'Premiers pas sur un routeur',
 intro: "Tu es connecté au port console d'un routeur neuf. Sécurise-le et donne-lui un nom.",
 topo: '   [PC console] ---- câble console ---- [ R1 ]',
 devs: ['R1'], make: () => S.mkNet([S.R('R1')], []),
 tasks: [
  ['Passe en mode privilégié.', 'enable', N => !!dv(N, 'R1').seen.priv],
  ['Entre en mode de configuration globale.', 'configure terminal  (abrégé : conf t)', N => !!dv(N, 'R1').seen.conf],
  ['Nomme le routeur R1.', 'hostname R1', N => dv(N, 'R1').hostname === 'R1'],
  ['Protège le mode privilégié par le mot de passe chiffré « cisco ».', 'enable secret cisco', N => dv(N, 'R1').secret === 'cisco'],
  ['Empêche le routeur de chercher un DNS quand tu fais une faute de frappe.', 'no ip domain-lookup', N => !dv(N, 'R1').dl],
  ['Ajoute la bannière « Acces reserve au personnel autorise ».', 'banner motd #Acces reserve au personnel autorise#', N => norm(dv(N, 'R1').banner).includes('acces reserve')],
  ['Protège la console par le mot de passe « class », avec demande du mot de passe.', 'line console 0\npassword class\nlogin', N => dv(N, 'R1').con.pw === 'class' && dv(N, 'R1').con.login],
  ['Chiffre les mots de passe en clair de la configuration.', 'service password-encryption', N => dv(N, 'R1').pwenc],
  ['Vérifie ta configuration.', 'end\nshow running-config  (abrégé : sh run)', N => !!dv(N, 'R1').seen['show running-config']],
  ['Sauvegarde la configuration.', 'copy running-config startup-config  (puis Entrée)\nou : write memory', N => S.saved(dv(N, 'R1'))],
 ],
},
{
 id: 'if', n: 2, niv: 1, titre: 'Interfaces et adressage',
 intro: "R1 relie le LAN de PC1 au routeur R2 (déjà configuré). Configure les interfaces de R1 puis vérifie avec ping.",
 topo: '   PC1 192.168.1.1/24 ---- G0/0 [ R1 ] G0/1 ---- G0/1 [ R2 ]\n   passerelle .254          .254       10.0.0.1/8     10.0.0.2/8',
 devs: ['R1', 'R2', 'PC1'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1']]); S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/1', 'ip address 10.0.0.2 255.0.0.0', 'no shut', 'end']); S.preset(N, 'R1', ['conf t', 'hostname R1', 'end']); return N; },
 tasks: [
  ['Sur R1, donne l\'adresse 192.168.1.254/24 à G0/0.', 'interface g0/0\nip address 192.168.1.254 255.255.255.0', N => hasIp(N, 'R1', 'GigabitEthernet0/0', '192.168.1.254', '255.255.255.0')],
  ['Ajoute la description « LAN » sur G0/0.', 'description LAN', N => norm(I(N, 'R1', 'GigabitEthernet0/0').desc) === 'lan'],
  ['Active G0/0 (les interfaces de routeur sont éteintes par défaut).', 'no shutdown', N => up(N, 'R1', 'GigabitEthernet0/0')],
  ['Donne l\'adresse 10.0.0.1/8 à G0/1 et active-la.', 'interface g0/1\nip address 10.0.0.1 255.0.0.0\nno shutdown', N => hasIp(N, 'R1', 'GigabitEthernet0/1', '10.0.0.1', '255.0.0.0') && up(N, 'R1', 'GigabitEthernet0/1')],
  ['Vérifie l\'état des interfaces.', 'do show ip interface brief  (en mode config)\nou : end puis sh ip int br', N => !!dv(N, 'R1').seen['show ip interface brief']],
  ['Depuis R1, pingue PC1.', 'ping 192.168.1.1  (en mode privilégié)', N => !!dv(N, 'R1').seen['ping 192.168.1.1']],
  ['Depuis R1, pingue R2.', 'ping 10.0.0.2', N => !!dv(N, 'R1').seen['ping 10.0.0.2']],
  ['Sauvegarde la configuration de R1.', 'copy run start', N => S.saved(dv(N, 'R1'))],
 ],
},
{
 id: 'vlan', n: 3, niv: 2, titre: 'Switch et VLAN',
 intro: "Sépare la Compta et les RH dans deux VLAN, puis prépare un VLAN d'administration pour le switch.",
 topo: '   PC1 (Compta) 192.168.10.1 ---- Fa0/1 ┐\n   PC2 (Compta) 192.168.10.2 ---- Fa0/2 ├ [ SW1 ]\n   PC3 (RH)     192.168.20.1 ---- Fa0/3 ┘',
 devs: ['SW1', 'PC1', 'PC2', 'PC3'],
 make: () => S.mkNet([S.SW('SW1'), S.newPC('PC1', '192.168.10.1', '255.255.255.0', '192.168.10.254'), S.newPC('PC2', '192.168.10.2', '255.255.255.0', '192.168.10.254'), S.newPC('PC3', '192.168.20.1', '255.255.255.0', '192.168.20.254')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['PC3', '', 'SW1', 'f0/3']]),
 tasks: [
  ['Nomme le switch SW1.', 'enable\nconf t\nhostname SW1', N => dv(N, 'SW1').hostname === 'SW1'],
  ['Crée le VLAN 10 nommé COMPTA.', 'vlan 10\nname COMPTA', N => vlanName(N, 'SW1', 10, 'COMPTA')],
  ['Crée le VLAN 20 nommé RH.', 'vlan 20\nname RH', N => vlanName(N, 'SW1', 20, 'RH')],
  ['Mets Fa0/1 et Fa0/2 en mode accès dans le VLAN 10.', 'interface range f0/1-2\nswitchport mode access\nswitchport access vlan 10', N => access(N, 'SW1', 'FastEthernet0/1', 10) && access(N, 'SW1', 'FastEthernet0/2', 10)],
  ['Mets Fa0/3 en mode accès dans le VLAN 20.', 'interface f0/3\nswitchport mode access\nswitchport access vlan 20', N => access(N, 'SW1', 'FastEthernet0/3', 20)],
  ['Vérifie les VLAN.', 'do show vlan brief', N => !!dv(N, 'SW1').seen['show vlan brief']],
  ['Depuis PC1, pingue PC2 (même VLAN : ça doit marcher).', 'Clique sur PC1, puis : ping 192.168.10.2', N => !!dv(N, 'PC1').seen['ping 192.168.10.2']],
  ['Crée le VLAN 99 ADMIN et donne au switch l\'adresse 192.168.99.2/24 dessus.', 'vlan 99\nname ADMIN\ninterface vlan 99\nip address 192.168.99.2 255.255.255.0\nno shutdown', N => vlanName(N, 'SW1', 99, 'ADMIN') && hasIp(N, 'SW1', 'Vlan99', '192.168.99.2', '255.255.255.0') && !I(N, 'SW1', 'Vlan99').shut],
  ['Indique la passerelle du switch : 192.168.99.254.', 'ip default-gateway 192.168.99.254', N => dv(N, 'SW1').gw === ip('192.168.99.254')],
  ['Sauvegarde.', 'end\ncopy run start', N => S.saved(dv(N, 'SW1'))],
 ],
},
{
 id: 'trunk', n: 4, niv: 3, titre: 'Trunk entre deux switchs',
 intro: "Les VLAN 10 et 20 existent sur deux switchs. Relie-les par un trunk pour que PC1 et PC3 (VLAN 10) se joignent.",
 topo: '   PC1 V10 192.168.10.1 ─ Fa0/1 [ SW1 ] G0/1 ═══ trunk ═══ G0/1 [ SW2 ] Fa0/1 ─ PC3 V10 192.168.10.3\n   PC2 V20 192.168.20.1 ─ Fa0/2                                   Fa0/2 ─ PC4 V20 192.168.20.3',
 devs: ['SW1', 'SW2', 'PC1', 'PC3'],
 make: () => { const N = S.mkNet([S.SW('SW1'), S.SW('SW2'), S.newPC('PC1', '192.168.10.1', '255.255.255.0'), S.newPC('PC2', '192.168.20.1', '255.255.255.0'), S.newPC('PC3', '192.168.10.3', '255.255.255.0'), S.newPC('PC4', '192.168.20.3', '255.255.255.0')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['PC3', '', 'SW2', 'f0/1'], ['PC4', '', 'SW2', 'f0/2'], ['SW1', 'g0/1', 'SW2', 'g0/1']]); for (const s of ['SW1', 'SW2']) S.preset(N, s, ['conf t', 'hostname ' + s, 'vlan 10', 'name COMPTA', 'vlan 20', 'name RH', 'int f0/1', 'switchport mode access', 'switchport access vlan 10', 'int f0/2', 'switchport mode access', 'switchport access vlan 20', 'end']); return N; },
 tasks: [
  ['Depuis PC1, pingue PC3 : ça ne marche pas encore. Pourquoi ?', 'Clique sur PC1 : ping 192.168.10.3\n(le lien G0/1 est en accès, dans le VLAN 1)', N => dv(N, 'PC1').seen['ping 192.168.10.3'] !== undefined],
  ['Crée le VLAN 99 NATIF sur les deux switchs.', 'vlan 99\nname NATIF  (sur SW1 et sur SW2)', N => vlanName(N, 'SW1', 99, 'NATIF') && vlanName(N, 'SW2', 99, 'NATIF')],
  ['Passe G0/1 en trunk sur SW1 et sur SW2.', 'interface g0/1\nswitchport mode trunk', N => trunk(N, 'SW1', 'GigabitEthernet0/1') && trunk(N, 'SW2', 'GigabitEthernet0/1')],
  ['Mets le VLAN natif 99 sur les deux trunks.', 'switchport trunk native vlan 99', N => I(N, 'SW1', 'GigabitEthernet0/1').native === 99 && I(N, 'SW2', 'GigabitEthernet0/1').native === 99],
  ['N\'autorise que les VLAN 10, 20 et 99 sur les trunks.', 'switchport trunk allowed vlan 10,20,99', N => ['SW1', 'SW2'].every(s => { const a = I(N, s, 'GigabitEthernet0/1').allowed; return a && [10, 20, 99].every(v => a.includes(v)) && a.length === 3; })],
  ['Vérifie le trunk.', 'do show interfaces trunk', N => !!(dv(N, 'SW1').seen['show interfaces trunk'] || dv(N, 'SW2').seen['show interfaces trunk'])],
  ['Depuis PC1, pingue PC3 : cette fois, ça marche.', 'Clique sur PC1 : ping 192.168.10.3', N => dv(N, 'PC1').seen['ping 192.168.10.3'] === true],
  ['Sauvegarde les deux switchs.', 'copy run start  (sur SW1 et sur SW2)', N => allSaved(N, ['SW1', 'SW2'])],
 ],
},
{
 id: 'static', n: 5, niv: 3, titre: 'Routage statique',
 intro: "C'est l'exemple de ton cours « Les routeurs » : PC1 doit joindre PC2. Configure les deux routeurs.",
 topo: '   PC1 192.168.1.1 ── G0/0 [ R1 ] G0/1 ──── 10.0.0.0/8 ──── G0/1 [ R2 ] G0/0 ── PC2 192.168.2.1\n                       .254        .1                       .2          .254',
 devs: ['R1', 'R2', 'PC1', 'PC2'],
 make: () => S.mkNet([S.R('R1'), S.R('R2'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.2.1', '255.255.255.0', '192.168.2.254')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC2', '', 'R2', 'g0/0']]),
 tasks: [
  ['Nomme les routeurs R1 et R2.', 'hostname R1  /  hostname R2', N => dv(N, 'R1').hostname === 'R1' && dv(N, 'R2').hostname === 'R2'],
  ['Configure et active les deux interfaces de R1 (G0/0 192.168.1.254/24, G0/1 10.0.0.1/8).', 'int g0/0\nip address 192.168.1.254 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.1 255.0.0.0\nno shut', N => hasIp(N, 'R1', 'GigabitEthernet0/0', '192.168.1.254', '255.255.255.0') && hasIp(N, 'R1', 'GigabitEthernet0/1', '10.0.0.1', '255.0.0.0') && !I(N, 'R1', 'GigabitEthernet0/0').shut && !I(N, 'R1', 'GigabitEthernet0/1').shut],
  ['Configure et active les deux interfaces de R2 (G0/0 192.168.2.254/24, G0/1 10.0.0.2/8).', 'int g0/0\nip address 192.168.2.254 255.255.255.0\nno shut\nint g0/1\nip address 10.0.0.2 255.0.0.0\nno shut', N => hasIp(N, 'R2', 'GigabitEthernet0/0', '192.168.2.254', '255.255.255.0') && hasIp(N, 'R2', 'GigabitEthernet0/1', '10.0.0.2', '255.0.0.0') && up(N, 'R2', 'GigabitEthernet0/1')],
  ['Regarde la table de routage de R1 : il ne connaît pas 192.168.2.0.', 'do show ip route', N => !!dv(N, 'R1').seen['show ip route']],
  ['Sur R1, ajoute la route statique vers 192.168.2.0/24 via R2.', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', N => route(N, 'R1', '192.168.2.0', '255.255.255.0', '10.0.0.2')],
  ['Sur R2, ajoute la route de retour vers 192.168.1.0/24 via R1.', 'ip route 192.168.1.0 255.255.255.0 10.0.0.1', N => route(N, 'R2', '192.168.1.0', '255.255.255.0', '10.0.0.1')],
  ['Depuis PC1, pingue PC2.', 'Clique sur PC1 : ping 192.168.2.1', N => dv(N, 'PC1').seen['ping 192.168.2.1'] === true],
  ['Sauvegarde les deux routeurs.', 'copy run start  (sur R1 et sur R2)', N => allSaved(N, ['R1', 'R2'])],
 ],
},
{
 id: 'rip', n: 6, niv: 4, titre: 'Route par défaut et RIP v2',
 intro: "Trois routeurs en ligne. Les interfaces sont prêtes. Fais apprendre les réseaux par RIP v2, puis ajoute une sortie par défaut sur R3.",
 topo: '   PC1 192.168.1.1 ─ [R1] ─ 10.0.0.0/30 ─ [R2] ─ 10.0.0.4/30 ─ [R3] ─ PC3 192.168.3.1\n                    G0/0 .254  G0/1 .1    .2 G0/1   S0/0/0 .5   .6 S0/0/0  G0/0 .254\n                                           R2 G0/0 : 192.168.2.254/24 (LAN vide)',
 devs: ['R1', 'R2', 'R3', 'PC1', 'PC3'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.R('R3'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC3', '192.168.3.1', '255.255.255.0', '192.168.3.254')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['R2', 's0/0/0', 'R3', 's0/0/0'], ['PC3', '', 'R3', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shut', 'end']);
  S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shut', 'int s0/0/0', 'ip address 10.0.0.5 255.255.255.252', 'clock rate 64000', 'no shut', 'int g0/0', 'ip address 192.168.2.254 255.255.255.0', 'no shut', 'end']);
  S.preset(N, 'R3', ['conf t', 'hostname R3', 'int s0/0/0', 'ip address 10.0.0.6 255.255.255.252', 'no shut', 'int g0/0', 'ip address 192.168.3.254 255.255.255.0', 'no shut', 'end']); return N; },
 tasks: [
  ['Sur R1, active RIP version 2 et annonce 192.168.1.0 et 10.0.0.0.', 'router rip\nversion 2\nnetwork 192.168.1.0\nnetwork 10.0.0.0\nno auto-summary', N => ripOn(N, 'R1', '192.168.1.0', '10.0.0.0')],
  ['Même chose sur R2 (ses trois réseaux).', 'router rip\nversion 2\nnetwork 10.0.0.0\nnetwork 192.168.2.0\nno auto-summary', N => ripOn(N, 'R2', '10.0.0.0', '192.168.2.0')],
  ['Même chose sur R3.', 'router rip\nversion 2\nnetwork 10.0.0.0\nnetwork 192.168.3.0\nno auto-summary', N => ripOn(N, 'R3', '10.0.0.0', '192.168.3.0')],
  ['Sur R1, vérifie que 192.168.3.0 est appris par RIP (lettre R).', 'do show ip route', N => !!dv(N, 'R1').seen['show ip route'] && S.build(N).rt.R1.some(r => r.code === 'R' && r.net === ip('192.168.3.0'))],
  ['Depuis PC1, pingue PC3.', 'Clique sur PC1 : ping 192.168.3.1', N => dv(N, 'PC1').seen['ping 192.168.3.1'] === true],
  ['Sur R3, ajoute une route par défaut vers R2 (10.0.0.5).', 'ip route 0.0.0.0 0.0.0.0 10.0.0.5', N => route(N, 'R3', '0.0.0.0', '0.0.0.0', '10.0.0.5')],
  ['Sauvegarde les trois routeurs.', 'copy run start  (sur R1, R2, R3)', N => allSaved(N, ['R1', 'R2', 'R3'])],
 ],
},
{
 id: 'ros', n: 7, niv: 4, titre: 'Router-on-a-stick (routage inter-VLAN)',
 intro: "PC1 (VLAN 10) et PC2 (VLAN 20) sont sur le même switch. Fais-les communiquer grâce à R1 et un seul câble trunk.",
 topo: '   PC1 V10 192.168.10.1 ─ Fa0/1 ┐\n                               ├ [ SW1 ] G0/1 ═══ trunk ═══ G0/0 [ R1 ]\n   PC2 V20 192.168.20.1 ─ Fa0/2 ┘                       G0/0.10 : 192.168.10.254\n                                                         G0/0.20 : 192.168.20.254',
 devs: ['SW1', 'R1', 'PC1', 'PC2'],
 make: () => { const N = S.mkNet([S.SW('SW1'), S.R('R1'), S.newPC('PC1', '192.168.10.1', '255.255.255.0', '192.168.10.254'), S.newPC('PC2', '192.168.20.1', '255.255.255.0', '192.168.20.254')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SW1', 'g0/1', 'R1', 'g0/0']]); S.preset(N, 'R1', ['conf t', 'hostname R1', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Sur SW1, crée les VLAN 10 et 20 et place Fa0/1 dans le 10, Fa0/2 dans le 20.', 'vlan 10\nvlan 20\nint f0/1\nswitchport mode access\nswitchport access vlan 10\nint f0/2\nswitchport mode access\nswitchport access vlan 20', N => access(N, 'SW1', 'FastEthernet0/1', 10) && access(N, 'SW1', 'FastEthernet0/2', 20)],
  ['Sur SW1, passe G0/1 (vers R1) en trunk.', 'int g0/1\nswitchport mode trunk', N => trunk(N, 'SW1', 'GigabitEthernet0/1')],
  ['Sur R1, active G0/0 (sans adresse IP).', 'int g0/0\nno shutdown', N => !I(N, 'R1', 'GigabitEthernet0/0').shut],
  ['Crée la sous-interface G0/0.10 pour le VLAN 10, avec 192.168.10.254/24.', 'int g0/0.10\nencapsulation dot1q 10\nip address 192.168.10.254 255.255.255.0', N => I(N, 'R1', 'GigabitEthernet0/0.10').encap === 10 && hasIp(N, 'R1', 'GigabitEthernet0/0.10', '192.168.10.254', '255.255.255.0')],
  ['Crée la sous-interface G0/0.20 pour le VLAN 20, avec 192.168.20.254/24.', 'int g0/0.20\nencapsulation dot1q 20\nip address 192.168.20.254 255.255.255.0', N => I(N, 'R1', 'GigabitEthernet0/0.20').encap === 20 && hasIp(N, 'R1', 'GigabitEthernet0/0.20', '192.168.20.254', '255.255.255.0')],
  ['Sur R1, regarde la table de routage : les deux réseaux sont « C ».', 'do show ip route', N => !!dv(N, 'R1').seen['show ip route']],
  ['Depuis PC1, pingue PC2.', 'Clique sur PC1 : ping 192.168.20.1', N => dv(N, 'PC1').seen['ping 192.168.20.1'] === true],
  ['Sauvegarde R1 et SW1.', 'copy run start  (sur les deux)', N => allSaved(N, ['R1', 'SW1'])],
 ],
},
{
 id: 'libre', n: 8, niv: 0, titre: 'Bac à sable',
 intro: "Aucune consigne : entraîne-toi librement. Tout est vierge.",
 topo: '   PC1 192.168.1.1/24 (passerelle .254) ─ Fa0/1 [ SW1 ] G0/1 ─ G0/0 [ R1 ] G0/1 ─ G0/1 [ R2 ] G0/0 ─ PC2 192.168.2.1/24 (passerelle .254)',
 devs: ['R1', 'R2', 'SW1', 'PC1', 'PC2'],
 make: () => S.mkNet([S.R('R1'), S.R('R2'), S.SW('SW1'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.2.1', '255.255.255.0', '192.168.2.254')], [['PC1', '', 'SW1', 'f0/1'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC2', '', 'R2', 'g0/0']]),
 tasks: [],
},
];
return { LABS };
})();
if (typeof module !== 'undefined') module.exports.LABS = CiscoLabs.LABS;

/* =====================================================================
   Interface : terminal, appareils, panneau du lab (section #cisco)
   ===================================================================== */
if (typeof document !== 'undefined') (function () {
  const root = document.getElementById('cisco'); if (!root) return;
  const S = CiscoSim, LABS = CiscoLabs.LABS;
  const q = s => root.querySelector(s), qa = s => [...root.querySelectorAll(s)];
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const KEY = 'tssr-cisco'; let ST = {}; try { ST = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { }
  ST.labs = ST.labs || {};
  const strip = (k, v) => k === 'pend' ? undefined : v;
  const save = () => { try { ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { net: JSON.stringify(N, strip) }); localStorage.setItem(KEY, JSON.stringify(ST)); } catch (e) { } };
  let lab = null, N = null, dev = null, outs = {}, hpos = {}, showAll = false, armReset = false;
  const out = q('#ciOut'), inp = q('#ciIn'), ps = q('#ciPs');
  const kindName = { router: 'Routeur', switch: 'Switch', pc: 'PC' };

  function welcome(d) {
    if (d.kind === 'pc') return `${d.id} : invite de commandes Windows.\nCommandes : ipconfig, ping <adresse IP>.\n`;
    return `${d.id} (${d.kind === 'router' ? 'routeur Cisco 1941' : 'switch Cisco 2960'}) : connexion console.\nAide : « ? » liste les commandes, Tab complète, ↑ ↓ rappellent l'historique.\n\nPress RETURN to get started!\n`;
  }
  function loadLab(id, fresh) {
    lab = LABS.find(l => l.id === id) || LABS[0]; ST.cur = lab.id;
    const s = !fresh && ST.labs[lab.id] && ST.labs[lab.id].net;
    N = null; if (s) { try { N = JSON.parse(s); } catch (e) { N = null; } }
    if (!N) N = lab.make();
    for (const d of Object.values(N.devs)) d.pend = null;
    outs = {}; hpos = {}; showAll = false; armReset = false;
    dev = lab.devs[0]; renderLabs(); renderBrief(); renderDevs(); showDev(dev); check(); save();
  }
  function renderLabs() {
    q('#ciLabs').innerHTML = LABS.map(l => `<button class="chip" data-v="${l.id}" aria-pressed="${l.id === lab.id}">${l.n}. ${esc(l.titre)}${ST.labs[l.id] && ST.labs[l.id].done ? ' ✓' : ''}</button>`).join('');
    qa('#ciLabs .chip').forEach(b => b.onclick = () => loadLab(b.dataset.v));
  }
  function renderBrief() {
    q('#ciTitle').textContent = `Lab ${lab.n} · ${lab.titre}`;
    q('#ciLvl').innerHTML = `Niveau ${lab.niv}<span class="d" aria-hidden="true">${'●'.repeat(lab.niv)}${'○'.repeat(5 - lab.niv)}</span>`;
    q('#ciIntro').textContent = lab.intro; q('#ciTopo').textContent = lab.topo;
    q('#ciTasks').innerHTML = lab.tasks.map(([t, h], i) => `<li data-i="${i}"><span class="mk" aria-hidden="true">○</span><span class="tx">${esc(t)}</span><button class="link hb" data-i="${i}">Indice</button><pre class="hint" hidden>${esc(h)}</pre></li>`).join('') || '<li class="free">Pas de tâche : configure ce que tu veux, puis vérifie avec show et ping.</li>';
    qa('#ciTasks .hb').forEach(b => b.onclick = () => { const p = b.parentElement.querySelector('.hint'); p.hidden = !p.hidden; b.textContent = p.hidden ? 'Indice' : 'Cacher'; });
    q('#ciSol').hidden = !lab.tasks.length; q('#ciSol').textContent = 'Voir toutes les solutions';
    q('#ciReset').textContent = 'Recommencer ce lab';
  }
  function renderDevs() {
    q('#ciDevs').innerHTML = lab.devs.map(id => { const d = N.devs[id]; return `<button class="chip" data-v="${id}" aria-pressed="${id === dev}">${id} <small>${kindName[d.kind]}</small></button>`; }).join('');
    qa('#ciDevs .chip').forEach(b => b.onclick = () => showDev(b.dataset.v));
  }
  function showDev(id) {
    dev = id; qa('#ciDevs .chip').forEach(b => b.setAttribute('aria-pressed', b.dataset.v === id));
    if (!outs[id]) outs[id] = welcome(N.devs[id]);
    paint(); if (matchMedia('(pointer:fine)').matches) inp.focus();
  }
  function paint() {
    const d = N.devs[dev]; const pr = S.prompt(d);
    out.textContent = outs[dev]; ps.textContent = pr;
    inp.type = d.pend && d.pend.secret ? 'password' : 'text';
    out.scrollTop = out.scrollHeight;
  }
  function write(s) { outs[dev] += s; const L = outs[dev].split('\n'); if (L.length > 600) outs[dev] = L.slice(-600).join('\n'); }
  function check() {
    if (!lab.tasks.length) { q('#ciProg').textContent = ''; return; }
    let n = 0;
    lab.tasks.forEach(([, , ok], i) => { let r = false; try { r = !!ok(N); } catch (e) { } if (r) n++; const li = q(`#ciTasks li[data-i="${i}"]`); li.classList.toggle('ok', r); li.querySelector('.mk').textContent = r ? '✓' : '○'; });
    const all = n === lab.tasks.length;
    q('#ciProg').textContent = `${n}/${lab.tasks.length} tâches` + (all ? ' · Lab réussi ✓' : '');
    q('#ciDone').hidden = !all;
    if (all && !(ST.labs[lab.id] && ST.labs[lab.id].done)) { ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { done: true }); renderLabs(); }
  }
  function run(raw) {
    const d = N.devs[dev]; const pr = S.prompt(d); const secret = d.pend && d.pend.secret;
    write(pr + (secret ? '' : raw) + '\n');
    if (raw.trim() && !secret && d.kind !== 'pc') { d.hist = (d.hist || []).concat(raw).slice(-50); }
    if (raw.trim() && !secret && d.kind === 'pc') { d.hist = (d.hist || []).concat(raw).slice(-50); }
    hpos[dev] = (d.hist || []).length;
    const r = S.exec(N, dev, raw);
    if (r.out) write(r.out.replace(/\n?$/, '\n'));
    inp.value = r.keep != null ? r.keep : '';
    paint(); check(); save();
  }
  function help() { const d = N.devs[dev]; if (d.kind === 'pc') { run('help'); return; } const v = inp.value.replace(/\?$/, ''); write(S.prompt(d) + v + '?\n'); const r = S.exec(N, dev, v + '?'); if (r.out) write(r.out + '\n'); inp.value = v; paint(); }
  inp.addEventListener('keydown', e => {
    const d = N.devs[dev];
    if (e.key === 'Enter') { e.preventDefault(); run(inp.value); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (d.kind !== 'pc' && !(d.pend)) inp.value = S.complete(d, inp.value); return; }
    if (e.key === '?' && d.kind !== 'pc' && !d.pend) { e.preventDefault(); help(); return; }
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey) { e.preventDefault(); inp.value = ''; run('^Z'); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const h = d.hist || []; let p = hpos[dev] == null ? h.length : hpos[dev]; p = Math.max(0, Math.min(h.length, p + (e.key === 'ArrowUp' ? -1 : 1))); hpos[dev] = p; inp.value = h[p] || ''; }
  });
  inp.addEventListener('input', () => { const d = N.devs[dev]; if (inp.value.endsWith('?') && d.kind !== 'pc' && !d.pend) help(); });
  out.addEventListener('click', () => { if (!getSelection().toString()) inp.focus(); });
  q('#ciTab').onclick = () => { const d = N.devs[dev]; if (d.kind !== 'pc') inp.value = S.complete(d, inp.value); inp.focus(); };
  q('#ciHelp').onclick = () => { help(); inp.focus(); };
  q('#ciUp').onclick = () => { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); inp.focus(); };
  q('#ciCtz').onclick = () => { run('^Z'); inp.focus(); };
  q('#ciClr').onclick = () => { outs[dev] = ''; paint(); inp.focus(); };
  q('#ciSol').onclick = () => { showAll = !showAll; qa('#ciTasks .hint').forEach(p => p.hidden = !showAll); qa('#ciTasks .hb').forEach(b => b.textContent = showAll ? 'Cacher' : 'Indice'); q('#ciSol').textContent = showAll ? 'Cacher les solutions' : 'Voir toutes les solutions'; };
  q('#ciReset').onclick = () => { if (!armReset) { armReset = true; q('#ciReset').textContent = 'Confirmer : tout effacer'; return; } loadLab(lab.id, true); };
  loadLab(ST.cur || LABS[0].id);
})();
