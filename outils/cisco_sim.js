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
function blankIf(router) { return { ip: null, mask: null, shut: router, desc: '', mode: 'access', vlan: 1, native: 1, allowed: null, encap: null, voice: null, helper: null, clock: null, nonego: false, tenc: false, portfast: false, acin: null, acout: null, nat: null, cost: null, mset: false, ps: null, bpdug: false }; }
const ifSort = (a, b) => { const k = s => s.replace(/\d+/g, d => d.padStart(4, '0')); return k(a) < k(b) ? -1 : 1; };

/* ---------- Appareils ---------- */
const CFG = ['hostname', 'secret', 'enpw', 'dl', 'pwenc', 'banner', 'con', 'vty', 'ifs', 'routes', 'rip', 'vlans', 'gw', 'ospf', 'acls', 'nat', 'users', 'dom', 'rsa', 'ssh', 'dhcp', 'stp'];
function newDev(kind, id) {
  const d = { id, kind, mode: 'user', cur: null, pend: null, seen: {}, startup: null };
  Object.assign(d, defaults(kind));
  return d;
}
function defaults(kind) {
  const d = { hostname: kind === 'router' ? 'Router' : 'Switch', secret: null, enpw: null, dl: true, pwenc: false, banner: null, con: { pw: null, login: false }, vty: { pw: null, login: false, transport: 'all', acl: null }, ifs: {}, routes: [], rip: null, vlans: null, gw: null, ospf: null, acls: {}, nat: { statics: [], dyn: [], pools: {} }, users: {}, dom: null, rsa: null, ssh: { v: null }, dhcp: { excl: [], pools: {} }, stp: { mode: 'pvst', prio: {} } };
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
function loadSnap(d, s) { const dd = s ? JSON.parse(s) : null; const def = defaults(d.kind); CFG.forEach((k, i) => { d[k] = dd && dd[i] !== undefined ? dd[i] : def[k]; }); fixDev(d); d.natx = []; }
// Complète un appareil enregistré avec une version plus ancienne du simulateur.
function fixDev(d) { if (d.kind === 'pc') { if (!d.mac) d.mac = macOf(d.id + ':nic'); return; } const def = defaults(d.kind); for (const k of CFG) if (d[k] === undefined) d[k] = def[k]; if (d.vty.transport === undefined) d.vty.transport = 'all'; if (!d.leases) d.leases = []; const b = blankIf(false); for (const i of Object.values(d.ifs)) for (const k in b) if (i[k] === undefined) i[k] = b[k]; if (!d.natx) d.natx = []; }
function fixup(N) { for (const d of Object.values(N.devs)) fixDev(d); return N; }
const saved = d => d.startup != null && d.startup === snap(d);
function macOf(k) { let h = 0x811c9dc5; for (const c of k) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } const x = h.toString(16).padStart(8, '0'); return '0050.79' + x.slice(0, 2) + '.' + x.slice(2, 6); }
function newPC(id, ip, mask, gw, web) { return { id, kind: 'pc', ip: ip ? ip2n(ip) : null, mask: mask ? ip2n(mask) : null, gw: gw ? ip2n(gw) : null, web: !!web, seen: {}, mac: macOf(id + ':nic'), dhcp: !ip, dns: null, dhcpSrv: null }; }
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
  // Adresses globales de NAT statique et de pool : le routeur répond pour elles sur son interface outside (comme un proxy ARP)
  for (const d of Object.values(N.devs)) {
    if (d.kind !== 'router' || !d.nat) continue; const outs = owners.filter(o => o.dev === d.id && d.ifs[o.ifn].nat === 'outside');
    const glob = [...d.nat.statics.map(x => x.global), ...Object.values(d.nat.pools).flatMap(p => { const r = []; for (let a = p.start; a <= p.end && r.length < 64; a++) r.push(a); return r; })];
    for (const g of glob) { const o = outs.find(x => netOf(g, x.mask) === netOf(x.ip, x.mask)); if (o && !owners.some(x => x.ip === g && x.dev === d.id)) owners.push({ dev: d.id, ifn: o.ifn, ip: g, mask: o.mask, key: o.key, virt: true }); }
  }
  const C = { find: f, owners, N }; C.rip = ripAll(C); C.ospf = ospfAll(C); C.rt = {};
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
  // Routes dynamiques : on garde, pour chaque réseau, la distance administrative la plus faible (S 1 < O 110 < R 120)
  const dyn = [...(C.ospf.routes[d.id] || []), ...(C.rip[d.id] || [])];
  for (const r of dyn) { const ex = R.find(x => x.net === r.net && x.len === r.len); if (ex && (ex.code === 'C' || ex.code === 'L' || (ex.ad || 0) <= r.ad)) continue; if (ex) R.splice(R.indexOf(ex), 1); R.push(r); }
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
function ospfCost(d, n) { const i = d.ifs[n]; if (i && i.cost) return i.cost; return n.startsWith('Serial') ? 64 : 1; }
function ospfRid(C, d) { if (d.ospf.rid != null) return d.ospf.rid; const lo = C.owners.filter(o => o.dev === d.id && !o.virt && o.ifn.startsWith('Loopback')).map(o => o.ip); const all = C.owners.filter(o => o.dev === d.id && !o.virt).map(o => o.ip); const l = lo.length ? lo : all; return l.length ? Math.max(...l) : 0; }
function ospfAll(C) {
  const N = C.N, res = { routes: {}, nb: {} }; const rs = Object.values(N.devs).filter(d => d.kind === 'router' && d.ospf);
  const en = {};
  for (const r of rs) { en[r.id] = []; for (const o of C.owners.filter(x => x.dev === r.id && !x.virt)) { const st = r.ospf.nets.find(n => ((o.ip & ~n.w) >>> 0) === ((n.a & ~n.w) >>> 0)); if (st) en[r.id].push({ o, area: st.area, passive: r.ospf.passive.includes(o.ifn) }); } }
  const adj = {}; for (const r of rs) { adj[r.id] = []; res.nb[r.id] = []; }
  for (const r of rs) for (const n of rs) { if (r === n) continue; for (const a of en[r.id]) for (const b of en[n.id]) { if (a.passive || b.passive || a.area !== b.area) continue; if (C.find(a.o.key) === C.find(b.o.key) && netOf(a.o.ip, a.o.mask) === netOf(b.o.ip, b.o.mask)) { adj[r.id].push({ n: n.id, cost: ospfCost(r, a.o.ifn), via: b.o.ip, ifn: a.o.ifn }); res.nb[r.id].push({ rid: ospfRid(C, n), ip: b.o.ip, ifn: a.o.ifn, area: a.area, dr: ospfRid(C, n) > ospfRid(C, r) }); } } }
  for (const r of rs) {
    const dist = { [r.id]: 0 }, first = {}, todo = new Set(rs.map(x => x.id));
    while (todo.size) { let u = null; for (const x of todo) if (dist[x] != null && (u == null || dist[x] < dist[u])) u = x; if (u == null) break; todo.delete(u); for (const e of adj[u]) { const nd = dist[u] + e.cost; if (dist[e.n] == null || nd < dist[e.n]) { dist[e.n] = nd; first[e.n] = u === r.id ? { nh: e.via, ifn: e.ifn } : first[u]; } } }
    const mine = C.owners.filter(o => o.dev === r.id).map(o => netOf(o.ip, o.mask) + '/' + plen(o.mask)); const best = {};
    for (const x of rs) { if (x === r || dist[x.id] == null) continue; for (const e of en[x.id]) { const l = plen(e.o.mask), k = netOf(e.o.ip, e.o.mask) + '/' + l; if (mine.includes(k)) continue; const m = dist[x.id] + ospfCost(x, e.o.ifn); if (!best[k] || best[k].metric > m) best[k] = { code: 'O', net: netOf(e.o.ip, e.o.mask), len: l, nh: first[x.id].nh, ifn: first[x.id].ifn, metric: m, ad: 110 }; }
      if (x.ospf.dio && x.routes.some(rt => rt.net === 0 && rt.mask === 0) && (!best.def || best.def.dist > dist[x.id])) best.def = { code: 'O*E2', net: 0, len: 0, nh: first[x.id].nh, ifn: first[x.id].ifn, metric: 1, ad: 110, dist: dist[x.id] }; }
    res.routes[r.id] = Object.values(best);
  }
  return res;
}
/* ---------- ACL ---------- */
const PORTS = { www: 80, http: 80, telnet: 23, ftp: 21, ssh: 22, domain: 53, smtp: 25, pop3: 110 };
function parseAddr(t, i) { // any | host A | A W | A (standard)
  const w = (t[i] || '').toLowerCase();
  if (w === 'any') return { a: { any: true }, n: 1 };
  if (w === 'host') { const ip = ip2n(t[i + 1]); return ip == null ? null : { a: { ip, w: 0 }, n: 2 }; }
  const ip = ip2n(t[i]); if (ip == null) return null; const wl = ip2n(t[i + 1]);
  if (wl != null) return { a: { ip: (ip & ~wl) >>> 0, w: wl }, n: 2 }; return { a: { ip, w: 0 }, n: 1 };
}
function parseRule(ext, line) {
  const t = line.trim().split(/\s+/); const act = (t[0] || '').toLowerCase();
  if (act === 'remark') return { remark: line.trim().slice(6).trim() };
  if (act !== 'permit' && act !== 'deny') return { err: '% Invalid input detected at \'^\' marker.' };
  if (!ext) { const s = parseAddr(t, 1); if (!s || t.length !== 1 + s.n) return { err: '% Invalid input detected at \'^\' marker.' }; return { r: { act, src: s.a } }; }
  const proto = (t[1] || '').toLowerCase(); if (!['ip', 'icmp', 'tcp', 'udp'].includes(proto)) return { err: '% Invalid input detected at \'^\' marker.' };
  const s = parseAddr(t, 2); if (!s) return { err: '% Incomplete command.' }; const d = parseAddr(t, 2 + s.n); if (!d) return { err: '% Incomplete command.' };
  let k = 2 + s.n + d.n, port = null;
  if (t[k] && t[k].toLowerCase() === 'eq') { if (proto !== 'tcp' && proto !== 'udp') return { err: '% Invalid input detected at \'^\' marker.' }; const v = t[k + 1] && t[k + 1].toLowerCase(); port = /^\d+$/.test(v || '') ? +v : PORTS[v]; if (!port) return { err: '% Incomplete command.' }; k += 2; }
  if (k !== t.length) return { err: '% Invalid input detected at \'^\' marker.' };
  return { r: { act, proto, src: s.a, dst: d.a, port } };
}
const addrOk = (a, ip) => a.any || ((ip & ~a.w) >>> 0) === ((a.ip & ~a.w) >>> 0);
function aclPermit(d, name, pkt) {
  const acl = d.acls[name]; if (!acl) return true; // une ACL appliquée mais inexistante laisse tout passer
  for (const r of acl.rules) {
    if (r.remark != null) continue;
    if (!acl.ext) { if (addrOk(r.src, pkt.src)) return r.act === 'permit'; continue; }
    if (r.proto !== 'ip' && r.proto !== pkt.proto) continue;
    if (!addrOk(r.src, pkt.src) || !addrOk(r.dst, pkt.dst)) continue;
    if (r.port != null && pkt.dport !== r.port) continue;
    return r.act === 'permit';
  }
  return false; // deny any implicite
}
const isStdNum = n => /^\d+$/.test(n) && ((+n >= 1 && +n <= 99) || (+n >= 1300 && +n <= 1999));
const isExtNum = n => /^\d+$/.test(n) && ((+n >= 100 && +n <= 199) || (+n >= 2000 && +n <= 2699));
/* ---------- NAT ---------- */
function natTrans(C, d, pkt) {
  for (const st of d.nat.statics) { if (st.local !== pkt.src) continue; if (st.proto) { if (pkt.proto === st.proto && pkt.sport === st.lport) { C.natLog.push({ dev: d.id, pro: st.proto, ig: n2ip(st.global) + ':' + st.gport, il: n2ip(st.local) + ':' + st.lport, og: n2ip(pkt.dst) }); return { src: st.global, sport: st.gport }; } continue; } C.natLog.push({ dev: d.id, pro: pkt.proto, ig: n2ip(st.global), il: n2ip(st.local), og: n2ip(pkt.dst), stat: true }); return { src: st.global }; }
  for (const r of d.nat.dyn) {
    if (!aclPermit(d, r.acl, { src: pkt.src, dst: pkt.dst, proto: pkt.proto, dport: pkt.dport })) continue;
    let g = null; if (r.ifn) { const o = C.owners.find(x => x.dev === d.id && x.ifn === r.ifn && !x.virt); if (!o) return { fail: true }; g = o.ip; } else { const p = d.nat.pools[r.pool]; if (!p) return { fail: true }; g = p.start; }
    C.natFlow.push({ dev: d.id, global: g, local: pkt.src }); C.natLog.push({ dev: d.id, pro: pkt.proto, ig: n2ip(g) + ':1', il: n2ip(pkt.src) + ':1', og: n2ip(pkt.dst) + ':1' });
    return { src: g };
  }
  return null;
}
function natUntrans(C, d, pkt) {
  for (const st of d.nat.statics) { if (st.global !== pkt.dst) continue; if (st.proto) { if (pkt.proto === st.proto && pkt.dport === st.gport) return { dst: st.local, dport: st.lport }; continue; } return { dst: st.local }; }
  const fl = C.natFlow.slice().reverse().find(x => x.dev === d.id && x.global === pkt.dst); if (fl) return { dst: fl.local };
  return null;
}
function owns(C, dev, ip) { return C.owners.some(o => o.dev === dev && o.ip === ip && !o.virt); }
function hop(C, dev, dst) {
  const d = C.N.devs[dev];
  if (d.kind === 'pc') { if (d.ip == null) return null; if (netOf(dst, d.mask) === netOf(d.ip, d.mask)) return { key: dev + ':nic', target: dst, src: d.ip }; if (d.gw == null) return null; return { key: dev + ':nic', target: d.gw, src: d.ip }; }
  if (d.kind === 'switch') { const sv = C.owners.filter(o => o.dev === dev); for (const o of sv) if (netOf(dst, o.mask) === netOf(o.ip, o.mask)) return { key: o.key, target: dst, src: o.ip }; if (d.gw != null) for (const o of sv) if (netOf(d.gw, o.mask) === netOf(o.ip, o.mask)) return { key: o.key, target: d.gw, src: o.ip }; return null; }
  const e = lookup(C.rt[dev], dst); if (!e) return null;
  const o = C.owners.find(x => x.dev === dev && x.ifn === e.ifn); if (!o) return null;
  if (e.code === 'C') return { key: o.key, target: dst, src: o.ip, ifn: o.ifn };
  if (e.nh != null) return { key: o.key, target: e.nh, src: o.ip, ifn: o.ifn };
  return { key: o.key, target: dst, src: o.ip, ifn: o.ifn };
}
function deliver(C, from, pkt) {
  let dev = from, inIf = null, hops = 0, origin = true;
  for (let i = 0; i < 24; i++) {
    const d = C.N.devs[dev];
    if (d.kind === 'router' && inIf) {
      const ii = d.ifs[inIf];
      if (ii && ii.acin && !aclPermit(d, ii.acin, pkt)) return { ok: false, why: 'acl', dev };
      if (ii && ii.nat === 'outside') { const t = natUntrans(C, d, pkt); if (t) Object.assign(pkt, t); }
    }
    if (owns(C, dev, pkt.dst)) return { ok: true, dev, pkt, hops };
    const h = hop(C, dev, pkt.dst); if (!h) return { ok: false, why: i === 0 ? 'noroute' : 'drop', dev };
    if (pkt.src == null) pkt.src = h.src;
    if (d.kind === 'router' && !origin) {
      if (inIf && d.ifs[inIf] && d.ifs[inIf].nat === 'inside' && d.ifs[h.ifn].nat === 'outside') { const t = natTrans(C, d, pkt); if (t && t.fail) return { ok: false, why: 'nat', dev }; if (t) Object.assign(pkt, t); }
      const oi = d.ifs[h.ifn]; if (oi && oi.acout && !aclPermit(d, oi.acout, pkt)) return { ok: false, why: 'acl', dev };
    }
    const seg = C.find(h.key);
    const nx = C.owners.find(o => o.ip === h.target && C.find(o.key) === seg && o.dev !== dev); if (!nx) return { ok: false, why: 'arp', dev };
    if (C.N.devs[nx.dev].kind === 'router' && !owns(C, nx.dev, pkt.dst)) hops++;
    dev = nx.dev; inIf = nx.ifn; origin = false;
  }
  return { ok: false, why: 'loop' };
}
// opt : { proto: 'icmp' | 'tcp', dport, record (garde les traductions NAT pour show ip nat translations) }
function ping(N, from, dstIp, opt = {}) {
  const dst = typeof dstIp === 'number' ? dstIp : ip2n(dstIp); if (dst == null) return { ok: false };
  const C = build(N); C.natLog = []; C.natFlow = [];
  const proto = opt.proto || 'icmp';
  const fd = N.devs[from]; const pkt = { src: fd.kind === 'pc' ? fd.ip : null, dst, proto, dport: opt.dport || null, sport: proto === 'tcp' ? 49152 : null };
  const a = deliver(C, from, pkt); let ok = a.ok;
  if (ok && proto === 'tcp') { const t = N.devs[a.dev]; if (!((t.kind === 'pc' && t.web && opt.dport === 80) || (t.kind !== 'pc' && (opt.dport === 22 || opt.dport === 23)))) ok = false; }
  if (ok && a.pkt.src != null && !(a.dev === from)) { const back = deliver(C, a.dev, { src: a.pkt.dst, dst: a.pkt.src, proto, sport: a.pkt.dport, dport: a.pkt.sport }); ok = back.ok; }
  if (opt.record) for (const l of C.natLog) { const r = N.devs[l.dev]; if (!r.natx) r.natx = []; if (!l.stat) { r.natx.push(l); r.natx = r.natx.slice(-12); } }
  return { ok, hops: a.hops || 0, why: a.why };
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
  'exec-timeout': 'Set the EXEC timeout', 'ospf': 'Open Shortest Path First (OSPF)', 'area': 'Set the OSPF area ID', 'router-id': 'router-id for this OSPF process', 'default-information': 'Control distribution of default information', 'originate': 'Distribute a default route', 'cost': 'Interface cost', 'neighbor': 'Neighbor list', 'access-list': 'Add an access list entry', 'access-lists': 'List access lists', 'access-group': 'Specify access control for packets', 'standard': 'Standard Access List', 'extended': 'Extended Access List', 'in': 'inbound packets', 'out': 'outbound packets', 'nat': 'NAT configuration commands', 'inside': 'Inside interface for address translation', 'outside': 'Outside interface for address translation', 'source': 'Source address translation', 'translations': 'Translation entries', 'pool': 'Define pool of addresses', 'permit': 'Specify packets to forward', 'deny': 'Specify packets to reject', 'remark': 'Access list entry comment', 'reference-bandwidth': 'Use reference bandwidth method to assign OSPF cost', 'dhcp': 'Configure DHCP server and relay parameters', 'excluded-address': 'Prevent DHCP from assigning certain addresses', 'default-router': 'Default routers', 'dns-server': 'DNS servers', 'domain-name': 'Define the default domain name', 'lease': 'Address lease time', 'binding': 'DHCP address bindings', 'username': 'Establish User Name Authentication', 'crypto': 'Encryption module', 'key': 'Long term key operations', 'generate': 'Generate new keys', 'rsa': 'Generate RSA keys', 'ssh': 'Configure ssh options', 'transport': 'Define transport protocols for line', 'input': 'Define which protocols to use when connecting to the terminal server', 'local': 'Local password checking', 'access-class': 'Filter connections based on an IP access list', 'port-security': 'Security related command', 'maximum': 'Max secure addresses', 'mac-address': 'Secure mac address', 'sticky': 'Configure dynamic secure addresses as sticky', 'violation': 'Security violation mode', 'mac': 'MAC configuration', 'address-table': 'MAC forwarding table', 'cdp': 'CDP information', 'neighbors': 'CDP neighbor entries', 'status': 'Show interface line status', 'priority': 'Set the bridge priority for the spanning tree', 'bpduguard': 'Don\'t accept BPDUs on this interface', 'domain': 'IP DNS Resolver', 'auto-cost': 'Calculate OSPF interface cost according to bandwidth', 'history': 'Display the session command history', 'clock rate': '', 'A.B.C.D': 'IP address', 'MASK': 'IP subnet mask', 'WORD': 'Text',
  'LINE': 'Text', 'N': 'Number', 'VLIST': 'VLAN IDs of the allowed VLANs', 'IF': 'Interface name (ex. g0/0)', 'IFR': 'Interface range (ex. f0/1-5)', 'NH': 'Forwarding router\'s address or interface',
};
const CMD = {}; const add = (modes, pat, fn, kind) => { for (const m of modes.split(' ')) (CMD[m] = CMD[m] || []).push({ p: pat.split(' '), fn, kind }); };
const CFGM = 'conf if subif swport svi ifr router ospf vlan line acl dhcp';
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
const PROMPT = { user: '>', priv: '#', conf: '(config)#', if: '(config-if)#', swport: '(config-if)#', svi: '(config-if)#', subif: '(config-subif)#', ifr: '(config-if-range)#', router: '(config-router)#', ospf: '(config-router)#', vlan: '(config-vlan)#', line: '(config-line)#', acl: '(config-std-nacl)#', dhcp: '(dhcp-config)#' };
function prompt(d, N) { if (d.kind === 'pc') { if (d.pend && d.pend.prompt != null) return d.pend.prompt; if (d.remote && N && N.devs[d.remote]) return prompt(N.devs[d.remote], N); return 'C:\\>'; } if (d.pend && d.pend.prompt != null) return d.pend.prompt; if (d.mode === 'acl' && d.acls[d.cur] && d.acls[d.cur].ext) return d.hostname + '(config-ext-nacl)#'; return d.hostname + PROMPT[d.mode]; }
function setMode(d, m) { d.mode = m; d.seen[m] = true; }
function exec(N, devId, raw) {
  const d = N.devs[devId];
  if (d.pend) { const p = d.pend; d.pend = null; return p.fn(raw); }
  if (d.kind === 'pc') return pcExec(N, d, raw);
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
    if (d.con.login === 'local' && Object.keys(d.users).length) { const askU = () => ({ prompt: 'Username: ', fn: u => { d.pend = { prompt: 'Password: ', secret: true, fn: pw => { if (d.users[u] && d.users[u].pw === pw) { d.pend = null; return { out: '' }; } d.pend = askU(); return { out: '% Login invalid\n' }; } }; return { out: '' }; } }); d.pend = askU(); return { out: ban + '\nUser Access Verification\n' }; }
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
  ['show ip ospf neighbor', (N, d) => soN(N, d), 'router'],
  ['show ip dhcp binding', (N, d) => 'Bindings from all pools not associated with VRF:\nIP address      Client-ID/              Lease expiration        Type\n                Hardware address\n' + (d.leases || []).map(l => n2ip(l.ip).padEnd(16) + ('01' + l.mac.replace(/\./g, '')).padEnd(24) + 'Mar 02 2026 12:00 AM    Automatic').join('\n'), 'router'],
  ['show ip dhcp pool', (N, d) => Object.entries(d.dhcp.pools).map(([n, p]) => `Pool ${n} :\n Utilization mark (high/low)    : 100 / 0\n Total addresses                : ${p.mask != null ? (2 ** (32 - plen(p.mask)) - 2) : 0}\n Leased addresses               : ${(d.leases || []).filter(l => p.net != null && netOf(l.ip, p.mask) === p.net).length}\n Network                        : ${p.net != null ? n2ip(p.net) + ' ' + n2ip(p.mask) : '(non défini)'}\n Default router                 : ${p.gw != null ? n2ip(p.gw) : ''}\n DNS server                     : ${p.dns != null ? n2ip(p.dns) : ''}`).join('\n\n'), 'router'],
  ['show ip ssh', (N, d) => d.rsa ? `SSH Enabled - version ${d.ssh.v === 2 ? '2.0' : '1.99'}\nAuthentication timeout: 120 secs; Authentication retries: 3` : 'SSH Disabled - version 1.99\n%Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).'],
  ['show users', (N, d) => '    Line       User       Host(s)              Idle       Location\n*  0 con 0                idle                 00:00:00\n' + Object.values(N.devs).filter(x => x.kind === 'pc' && x.remote === d.id).map((x, k) => `   ${2 + k} vty ${k}     ${x.ruser || ''}`.padEnd(32) + 'idle                 00:00:05 ' + n2ip(x.ip)).join('\n')],
  ['show cdp neighbors', (N, d) => sCdp(N, d)],
  ['show mac address-table', (N, d) => sMac(N, d), 'switch'],
  ['show interfaces status', (N, d) => sIfSt(N, d), 'switch'],
  ['show port-security', (N, d) => 'Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                (Count)       (Count)          (Count)\n---------------------------------------------------------------------------\n' + Object.keys(d.ifs).filter(n => d.ifs[n].ps && d.ifs[n].ps.on).sort(ifSort).map(n => { const p = d.ifs[n].ps; return shortIf(n).padEnd(13) + String(p.max).padStart(9) + String(p.macs.length).padStart(14) + String(p.count).padStart(17) + '         ' + p.viol[0].toUpperCase() + p.viol.slice(1); }).join('\n'), 'switch'],
  ['show spanning-tree', (N, d) => sStp(N, d), 'switch'],
  ['show access-lists', (N, d) => sAcl(N, d), 'router'],
  ['show ip nat translations', (N, d) => sNat(N, d), 'router'],
];
for (const [p, f, k] of SHOWS) { add(p === 'show users' ? 'user priv' : 'priv', p, (N, d) => { d.seen[p] = true; return f(N, d); }, k); }
add('priv', 'show port-security interface IF', (N, d, [n]) => { const pf = parseIf(n); const nm = pf && pf.base; const i = nm && d.ifs[nm]; if (!i) return '% Invalid input detected at \'^\' marker.'; d.seen['show port-security interface'] = true; const p = i.ps; if (!p || !p.on) return 'Port Security              : Disabled\nPort Status                : Secure-down'; return `Port Security              : Enabled\nPort Status                : ${physUp(N, d.id, nm) ? 'Secure-up' : 'Secure-down'}\nViolation Mode             : ${p.viol[0].toUpperCase() + p.viol.slice(1)}\nAging Time                 : 0 mins\nAging Type                 : Absolute\nSecureStatic Address Aging : Disabled\nMaximum MAC Addresses      : ${p.max}\nTotal MAC Addresses        : ${p.macs.length}\nConfigured MAC Addresses   : 0\nSticky MAC Addresses       : ${p.sticky ? p.macs.length : 0}\nLast Source Address:Vlan   : ${p.macs[0] || '0000.0000.0000'}:${i.vlan}\nSecurity Violation Count   : ${p.count}`; }, 'switch');
add('priv', 'show spanning-tree vlan N', (N, d, [v]) => { d.seen['show spanning-tree'] = true; return sStp(N, d, +v); }, 'switch');
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
add('user priv', 'ping A.B.C.D', (N, d, [ip]) => { const r = ping(N, d.id, ip, { record: true }); d.seen['ping ' + ip] = r.ok; d.seen.ping = true; return pingOut(ip, r.ok); });

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

/* --- OSPF --- */
add('conf', 'router ospf N', (N, d, [p]) => { if (!d.ospf || d.ospf.pid !== +p) d.ospf = { pid: +p, rid: null, nets: [], passive: [], dio: false }; setMode(d, 'ospf'); return ''; }, 'router');
add('conf', 'no router ospf N', (N, d) => { d.ospf = null; return ''; }, 'router');
add('ospf', 'network A.B.C.D A.B.C.D area N', (N, d, [a, w, ar]) => { const n = { a: (ip2n(a) & ~ip2n(w)) >>> 0, w: ip2n(w), area: +ar }; if (!d.ospf.nets.some(x => x.a === n.a && x.w === n.w)) d.ospf.nets.push(n); return ''; });
add('ospf', 'no network A.B.C.D A.B.C.D area N', (N, d, [a, w]) => { const na = (ip2n(a) & ~ip2n(w)) >>> 0; d.ospf.nets = d.ospf.nets.filter(x => !(x.a === na && x.w === ip2n(w))); return ''; });
add('ospf', 'router-id A.B.C.D', (N, d, [r]) => { d.ospf.rid = ip2n(r); return 'Reload or use "clear ip ospf process" command, for this to take effect'; });
add('ospf', 'passive-interface IF', (N, d, [n]) => { const p = parseIf(n); const nm = p && (p.sub != null ? p.base + '.' + p.sub : p.base); if (!nm || !d.ifs[nm]) return '% Invalid input detected at \'^\' marker.'; if (!d.ospf.passive.includes(nm)) d.ospf.passive.push(nm); return ''; });
add('ospf', 'no passive-interface IF', (N, d, [n]) => { const p = parseIf(n); const nm = p && (p.sub != null ? p.base + '.' + p.sub : p.base); d.ospf.passive = d.ospf.passive.filter(x => x !== nm); return ''; });
add('ospf', 'default-information originate', (N, d) => { d.ospf.dio = true; return ''; });
add('ospf', 'no default-information originate', (N, d) => { d.ospf.dio = false; return ''; });
add('ospf', 'auto-cost reference-bandwidth N', () => '% OSPF: Reference bandwidth is changed.\n        Please ensure reference bandwidth is consistent across all routers.');
add('if subif', 'ip ospf cost N', (N, d, [c]) => { d.ifs[d.cur].cost = +c; return ''; });
add('if subif', 'no ip ospf cost', (N, d) => { d.ifs[d.cur].cost = null; return ''; });
/* --- ACL --- */
add('conf', 'access-list N LINE', (N, d, [n, line]) => { if (!isStdNum(n) && !isExtNum(n)) return '% Invalid input detected at \'^\' marker.'; const ext = isExtNum(n); const p = parseRule(ext, line); if (p.err) return p.err; if (!d.acls[n]) d.acls[n] = { ext, rules: [] }; d.acls[n].rules.push(p.remark != null ? { remark: p.remark } : p.r); return ''; }, 'router');
add('conf', 'no access-list N', (N, d, [n]) => { delete d.acls[n]; return ''; }, 'router');
add('conf', 'ip access-list standard WORD', (N, d, [n]) => { if (isExtNum(n)) return '% Invalid input detected at \'^\' marker.'; if (!d.acls[n]) d.acls[n] = { ext: false, rules: [], named: !/^\d+$/.test(n) }; d.cur = n; setMode(d, 'acl'); return ''; }, 'router');
add('conf', 'ip access-list extended WORD', (N, d, [n]) => { if (isStdNum(n)) return '% Invalid input detected at \'^\' marker.'; if (!d.acls[n]) d.acls[n] = { ext: true, rules: [], named: !/^\d+$/.test(n) }; d.cur = n; setMode(d, 'acl'); return ''; }, 'router');
add('conf', 'no ip access-list standard WORD', (N, d, [n]) => { delete d.acls[n]; return ''; }, 'router');
add('conf', 'no ip access-list extended WORD', (N, d, [n]) => { delete d.acls[n]; return ''; }, 'router');
for (const w of ['permit', 'deny', 'remark']) add('acl', w + ' LINE', (N, d, [line]) => { const acl = d.acls[d.cur]; const p = parseRule(acl.ext, w + ' ' + line); if (p.err) return p.err; acl.rules.push(p.remark != null ? { remark: p.remark } : p.r); return ''; });
add('if subif', 'ip access-group WORD in', (N, d, [n]) => { d.ifs[d.cur].acin = n; return ''; });
add('if subif', 'ip access-group WORD out', (N, d, [n]) => { d.ifs[d.cur].acout = n; return ''; });
add('if subif', 'no ip access-group WORD in', (N, d) => { d.ifs[d.cur].acin = null; return ''; });
add('if subif', 'no ip access-group WORD out', (N, d) => { d.ifs[d.cur].acout = null; return ''; });
/* --- NAT --- */
add('if subif', 'ip nat inside', (N, d) => { d.ifs[d.cur].nat = 'inside'; return ''; });
add('if subif', 'ip nat outside', (N, d) => { d.ifs[d.cur].nat = 'outside'; return ''; });
add('if subif', 'no ip nat inside', (N, d) => { d.ifs[d.cur].nat = null; return ''; });
add('if subif', 'no ip nat outside', (N, d) => { d.ifs[d.cur].nat = null; return ''; });
function natSource(d, line, del) {
  const t = line.trim().split(/\s+/); const lw = t.map(x => x.toLowerCase()); const bad = '% Invalid input detected at \'^\' marker.';
  if (lw[0] === 'static') {
    let st;
    if (lw[1] === 'tcp' || lw[1] === 'udp') { const l = ip2n(t[2]), g = ip2n(t[4]); if (l == null || g == null || !/^\d+$/.test(t[3] || '') || !/^\d+$/.test(t[5] || '') || t.length !== 6) return bad; st = { proto: lw[1], local: l, lport: +t[3], global: g, gport: +t[5] }; }
    else { const l = ip2n(t[1]), g = ip2n(t[2]); if (l == null || g == null || t.length !== 3) return bad; st = { local: l, global: g }; }
    const same = x => x.local === st.local && x.global === st.global && x.proto === st.proto && x.lport === st.lport;
    d.nat.statics = d.nat.statics.filter(x => !same(x)); if (!del) d.nat.statics.push(st); return '';
  }
  if (lw[0] === 'list') {
    const acl = t[1]; if (!acl) return '% Incomplete command.'; let r;
    if (lw[2] === 'interface') { const p = parseIf(t[3] || ''); const nm = p && (p.sub != null ? p.base + '.' + p.sub : p.base); if (!nm || !d.ifs[nm]) return bad; r = { acl, ifn: nm, overload: lw[4] === 'overload' }; if (t.length > (r.overload ? 5 : 4)) return bad; }
    else if (lw[2] === 'pool') { if (!t[3]) return '% Incomplete command.'; r = { acl, pool: t[3], overload: lw[4] === 'overload' }; if (t.length > (r.overload ? 5 : 4)) return bad; }
    else return t.length < 3 ? '% Incomplete command.' : bad;
    d.nat.dyn = d.nat.dyn.filter(x => x.acl !== acl); if (!del) d.nat.dyn.push(r); return '';
  }
  return bad;
}
add('conf', 'ip nat inside source LINE', (N, d, [l]) => natSource(d, l, false), 'router');
add('conf', 'no ip nat inside source LINE', (N, d, [l]) => natSource(d, l, true), 'router');
add('conf', 'ip nat pool WORD A.B.C.D A.B.C.D netmask MASK', (N, d, [n, a, b, m]) => { d.nat.pools[n] = { start: ip2n(a), end: ip2n(b), mask: ip2n(m) }; return ''; }, 'router');
add('conf', 'no ip nat pool WORD', (N, d, [n]) => { delete d.nat.pools[n]; return ''; }, 'router');

/* --- Serveur DHCP du routeur --- */
add('conf', 'ip dhcp excluded-address A.B.C.D', (N, d, [a]) => { d.dhcp.excl.push([ip2n(a), ip2n(a)]); return ''; }, 'router');
add('conf', 'ip dhcp excluded-address A.B.C.D A.B.C.D', (N, d, [a, b]) => { if (ip2n(b) < ip2n(a)) return '% Invalid input detected at \'^\' marker.'; d.dhcp.excl.push([ip2n(a), ip2n(b)]); return ''; }, 'router');
add('conf', 'no ip dhcp excluded-address A.B.C.D A.B.C.D', (N, d, [a, b]) => { d.dhcp.excl = d.dhcp.excl.filter(x => !(x[0] === ip2n(a) && x[1] === ip2n(b))); return ''; }, 'router');
add('conf', 'ip dhcp pool WORD', (N, d, [n]) => { if (!d.dhcp.pools[n]) d.dhcp.pools[n] = { net: null, mask: null, gw: null, dns: null, domain: null, lease: 1 }; d.cur = n; setMode(d, 'dhcp'); return ''; }, 'router');
add('conf', 'no ip dhcp pool WORD', (N, d, [n]) => { delete d.dhcp.pools[n]; return ''; }, 'router');
add('dhcp', 'network A.B.C.D MASK', (N, d, [a, m]) => { const mask = ip2n(m); if (plen(mask) < 0) return '% Invalid input detected at \'^\' marker.'; const p = d.dhcp.pools[d.cur]; p.net = netOf(ip2n(a), mask); p.mask = mask; return ''; });
add('dhcp', 'default-router A.B.C.D', (N, d, [a]) => { d.dhcp.pools[d.cur].gw = ip2n(a); return ''; });
add('dhcp', 'dns-server A.B.C.D', (N, d, [a]) => { d.dhcp.pools[d.cur].dns = ip2n(a); return ''; });
add('dhcp', 'domain-name WORD', (N, d, [n]) => { d.dhcp.pools[d.cur].domain = n; return ''; });
add('dhcp', 'lease N', (N, d, [n]) => { d.dhcp.pools[d.cur].lease = +n; return ''; });
function allocate(N, C, srv, giaddr, pc) {
  const p = Object.values(srv.dhcp.pools).find(x => x.net != null && netOf(giaddr, x.mask) === x.net); if (!p) return null;
  if (!srv.leases) srv.leases = [];
  const mine = srv.leases.find(l => l.mac === pc.mac && netOf(l.ip, p.mask) === p.net); if (mine) return { ip: mine.ip, mask: p.mask, gw: p.gw, dns: p.dns, srv: srv.id };
  const used = new Set([...C.owners.map(o => o.ip), ...srv.leases.map(l => l.ip), ...Object.values(N.devs).filter(x => x.kind === 'pc' && x.ip != null && x !== pc).map(x => x.ip)]);
  const last = (p.net | (~p.mask >>> 0)) >>> 0;
  for (let a = p.net + 1; a < last; a++) { if (used.has(a) || srv.dhcp.excl.some(([x, y]) => a >= x && a <= y)) continue; srv.leases.push({ ip: a, mac: pc.mac, pc: pc.id }); return { ip: a, mask: p.mask, gw: p.gw, dns: p.dns, srv: srv.id }; }
  return null;
}
function dhcpRequest(N, pc) {
  const C = build(N); const seg = C.find(pc.id + ':nic');
  for (const o of C.owners.filter(x => !x.virt && C.find(x.key) === seg)) {
    const r = N.devs[o.dev]; if (r.kind !== 'router') continue;
    let l = allocate(N, C, r, o.ip, pc); if (l) return l;
    const h = r.ifs[o.ifn].helper;
    if (h != null) { const so = C.owners.find(x => x.ip === h && !x.virt); if (!so || N.devs[so.dev].kind !== 'router') continue; if (!ping(N, r.id, h).ok) continue; l = allocate(N, C, N.devs[so.dev], o.ip, pc); if (l) return l; }
  }
  return null;
}
/* --- Utilisateurs, SSH, Telnet --- */
add('conf', 'ip domain-name WORD', (N, d, [n]) => { d.dom = n; return ''; });
add('conf', 'ip domain name WORD', (N, d, [n]) => { d.dom = n; return ''; });
add('conf', 'username WORD secret WORD', (N, d, [u, p]) => { d.users[u] = { pw: p, secret: true }; return ''; });
add('conf', 'username WORD password WORD', (N, d, [u, p]) => { d.users[u] = { pw: p, secret: false }; return ''; });
add('conf', 'no username WORD', (N, d, [u]) => { delete d.users[u]; return ''; });
function genKey(d, bits) {
  if (/^(router|switch)$/i.test(d.hostname)) return '% Please define a hostname other than ' + d.hostname + '.';
  if (!d.dom) return '% Please define a domain-name first.';
  if (bits < 360 || bits > 4096) return '% Invalid input detected at \'^\' marker.';
  d.rsa = bits; return `The name for the keys will be: ${d.hostname}.${d.dom}\n% The key modulus size is ${bits} bits\n% Generating ${bits} bit RSA keys, keys will be non-exportable...[OK]\n*Mar 1 00:12:41.123: %SSH-5-ENABLED: SSH 1.99 has been enabled`;
}
add('conf', 'crypto key generate rsa', (N, d) => { if (/^(router|switch)$/i.test(d.hostname) || !d.dom) return genKey(d, 1024); d.pend = { prompt: 'How many bits in the modulus [512]: ', fn: a => ({ out: genKey(d, /^\s*\d+\s*$/.test(a) ? +a : 512).split('\n').slice(1).join('\n') }) }; return { out: `The name for the keys will be: ${d.hostname}.${d.dom}\nChoose the size of the key modulus in the range of 360 to 4096 for your\n  General Purpose Keys. Choosing a key modulus greater than 512 may take\n  a few minutes.\n` }; });
add('conf', 'crypto key generate rsa modulus N', (N, d, [b]) => genKey(d, +b));
add('conf', 'crypto key generate rsa general-keys modulus N', (N, d, [b]) => genKey(d, +b));
add('conf', 'crypto key zeroize rsa', (N, d) => { d.rsa = null; return '% All keys will be removed.\n% All router certs issued using these keys will also be removed.'; });
add('conf', 'ip ssh version N', (N, d, [v]) => { if (v !== '1' && v !== '2') return '% Invalid input detected at \'^\' marker.'; if (!d.rsa || (v === '2' && d.rsa < 768)) return 'Please create RSA keys to enable SSH (and of atleast 768 bits for SSH v2).'; d.ssh.v = +v; return ''; });
add('conf', 'ip ssh time-out N', () => '');
add('conf', 'ip ssh authentication-retries N', () => '');
for (const t of ['ssh', 'telnet', 'all', 'none']) add('line', 'transport input ' + t, (N, d) => { d[d.cur].transport = t; return ''; });
add('line', 'transport input telnet ssh', (N, d) => { d[d.cur].transport = 'all'; return ''; });
add('line', 'transport input ssh telnet', (N, d) => { d[d.cur].transport = 'all'; return ''; });
add('line', 'login local', (N, d) => { d[d.cur].login = 'local'; return ''; });
add('line', 'access-class WORD in', (N, d, [n]) => { if (d.cur !== 'vty') return '% Invalid input detected at \'^\' marker.'; d.vty.acl = n; return ''; });
add('line', 'no access-class WORD in', (N, d) => { d.vty.acl = null; return ''; });
/* --- Spanning-tree --- */
add('conf', 'spanning-tree mode pvst', (N, d) => { d.stp.mode = 'pvst'; return ''; }, 'switch');
add('conf', 'spanning-tree mode rapid-pvst', (N, d) => { d.stp.mode = 'rapid-pvst'; return ''; }, 'switch');
add('conf', 'spanning-tree vlan N priority N', (N, d, [v, p]) => { if (+p % 4096 || +p > 61440) return '% Bridge Priority must be in increments of 4096.\n% Allowed values are:\n  0     4096  8192  12288 16384 20480 24576 28672\n  32768 36864 40960 45056 49152 53248 57344 61440'; d.stp.prio[v] = +p; return ''; }, 'switch');
add('conf', 'spanning-tree vlan N root primary', (N, d, [v]) => { d.stp.prio[v] = 24576; return ''; }, 'switch');
add('conf', 'spanning-tree vlan N root secondary', (N, d, [v]) => { d.stp.prio[v] = 28672; return ''; }, 'switch');
/* --- Sécurité des ports --- */
function psOn(N, d, i, n) { if (!i.mset || i.mode !== 'access') return 'Command rejected: ' + n + ' is a dynamic port.'; if (!i.ps) i.ps = { max: 1, sticky: false, viol: 'shutdown', macs: [], count: 0 }; return null; }
function learnSticky(N, d, i, n) { if (!i.ps || !i.ps.sticky) return; const p = linkPeer(N, d.id, n); if (!p) return; const pd = N.devs[p[0]]; const mac = pd.kind === 'pc' ? pd.mac : macOf(p[0] + ':' + p[1]); if (!i.ps.macs.includes(mac) && i.ps.macs.length < i.ps.max) i.ps.macs.push(mac); }
add('swport ifr', 'switchport port-security', (N, d) => forIfs(N, d, (i, n) => { const e = psOn(N, d, i, n); if (e) return e; i.ps.on = true; learnSticky(N, d, i, n); return ''; }));
add('swport ifr', 'no switchport port-security', (N, d) => forIfs(N, d, i => { i.ps = null; return ''; }));
add('swport ifr', 'switchport port-security maximum N', (N, d, [m]) => forIfs(N, d, (i, n) => { const e = psOn(N, d, i, n); if (e) return e; i.ps.max = Math.max(1, +m); return ''; }));
add('swport ifr', 'switchport port-security mac-address sticky', (N, d) => forIfs(N, d, (i, n) => { const e = psOn(N, d, i, n); if (e) return e; i.ps.sticky = true; if (i.ps.on) learnSticky(N, d, i, n); return ''; }));
for (const v of ['shutdown', 'restrict', 'protect']) add('swport ifr', 'switchport port-security violation ' + v, (N, d) => forIfs(N, d, (i, n) => { const e = psOn(N, d, i, n); if (e) return e; i.ps.viol = v; return ''; }));
add('swport ifr', 'spanning-tree bpduguard enable', (N, d) => { forIfs(N, d, i => { i.bpdug = true; }); return ''; });

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
add('swport ifr', 'switchport mode access', (N, d) => { forIfs(N, d, i => { i.mode = 'access'; i.mset = true; }); return ''; });
add('swport ifr', 'switchport mode trunk', (N, d) => { forIfs(N, d, i => { if (i.ps) return; i.mode = 'trunk'; i.mset = true; }); return ''; });
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
  if (d.dom) { p('ip domain-name ' + d.dom); p('!'); }
  if (d.dhcp && (d.dhcp.excl.length || Object.keys(d.dhcp.pools).length)) { for (const [a, b] of d.dhcp.excl) p('ip dhcp excluded-address ' + n2ip(a) + (b !== a ? ' ' + n2ip(b) : '')); p('!'); for (const [n, pl] of Object.entries(d.dhcp.pools)) { p('ip dhcp pool ' + n); if (pl.net != null) p(' network ' + n2ip(pl.net) + ' ' + n2ip(pl.mask)); if (pl.gw != null) p(' default-router ' + n2ip(pl.gw)); if (pl.dns != null) p(' dns-server ' + n2ip(pl.dns)); if (pl.domain) p(' domain-name ' + pl.domain); p('!'); } }
  for (const [u, x] of Object.entries(d.users || {})) p('username ' + u + (x.secret ? ' secret 5 ' + secretHash(x.pw) : ' password ' + (d.pwenc ? '7 ' + encPw(x.pw) : x.pw)));
  if (d.ssh && d.ssh.v) { p('!'); p('ip ssh version ' + d.ssh.v); }
  if (d.kind === 'switch') { p('!'); p('spanning-tree mode ' + d.stp.mode); for (const [v, pr] of Object.entries(d.stp.prio)) p('spanning-tree vlan ' + v + ' priority ' + pr); }
  p('!');
  if (d.kind === 'switch') { const vs = Object.keys(d.vlans).map(Number).filter(v => v > 1 && v < 1002); for (const v of vs) { p('vlan ' + v); p(' name ' + d.vlans[v]); p('!'); } }
  for (const n of Object.keys(d.ifs).sort(ifSort)) {
    const i = d.ifs[n]; p('interface ' + n); if (i.desc) p(' description ' + i.desc);
    if (isSwPort(d, n)) {
      if (i.mode === 'access' && i.vlan !== 1) p(' switchport access vlan ' + i.vlan);
      if (i.mode === 'trunk') { if (i.tenc) p(' switchport trunk encapsulation dot1q'); if (i.native !== 1) p(' switchport trunk native vlan ' + i.native); if (i.allowed) p(' switchport trunk allowed vlan ' + fmtVlist(i.allowed)); }
      if (i.mode === 'trunk') p(' switchport mode trunk'); else if (i.vlan !== 1 || i.voice || i.mset) p(' switchport mode access');
      if (i.voice) p(' switchport voice vlan ' + i.voice); if (i.nonego) p(' switchport nonegotiate');
      if (i.ps && i.ps.on) { p(' switchport port-security'); if (i.ps.max !== 1) p(' switchport port-security maximum ' + i.ps.max); if (i.ps.viol !== 'shutdown') p(' switchport port-security violation ' + i.ps.viol); if (i.ps.sticky) { p(' switchport port-security mac-address sticky'); for (const m of i.ps.macs) p(' switchport port-security mac-address sticky ' + m); } }
      if (i.portfast) p(' spanning-tree portfast'); if (i.bpdug) p(' spanning-tree bpduguard enable');
    } else {
      if (i.encap != null) p(' encapsulation dot1Q ' + i.encap);
      p(i.ip != null ? ' ip address ' + n2ip(i.ip) + ' ' + n2ip(i.mask) : ' no ip address');
      if (i.helper != null) p(' ip helper-address ' + n2ip(i.helper));
      if (i.acin) p(' ip access-group ' + i.acin + ' in'); if (i.acout) p(' ip access-group ' + i.acout + ' out');
      if (i.nat) p(' ip nat ' + i.nat); if (i.cost) p(' ip ospf cost ' + i.cost);
      if (!n.includes('.') && !n.startsWith('Vlan') && !n.startsWith('Loopback') && d.kind === 'router') p(' duplex auto\n speed auto');
      if (i.clock) p(' clock rate ' + i.clock);
    }
    if (i.shut) p(' shutdown'); p('!');
  }
  if (d.rip) { p('router rip'); if (d.rip.v) p(' version ' + d.rip.v); for (const pi of d.rip.passive) p(' passive-interface ' + pi); for (const n of d.rip.nets) p(' network ' + n2ip(n)); if (d.rip.noauto) p(' no auto-summary'); p('!'); }
  if (d.ospf) { p('router ospf ' + d.ospf.pid); if (d.ospf.rid != null) p(' router-id ' + n2ip(d.ospf.rid)); p(' log-adjacency-changes'); for (const pi of d.ospf.passive) p(' passive-interface ' + pi); for (const n of d.ospf.nets) p(' network ' + n2ip(n.a) + ' ' + n2ip(n.w) + ' area ' + n.area); if (d.ospf.dio) p(' default-information originate'); p('!'); }
  if (d.gw != null) { p('ip default-gateway ' + n2ip(d.gw)); p('!'); }
  if (d.kind === 'router' && d.nat) { for (const [n, pl] of Object.entries(d.nat.pools)) p('ip nat pool ' + n + ' ' + n2ip(pl.start) + ' ' + n2ip(pl.end) + ' netmask ' + n2ip(pl.mask)); for (const r of d.nat.dyn) p('ip nat inside source list ' + r.acl + ' ' + (r.ifn ? 'interface ' + r.ifn : 'pool ' + r.pool) + (r.overload ? ' overload' : '')); for (const st of d.nat.statics) p('ip nat inside source static ' + (st.proto ? st.proto + ' ' + n2ip(st.local) + ' ' + st.lport + ' ' + n2ip(st.global) + ' ' + st.gport : n2ip(st.local) + ' ' + n2ip(st.global))); }
  if (d.kind === 'router') { p('ip classless'); for (const r of d.routes) p('ip route ' + n2ip(r.net) + ' ' + n2ip(r.mask) + ' ' + (r.nh != null ? n2ip(r.nh) : r.ifn)); p('!'); }
  if (d.kind === 'router' && d.acls) { for (const [n, a] of Object.entries(d.acls)) { const rl = r => r.remark != null ? 'remark ' + r.remark : r.act + ' ' + (a.ext ? r.proto + ' ' + fmtAddr(r.src) + ' ' + fmtAddr(r.dst) + (r.port != null ? ' eq ' + (PNAME[r.port] || r.port) : '') : (r.src.any ? 'any' : r.src.w === 0 ? 'host ' + n2ip(r.src.ip) : n2ip(r.src.ip) + ' ' + n2ip(r.src.w))); if (/^\d+$/.test(n) && !a.named) { for (const r of a.rules) p('access-list ' + n + ' ' + rl(r)); } else { p('ip access-list ' + (a.ext ? 'extended ' : 'standard ') + n); for (const r of a.rules) p(' ' + rl(r)); } } p('!'); }
  if (d.banner) { p('banner motd ^C' + d.banner + '^C'); p('!'); }
  const line = (name, l) => { p(name); if (l.acl) p(' access-class ' + l.acl + ' in'); if (l.pw) p(' password ' + (d.pwenc ? '7 ' + encPw(l.pw) : l.pw)); if (l.login) p(l.login === 'local' ? ' login local' : ' login'); if (l.transport && l.transport !== 'all' && name.startsWith('line vty')) p(' transport input ' + l.transport); };
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
  const L = ['Codes: L - local, C - connected, S - static, R - RIP, M - mobile, B - BGP', '       D - EIGRP, EX - EIGRP external, O - OSPF, IA - OSPF inter area', '       E1 - OSPF external type 1, E2 - OSPF external type 2', '       * - candidate default, U - per-user static route', '', 'Gateway of last resort is ' + (def ? (def.nh != null ? n2ip(def.nh) : 'reached via ' + def.ifn) + ' to network 0.0.0.0' : 'not set'), ''];
  for (const r of R) {
    const code = (r.code.length > 1 ? r.code : r.code + (r.len === 0 ? '*' : '')).padEnd(5); const dst = n2ip(r.net) + '/' + r.len;
    if (r.code === 'C' || r.code === 'L') L.push(code + '   ' + dst + ' is directly connected, ' + r.ifn);
    else if (r.code === 'S') L.push(code + '   ' + dst + (r.nh != null ? ' [1/0] via ' + n2ip(r.nh) : ' is directly connected, ' + r.ifn));
    else L.push(code + '   ' + dst + ' [' + r.ad + '/' + r.metric + '] via ' + n2ip(r.nh) + ', ' + (r.code === 'R' ? '00:00:' + String(10 + (r.metric * 7) % 40).padStart(2, '0') : '00:02:' + String(10 + r.metric % 40).padStart(2, '0')) + ', ' + r.ifn);
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
function soN(N, d) {
  if (!d.ospf) return '';
  const C = build(N); const L = ['Neighbor ID     Pri   State           Dead Time   Address         Interface'];
  for (const n of C.ospf.nb[d.id] || []) L.push(n2ip(n.rid).padEnd(16) + '1'.padEnd(6) + (n.ifn.startsWith('Serial') ? 'FULL/  -' : n.dr ? 'FULL/DR' : 'FULL/BDR').padEnd(16) + '00:00:3' + (n.rid % 9) + '    ' + n2ip(n.ip).padEnd(16) + n.ifn);
  return L.join('\n');
}
function fmtAddr(a, std) { if (a.any) return 'any'; if (a.w === 0) return std ? n2ip(a.ip) : 'host ' + n2ip(a.ip); return std ? n2ip(a.ip) + ', wildcard bits ' + n2ip(a.w) : n2ip(a.ip) + ' ' + n2ip(a.w); }
const PNAME = { 80: 'www', 23: 'telnet', 21: 'ftp', 22: '22', 53: 'domain', 25: 'smtp', 110: 'pop3' };
function sAcl(N, d) {
  const L = [];
  for (const [n, a] of Object.entries(d.acls)) { L.push((a.ext ? 'Extended' : 'Standard') + ' IP access list ' + n); let k = 0; for (const r of a.rules) { if (r.remark != null) continue; k += 10; L.push('    ' + k + ' ' + r.act + ' ' + (a.ext ? r.proto + ' ' + fmtAddr(r.src) + ' ' + fmtAddr(r.dst) + (r.port != null ? ' eq ' + (PNAME[r.port] || r.port) : '') : fmtAddr(r.src, true))); } }
  return L.join('\n');
}
function sNat(N, d) {
  const L = ['Pro  Inside global         Inside local          Outside local         Outside global'];
  for (const x of (d.natx || [])) L.push((x.pro || 'icmp').padEnd(5) + x.ig.padEnd(22) + x.il.padEnd(22) + x.og.padEnd(22) + x.og);
  for (const st of d.nat.statics) L.push((st.proto || '---').padEnd(5) + (n2ip(st.global) + (st.proto ? ':' + st.gport : '')).padEnd(22) + (n2ip(st.local) + (st.proto ? ':' + st.lport : '')).padEnd(22) + '---'.padEnd(22) + '---');
  return L.join('\n');
}
function sCdp(N, d) {
  const L = ['Capability Codes: R - Router, T - Trans Bridge, B - Source Route Bridge', '                  S - Switch, H - Host, I - IGMP, r - Repeater, P - Phone', '', 'Device ID        Local Intrfce     Holdtme    Capability   Platform    Port ID'];
  for (const n of Object.keys(d.ifs).sort(ifSort)) { const p = linkPeer(N, d.id, n); if (!p || !physUp(N, d.id, n)) continue; const pd = N.devs[p[0]]; if (pd.kind === 'pc') continue; const sh = x => shortIf(x).replace(/^([A-Z][a-z])/, m => ({ Gi: 'Gig ', Fa: 'Fas ', Se: 'Ser ' }[m] || m)); L.push(pd.hostname.padEnd(17) + sh(n).padEnd(18) + '160'.padEnd(11) + (pd.kind === 'router' ? 'R' : 'S I').padEnd(13) + (pd.kind === 'router' ? 'C1941' : '2960').padEnd(12) + sh(p[1])); }
  return L.join('\n');
}
function portMacs(N, d, n, depth) {
  const p = linkPeer(N, d.id, n); if (!p || !physUp(N, d.id, n)) return []; const pd = N.devs[p[0]]; const i = d.ifs[n]; const out = [];
  if (pd.kind === 'pc') out.push([i.mode === 'trunk' ? i.native : i.vlan, pd.mac]);
  else if (pd.kind === 'router') { out.push([i.mode === 'trunk' ? i.native : i.vlan, macOf(p[0] + ':' + p[1])]); if (i.mode === 'trunk') for (const [sn, si] of Object.entries(pd.ifs)) if (sn.startsWith(p[1] + '.') && si.encap != null && !si.shut) out.push([si.encap, macOf(p[0] + ':' + p[1])]); }
  else if (depth > 0) for (const m of Object.keys(pd.ifs).filter(x => isSwPort(pd, x) && x !== p[1])) for (const [v, mac] of portMacs(N, pd, m, depth - 1)) { const ok = i.mode === 'trunk' ? allowedHas(i.allowed, v) && allowedHas(pd.ifs[p[1]].allowed, v) : v === i.vlan; if (ok) out.push([v, mac]); }
  return out;
}
function sMac(N, d) {
  const L = ['          Mac Address Table', '-------------------------------------------', '', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----'];
  const rows = []; for (const n of Object.keys(d.ifs).filter(x => isSwPort(d, x))) for (const [v, mac] of portMacs(N, d, n, 2)) rows.push([v, mac, (d.ifs[n].ps && d.ifs[n].ps.sticky && d.ifs[n].ps.macs.includes(mac)) ? 'STATIC' : 'DYNAMIC', shortIf(n)]);
  rows.sort((a, b) => a[0] - b[0] || (a[3] < b[3] ? -1 : 1)); for (const r of rows) L.push(String(r[0]).padStart(4) + '    ' + r[1].padEnd(18) + r[2].padEnd(12) + r[3]);
  return L.join('\n');
}
function sIfSt(N, d) {
  const L = ['Port      Name               Status       Vlan       Duplex  Speed  Type'];
  for (const n of Object.keys(d.ifs).filter(x => isSwPort(d, x)).sort(ifSort)) { const i = d.ifs[n]; const st = i.shut ? 'disabled' : physUp(N, d.id, n) ? 'connected' : 'notconnect'; L.push(shortIf(n).padEnd(10) + (i.desc || '').slice(0, 18).padEnd(19) + st.padEnd(13) + (i.mode === 'trunk' ? 'trunk' : String(i.vlan)).padEnd(11) + (st === 'connected' ? 'a-full' : 'auto').padEnd(8) + (st === 'connected' ? (n.startsWith('Gig') ? 'a-1000' : 'a-100') : 'auto').padEnd(7) + (n.startsWith('Gig') ? '10/100/1000BaseTX' : '10/100BaseTX')); }
  return L.join('\n');
}
function sStp(N, d, only) {
  const C = build(N); const base = macOf(d.id + ':bridge');
  const vl = only ? [only] : Object.keys(d.vlans).map(Number).filter(v => v < 1002 && (v === 1 || Object.values(d.ifs).some(i => i.vlan === v || i.mode === 'trunk')));
  const L = [];
  for (const v of vl) {
    if (!d.vlans[v]) { L.push('Spanning tree instance(s) for vlan ' + v + ' does not exist.'); continue; }
    const key = d.id + ':v' + v; const sws = Object.values(N.devs).filter(x => x.kind === 'switch' && x.vlans && x.vlans[v] && C.find(x.id + ':v' + v) === C.find(key));
    const bid = x => [(x.stp.prio[v] != null ? x.stp.prio[v] : 32768) + v, macOf(x.id + ':bridge')]; const me = bid(d);
    const root = sws.map(x => [x, bid(x)]).sort((a, b) => a[1][0] - b[1][0] || (a[1][1] < b[1][1] ? -1 : 1))[0];
    const isRoot = root[0] === d;
    L.push('VLAN' + String(v).padStart(4, '0'), '  Spanning tree enabled protocol ' + (d.stp.mode === 'rapid-pvst' ? 'rstp' : 'ieee'), '  Root ID    Priority    ' + root[1][0], '             Address     ' + root[1][1].toUpperCase());
    const ports = Object.keys(d.ifs).filter(n => isSwPort(d, n) && physUp(N, d.id, n) && (d.ifs[n].mode === 'trunk' ? allowedHas(d.ifs[n].allowed, v) : d.ifs[n].vlan === v)).sort(ifSort);
    const rootPort = isRoot ? null : ports.find(n => { const p = linkPeer(N, d.id, n); return p && N.devs[p[0]].kind === 'switch'; });
    L.push(isRoot ? '             This bridge is the root' : '             Cost        ' + (rootPort && rootPort.startsWith('Gig') ? 4 : 19) + '\n             Port        ' + (rootPort ? (Object.keys(d.ifs).indexOf(rootPort) + 1) + ' (' + rootPort + ')' : ''));
    L.push('  Bridge ID  Priority    ' + me[0] + '  (priority ' + (me[0] - v) + ' sys-id-ext ' + v + ')', '             Address     ' + base.toUpperCase(), '', 'Interface        Role Sts Cost      Prio.Nbr Type', '---------------- ---- --- --------- -------- --------------------------------');
    for (const n of ports) L.push(shortIf(n).padEnd(17) + (n === rootPort ? 'Root' : 'Desg') + ' FWD ' + String(n.startsWith('Gig') ? 4 : 19).padEnd(10) + ('128.' + (Object.keys(d.ifs).indexOf(n) + 1)).padEnd(9) + (d.ifs[n].portfast ? 'P2p Edge' : 'P2p'));
    L.push('');
  }
  return L.join('\n');
}
function sip(N, d) {
  const o = d.ospf ? `Routing Protocol is "ospf ${d.ospf.pid}"\nOutgoing update filter list for all interfaces is not set\nIncoming update filter list for all interfaces is not set\nRouter ID ${n2ip(ospfRid(build(N), d))}\nNumber of areas in this router is 1. 1 normal 0 stub 0 nssa\nMaximum path: 4\nRouting for Networks:\n${d.ospf.nets.map(n => '    ' + n2ip(n.a) + ' ' + n2ip(n.w) + ' area ' + n.area).join('\n')}\nPassive Interface(s):\n${d.ospf.passive.map(p => '    ' + p).join('\n')}\nDistance: (default is 110)\n\n` : '';
  if (!d.rip) return o.trim();
  return o + sipRip(N, d);
}
function sipRip(N, d) {
  const nets = d.rip.nets.map(n => '    ' + n2ip(n)).join('\n');
  return `Routing Protocol is "rip"\nSending updates every 30 seconds, next due in 12 seconds\nInvalid after 180 seconds, hold down 180, flushed after 240\nDefault version control: send version ${d.rip.v || 1}, receive ${d.rip.v ? 'version ' + d.rip.v : 'any version'}\nAutomatic network summarization is ${d.rip.noauto ? 'not ' : ''}in effect\nMaximum path: 4\nRouting for Networks:\n${nets}\nPassive Interface(s):\n${d.rip.passive.map(p => '    ' + p).join('\n')}\nRouting Information Sources:\n  Gateway         Distance      Last Update\nDistance: (default is 120)`;
}

/* ---------- PC (invite Windows) ---------- */
function remoteLogin(N, pc, ip, proto, user) {
  const C = build(N); const o = C.owners.find(x => x.ip === ip2n(ip) && !x.virt); const port = proto === 'ssh' ? 22 : 23;
  const r = ping(N, pc.id, ip, { proto: 'tcp', dport: port });
  const fail = proto === 'ssh' ? `ssh: connect to host ${ip} port 22: Connection timed out` : `Connexion à ${ip}...Impossible d'ouvrir une connexion à l'hôte, sur le port 23: Échec lors de la connexion`;
  if (!o || !r.ok) return { out: fail };
  const d = N.devs[o.dev]; if (d.kind === 'pc') return { out: fail.replace('timed out', 'refused') };
  const tr = d.vty.transport; const okT = tr === 'all' || tr === proto;
  if (!okT || (proto === 'ssh' && !d.rsa)) return { out: proto === 'ssh' ? `ssh: connect to host ${ip} port 22: Connection refused` : `Connexion à ${ip}...Impossible d'ouvrir une connexion à l'hôte, sur le port 23: Échec lors de la connexion` };
  if (d.vty.acl && !aclPermit(d, d.vty.acl, { src: pc.ip, dst: ip2n(ip), proto: 'tcp', dport: port })) return { out: proto === 'ssh' ? `ssh: connect to host ${ip} port 22: Connection refused` : `Connexion à ${ip}...Impossible d'ouvrir une connexion à l'hôte, sur le port 23: Échec lors de la connexion` };
  const open = u => { pc.remote = d.id; pc.ruser = u || ''; pc.rsave = { mode: d.mode, cur: d.cur }; d.mode = 'user'; d.cur = null; d.seen[proto + 'Login'] = true; pc.seen[proto + ' ' + ip] = true; return { out: (d.banner ? d.banner + '\n' : '') + `\n(Connecté en ${proto.toUpperCase()} à ${d.hostname}. Tape « exit » pour revenir au PC.)\n` }; };
  if (d.vty.login === 'local') {
    if (!Object.keys(d.users).length) return { out: '% Login disabled : aucun utilisateur local n\'est défini.' };
    const askPw = u => ({ prompt: (proto === 'ssh' ? u + '@' + ip + "'s " : '') + 'Password: ', secret: true, fn: pw => { if (d.users[u] && d.users[u].pw === pw) return open(u); pc.seen[proto + ' ' + ip] = false; return { out: proto === 'ssh' ? 'Permission denied, please try again.' : '% Login invalid' }; } });
    if (proto === 'ssh') { if (!user) return { out: 'usage: ssh -l <utilisateur> <adresse>' }; pc.pend = askPw(user); return { out: '' }; }
    pc.pend = { prompt: 'Username: ', fn: u => { pc.pend = askPw(u); return { out: '' }; } }; return { out: '\nUser Access Verification\n' };
  }
  if (proto === 'ssh') return { out: `ssh: connect to host ${ip} port 22: Connection refused (SSH demande « login local » et un utilisateur)` };
  if (!d.vty.login || !d.vty.pw) return { out: '\nPassword required, but none set\n\n[Connexion à l\'hôte perdue.]' };
  pc.pend = { prompt: 'Password: ', secret: true, fn: pw => pw === d.vty.pw ? open('') : { out: '% Bad passwords' } }; return { out: '\nUser Access Verification\n' };
}
function pcExec(N, d, raw) {
  const t = raw.trim(); const tl = t.toLowerCase();
  if (d.remote) {
    const rd = N.devs[d.remote];
    if (!rd) { d.remote = null; } else {
      if ((tl === 'exit' || tl === 'logout' || tl === 'quit') && (rd.mode === 'user' || rd.mode === 'priv')) { d.remote = null; const sv = d.rsave || { mode: 'user', cur: null }; rd.mode = sv.mode; rd.cur = sv.cur; d.rsave = null; return { out: `\n[Connexion à ${rd.hostname} fermée.]` }; }
      return exec(N, rd.id, raw);
    }
  }
  d.seen[tl] = true;
  if (/^ipconfig\s+\/renew$/.test(tl)) { if (!d.dhcp) return { out: "L'opération a échoué : cette carte a une adresse IP fixe (DHCP désactivé)." }; const l = dhcpRequest(N, d); if (l) { d.ip = l.ip; d.mask = l.mask; d.gw = l.gw; d.dns = l.dns; d.dhcpSrv = l.srv; d.seen.renewOk = true; } else { d.ip = ip2n('169.254.' + (17 + d.id.length * 13 % 200) + '.' + (20 + d.id.charCodeAt(d.id.length - 1) % 200)); d.mask = ip2n('255.255.0.0'); d.gw = null; d.dns = null; d.dhcpSrv = null; d.seen.renewOk = false; } return pcExec(N, d, 'ipconfig'); }
  if (/^ipconfig\s+\/release$/.test(tl)) { if (d.dhcp) { for (const r of Object.values(N.devs)) if (r.leases) r.leases = r.leases.filter(l => l.mac !== d.mac); d.ip = d.mask = d.gw = d.dns = null; d.dhcpSrv = null; } return pcExec(N, d, 'ipconfig'); }
  const sm = /^ssh\s+(?:-l\s+(\S+)\s+(\S+)|(\S+)@(\S+))$/.exec(t); if (sm) return remoteLogin(N, d, sm[2] || sm[4], 'ssh', sm[1] || sm[3]);
  if (/^ssh\b/.test(tl)) return { out: 'usage: ssh -l <utilisateur> <adresse IP>   (ou ssh utilisateur@adresse)' };
  const tm = /^telnet\s+(\S+)$/.exec(tl); if (tm) return remoteLogin(N, d, tm[1], 'telnet');
  if (!t) return { out: '' };
  if (/^ipconfig(\s+\/all)?$/.test(tl)) return { out: `\nConfiguration IP de Windows\n\nCarte Ethernet Ethernet :\n\n   Adresse physique . . . . . . . . . . . : ${d.mac.replace(/\./g, '').replace(/(..)(?!$)/g, '$1-').toUpperCase()}\n   DHCP activé. . . . . . . . . . . . . . : ${d.dhcp ? 'Oui' : 'Non'}\n   Adresse IPv4. . . . . . . . . . . . . .: ${d.ip != null ? n2ip(d.ip) + (d.ip >>> 16 === 0xA9FE ? '(autoconfiguration APIPA)' : '') : '0.0.0.0'}\n   Masque de sous-réseau. . . . . . . . . : ${d.mask != null ? n2ip(d.mask) : '0.0.0.0'}\n   Passerelle par défaut. . . . . . . . . : ${d.gw != null ? n2ip(d.gw) : ''}\n   Serveur DHCP . . . . . . . . . . . . . : ${d.dhcpSrv ? d.dhcpSrv : ''}\n   Serveurs DNS. . . . . . . . . . . . . .: ${d.dns != null ? n2ip(d.dns) : ''}\n` };
  const m = /^ping\s+(\S+)$/.exec(tl);
  if (m) {
    if (ip2n(m[1]) == null) return { out: `La requête Ping n'a pas pu trouver l'hôte ${m[1]}. Vérifiez le nom et essayez à nouveau.` };
    const r = ping(N, d.id, m[1], { record: true }); d.seen['ping ' + m[1]] = r.ok;
    const ttl = 255 - (r.hops || 0);
    const lines = r.ok ? Array(4).fill(`Réponse de ${m[1]} : octets=32 temps<1ms TTL=${ttl}`) : Array(4).fill('Délai d\'attente de la demande dépassé.');
    return { out: `\nEnvoi d'une requête 'Ping'  ${m[1]} avec 32 octets de données :\n${lines.join('\n')}\n\nStatistiques Ping pour ${m[1]}:\n    Paquets : envoyés = 4, reçus = ${r.ok ? 4 : 0}, perdus = ${r.ok ? 0 : 4} (perte ${r.ok ? 0 : 100}%),` };
  }
  const c = /^curl\s+(?:https?:\/\/)?([0-9.]+)\/?$/.exec(tl);
  if (c) { if (ip2n(c[1]) == null) return { out: 'curl: (6) Could not resolve host: ' + c[1] }; const r = ping(N, d.id, c[1], { proto: 'tcp', dport: 80, record: true }); d.seen['curl ' + c[1]] = r.ok; return { out: r.ok ? '<html><body><h1>Serveur web TSSR</h1><p>La page s\'affiche : HTTP (TCP 80) passe.</p></body></html>' : 'curl: (28) Failed to connect to ' + c[1] + ' port 80: Timed out' }; }
  if (tl === 'help' || tl === '?') return { out: 'Commandes disponibles sur ce PC : ipconfig, ipconfig /renew, ipconfig /release, ping <IP>, curl http://<IP>, ssh -l <utilisateur> <IP>, telnet <IP>' };
  return { out: `'${t.split(/\s+/)[0]}' n'est pas reconnu en tant que commande interne\nou externe, un programme exécutable ou un fichier de commandes.` };
}

/* ---------- Réseaux de départ ---------- */
function mkNet(devs, links) { const N = { devs: {}, links: [] }; for (const d of devs) N.devs[d.id] = d; N.links = links.map(([a, ia, b, ib]) => [a, canon(N, a, ia), b, canon(N, b, ib)]); return N; }
function canon(N, dev, i) { if (N.devs[dev].kind === 'pc') return 'nic'; const p = parseIf(i); return p.base; }
function preset(N, dev, lines, save = true) { const d = N.devs[dev]; d.mode = 'priv'; for (const l of lines) { exec(N, dev, l); d.pend = null; } d.mode = 'user'; d.cur = null; d.seen = {}; if (save) d.startup = snap(d); }
const R = id => newDev('router', id), SW = id => newDev('switch', id);

return { ip2n, n2ip, parseIf, newDev, newPC, macOf, mkNet, preset, exec, prompt, helpFor, complete, ping, build, snap, saved, ifStatus, R, SW, CMD, match, fixup };
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
const ospfNet = (N, id, a, w, area) => { const o = dv(N, id).ospf; return !!o && o.nets.some(n => n.a === ip(a) && n.w === ip(w) && n.area === area); };
const rid = (N, id, r) => !!dv(N, id).ospf && dv(N, id).ospf.rid === ip(r);
const rules = (N, id, n) => (dv(N, id).acls[n] || { rules: [] }).rules.filter(r => r.remark == null);
const isHost = (a, x) => a && !a.any && a.w === 0 && a.ip === ip(x);
const curlOk = (N, from, to) => S.ping(N, from, to, { proto: 'tcp', dport: 80 }).ok;

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
 id: 'ospf', n: 8, niv: 4, titre: 'OSPF (une seule zone)',
 intro: "Les adresses sont déjà en place. Remplace le routage manuel par OSPF dans la zone 0, puis donne l'accès à Internet à tout le réseau.",
 topo: '   PC1 192.168.1.1 ─ [R1] ── 10.0.0.0/30 ── [R2] ── 10.0.0.4/30 ── [R3] ── 203.0.113.0/30 ── [FAI] Lo0 8.8.8.8\n              G0/0 .254  G0/1 .1          .2 G0/1  S0/0/0 .5    .6 S0/0/0  G0/1 .2           .1\n                                   R2 G0/0 : 192.168.2.254/24       R3 G0/0 : 192.168.3.254/24 ─ PC3 192.168.3.1\n   R3 a déjà une route par défaut vers le FAI (203.0.113.1).',
 devs: ['R1', 'R2', 'R3', 'FAI', 'PC1', 'PC3'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.R('R3'), S.R('FAI'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC3', '192.168.3.1', '255.255.255.0', '192.168.3.254')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['R2', 's0/0/0', 'R3', 's0/0/0'], ['PC3', '', 'R3', 'g0/0'], ['R3', 'g0/1', 'FAI', 'g0/1']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shut', 'end']);
  S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shut', 'int s0/0/0', 'ip address 10.0.0.5 255.255.255.252', 'clock rate 64000', 'no shut', 'int g0/0', 'ip address 192.168.2.254 255.255.255.0', 'no shut', 'end']);
  S.preset(N, 'R3', ['conf t', 'hostname R3', 'int s0/0/0', 'ip address 10.0.0.6 255.255.255.252', 'no shut', 'int g0/0', 'ip address 192.168.3.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 203.0.113.2 255.255.255.252', 'no shut', 'exit', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'end']);
  S.preset(N, 'FAI', ['conf t', 'hostname FAI', 'int g0/1', 'ip address 203.0.113.1 255.255.255.252', 'no shut', 'int loopback0', 'ip address 8.8.8.8 255.255.255.255', 'exit', 'ip route 192.168.0.0 255.255.0.0 203.0.113.2', 'ip route 10.0.0.0 255.0.0.0 203.0.113.2', 'end']); return N; },
 tasks: [
  ['Sur R1 : OSPF processus 1, router-id 1.1.1.1, annonce ses deux réseaux dans la zone 0.', 'router ospf 1\nrouter-id 1.1.1.1\nnetwork 192.168.1.0 0.0.0.255 area 0\nnetwork 10.0.0.0 0.0.0.3 area 0\n(le 2e nombre est un masque inversé : 255.255.255.252 → 0.0.0.3)', N => rid(N, 'R1', '1.1.1.1') && ospfNet(N, 'R1', '192.168.1.0', '0.0.0.255', 0) && ospfNet(N, 'R1', '10.0.0.0', '0.0.0.3', 0)],
  ['Sur R2 : router-id 2.2.2.2 et ses trois réseaux dans la zone 0.', 'router ospf 1\nrouter-id 2.2.2.2\nnetwork 10.0.0.0 0.0.0.3 area 0\nnetwork 10.0.0.4 0.0.0.3 area 0\nnetwork 192.168.2.0 0.0.0.255 area 0', N => rid(N, 'R2', '2.2.2.2') && ospfNet(N, 'R2', '10.0.0.0', '0.0.0.3', 0) && ospfNet(N, 'R2', '10.0.0.4', '0.0.0.3', 0) && ospfNet(N, 'R2', '192.168.2.0', '0.0.0.255', 0)],
  ['Sur R3 : router-id 3.3.3.3, annonce 10.0.0.4/30 et 192.168.3.0/24 (pas le lien vers le FAI).', 'router ospf 1\nrouter-id 3.3.3.3\nnetwork 10.0.0.4 0.0.0.3 area 0\nnetwork 192.168.3.0 0.0.0.255 area 0', N => rid(N, 'R3', '3.3.3.3') && ospfNet(N, 'R3', '10.0.0.4', '0.0.0.3', 0) && ospfNet(N, 'R3', '192.168.3.0', '0.0.0.255', 0)],
  ['Sur R2, vérifie qu\'il a deux voisins OSPF (état FULL).', 'do show ip ospf neighbor', N => !!dv(N, 'R2').seen['show ip ospf neighbor'] && (S.build(N).ospf.nb.R2 || []).length === 2],
  ['Sur R1, vérifie que 192.168.3.0 est appris par OSPF (lettre O).', 'do show ip route', N => !!dv(N, 'R1').seen['show ip route'] && S.build(N).rt.R1.some(r => r.code === 'O' && r.net === ip('192.168.3.0'))],
  ['Depuis PC1, pingue PC3.', 'Clique sur PC1 : ping 192.168.3.1', N => dv(N, 'PC1').seen['ping 192.168.3.1'] === true],
  ['Sur R1 et R3, rends l\'interface LAN (G0/0) passive : pas de voisin OSPF à chercher côté PC.', 'router ospf 1\npassive-interface g0/0', N => dv(N, 'R1').ospf && dv(N, 'R1').ospf.passive.includes('GigabitEthernet0/0') && dv(N, 'R3').ospf && dv(N, 'R3').ospf.passive.includes('GigabitEthernet0/0')],
  ['Sur R3, fais annoncer sa route par défaut par OSPF, puis pingue 8.8.8.8 depuis PC1.', 'Sur R3 : router ospf 1\ndefault-information originate\nPuis sur PC1 : ping 8.8.8.8\n(sur R1, la route apparaît en O*E2)', N => dv(N, 'R3').ospf && dv(N, 'R3').ospf.dio && dv(N, 'PC1').seen['ping 8.8.8.8'] === true],
  ['Sauvegarde R1, R2 et R3.', 'copy run start  (sur les trois)', N => allSaved(N, ['R1', 'R2', 'R3'])],
 ],
},
{
 id: 'acl', n: 9, niv: 4, titre: 'Listes de contrôle d\'accès (ACL)',
 intro: "PC2 ne doit plus joindre le serveur. PC1 doit garder le ping vers le serveur, mais plus son site web. Règle d'or : ACL standard près de la destination, ACL étendue près de la source.",
 topo: '   PC1 192.168.1.10 ─ Fa0/1 ┐\n                           ├ [SW1] G0/1 ── G0/0 [ R1 ] G0/1 ── SRV 192.168.2.100 (serveur web)\n   PC2 192.168.1.20 ─ Fa0/2 ┘          192.168.1.254    192.168.2.254',
 devs: ['R1', 'PC1', 'PC2', 'SRV'],
 make: () => { const N = S.mkNet([S.R('R1'), S.SW('SW1'), S.newPC('PC1', '192.168.1.10', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.1.20', '255.255.255.0', '192.168.1.254'), S.newPC('SRV', '192.168.2.100', '255.255.255.0', '192.168.2.254', true)], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['SRV', '', 'R1', 'g0/1']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 192.168.2.254 255.255.255.0', 'no shut', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Depuis PC2, pingue le serveur : pour l\'instant, tout passe.', 'Clique sur PC2 : ping 192.168.2.100', N => dv(N, 'PC2').seen['ping 192.168.2.100'] !== undefined],
  ['Sur R1, crée l\'ACL standard 10 : refuse l\'hôte 192.168.1.20, autorise tout le reste.', 'access-list 10 deny host 192.168.1.20\naccess-list 10 permit any\n(sans « permit any », le deny implicite bloquerait tout le monde)', N => { const r = rules(N, 'R1', '10'); return r.length >= 2 && r[0].act === 'deny' && isHost(r[0].src, '192.168.1.20') && r.some(x => x.act === 'permit' && x.src.any); }],
  ['Applique l\'ACL 10 en sortie de G0/1, près de la destination.', 'interface g0/1\nip access-group 10 out', N => I(N, 'R1', 'GigabitEthernet0/1').acout === '10'],
  ['Vérifie : PC2 ne joint plus le serveur, PC1 oui.', 'Sur PC2 : ping 192.168.2.100 (échec)\nSur PC1 : ping 192.168.2.100 (réussite)', N => dv(N, 'PC2').seen['ping 192.168.2.100'] === false && pingOk(N, 'PC1', '192.168.2.100')],
  ['Crée l\'ACL étendue 110 : refuse le web (TCP 80) de PC1 vers le serveur, autorise tout le reste.', 'access-list 110 deny tcp host 192.168.1.10 host 192.168.2.100 eq 80\naccess-list 110 permit ip any any', N => { const r = rules(N, 'R1', '110'); return r.some(x => x.act === 'deny' && x.proto === 'tcp' && isHost(x.src, '192.168.1.10') && isHost(x.dst, '192.168.2.100') && x.port === 80) && r.some(x => x.act === 'permit' && x.proto === 'ip' && x.src.any && x.dst.any); }],
  ['Applique l\'ACL 110 en entrée de G0/0, près de la source.', 'interface g0/0\nip access-group 110 in', N => I(N, 'R1', 'GigabitEthernet0/0').acin === '110'],
  ['Vérifie depuis PC1 : le site web est bloqué, le ping passe toujours.', 'Sur PC1 : curl http://192.168.2.100 (échec)\nping 192.168.2.100 (réussite)', N => dv(N, 'PC1').seen['curl 192.168.2.100'] === false && pingOk(N, 'PC1', '192.168.2.100') && !curlOk(N, 'PC1', '192.168.2.100')],
  ['Affiche tes ACL.', 'do show access-lists', N => !!dv(N, 'R1').seen['show access-lists']],
  ['Sauvegarde R1.', 'copy run start', N => S.saved(dv(N, 'R1'))],
 ],
},
{
 id: 'nat', n: 10, niv: 5, titre: 'NAT et PAT',
 intro: "Le LAN utilise des adresses privées : le FAI ne sait pas lui répondre. Mets en place la PAT pour les postes, puis une NAT statique pour publier le serveur web sur Internet.",
 topo: '   PC1 192.168.1.10  ─ Fa0/1 ┐\n   PC2 192.168.1.20  ─ Fa0/2 ├ [SW1] G0/1 ── G0/0 [ R1 ] G0/1 ──── G0/1 [ FAI ] G0/0 ── NET 198.51.100.10\n   SRV 192.168.1.100 ─ Fa0/3 ┘ (web)     inside .254   outside 203.0.113.2/24   .1   Lo0 8.8.8.8   .1  (PC sur Internet)\n   R1 a déjà une route par défaut vers le FAI. Le FAI ne connaît pas 192.168.1.0.',
 devs: ['R1', 'PC1', 'NET', 'FAI'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('FAI'), S.SW('SW1'), S.newPC('PC1', '192.168.1.10', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.1.20', '255.255.255.0', '192.168.1.254'), S.newPC('SRV', '192.168.1.100', '255.255.255.0', '192.168.1.254', true), S.newPC('NET', '198.51.100.10', '255.255.255.0', '198.51.100.1')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SRV', '', 'SW1', 'f0/3'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['R1', 'g0/1', 'FAI', 'g0/1'], ['NET', '', 'FAI', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 203.0.113.2 255.255.255.0', 'no shut', 'exit', 'ip route 0.0.0.0 0.0.0.0 203.0.113.1', 'end']);
  S.preset(N, 'FAI', ['conf t', 'hostname FAI', 'int g0/1', 'ip address 203.0.113.1 255.255.255.0', 'no shut', 'int g0/0', 'ip address 198.51.100.1 255.255.255.0', 'no shut', 'int loopback0', 'ip address 8.8.8.8 255.255.255.255', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Depuis PC1, pingue 8.8.8.8 : ça échoue. Le FAI ne sait pas répondre à une adresse privée.', 'Clique sur PC1 : ping 8.8.8.8', N => dv(N, 'PC1').seen['ping 8.8.8.8'] !== undefined],
  ['Sur R1, déclare G0/0 côté réseau local (inside) et G0/1 côté Internet (outside).', 'interface g0/0\nip nat inside\ninterface g0/1\nip nat outside', N => I(N, 'R1', 'GigabitEthernet0/0').nat === 'inside' && I(N, 'R1', 'GigabitEthernet0/1').nat === 'outside'],
  ['Crée l\'ACL 1 qui désigne les adresses à traduire : 192.168.1.0/24.', 'access-list 1 permit 192.168.1.0 0.0.0.255', N => rules(N, 'R1', '1').some(r => r.act === 'permit' && !r.src.any && r.src.ip === ip('192.168.1.0') && r.src.w === ip('0.0.0.255'))],
  ['Active la PAT : tous les postes sortent avec l\'adresse de G0/1.', 'ip nat inside source list 1 interface g0/1 overload', N => dv(N, 'R1').nat.dyn.some(r => r.acl === '1' && r.ifn === 'GigabitEthernet0/1' && r.overload)],
  ['Depuis PC1, pingue 8.8.8.8 : cette fois, ça marche.', 'Clique sur PC1 : ping 8.8.8.8', N => dv(N, 'PC1').seen['ping 8.8.8.8'] === true],
  ['Sur R1, regarde la table des traductions.', 'show ip nat translations\n(Inside local = 192.168.1.10, Inside global = 203.0.113.2)', N => !!dv(N, 'R1').seen['show ip nat translations']],
  ['Publie le serveur web : NAT statique de 192.168.1.100 vers 203.0.113.10.', 'ip nat inside source static 192.168.1.100 203.0.113.10', N => dv(N, 'R1').nat.statics.some(x => !x.proto && x.local === ip('192.168.1.100') && x.global === ip('203.0.113.10'))],
  ['Depuis le PC sur Internet (NET), ouvre le site : curl http://203.0.113.10', 'Clique sur NET : curl http://203.0.113.10', N => dv(N, 'NET').seen['curl 203.0.113.10'] === true],
  ['Sauvegarde R1.', 'copy run start', N => S.saved(dv(N, 'R1'))],
 ],
},
{
 id: 'dhcp', n: 11, niv: 4, titre: 'Serveur DHCP et relais',
 intro: "Les PC n'ont pas d'adresse : ils attendent un serveur DHCP. R1 sera le serveur pour les deux réseaux. R2 relaiera les demandes de son réseau vers R1 (un broadcast DHCP ne traverse pas un routeur).",
 topo: '   PC1 (DHCP) ─ Fa0/1 ┐\n                      ├ [SW1] G0/1 ── G0/0 [ R1 ] G0/1 ── 10.0.0.0/30 ── G0/1 [ R2 ] G0/0 ── PC3 (DHCP)\n   PC2 (DHCP) ─ Fa0/2 ┘          192.168.10.254   .1                .2   192.168.20.254\n   Les routes statiques entre R1 et R2 sont déjà en place. DNS à distribuer : 8.8.8.8',
 devs: ['R1', 'R2', 'PC1', 'PC2', 'PC3'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.SW('SW1'), S.newPC('PC1'), S.newPC('PC2'), S.newPC('PC3')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC3', '', 'R2', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.10.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shut', 'exit', 'ip route 192.168.20.0 255.255.255.0 10.0.0.2', 'end']);
  S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/0', 'ip address 192.168.20.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shut', 'exit', 'ip route 192.168.10.0 255.255.255.0 10.0.0.1', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Sur PC1, demande une adresse : ipconfig /renew. Sans serveur, il prend une adresse APIPA en 169.254.x.x.', 'Clique sur PC1 : ipconfig /renew', N => !!dv(N, 'PC1').seen['ipconfig /renew']],
  ['Sur R1, exclus les adresses 192.168.10.1 à 192.168.10.10 (réservées aux serveurs et imprimantes).', 'ip dhcp excluded-address 192.168.10.1 192.168.10.10', N => dv(N, 'R1').dhcp.excl.some(([a, b]) => a === ip('192.168.10.1') && b === ip('192.168.10.10'))],
  ['Crée le pool LAN10 : réseau 192.168.10.0/24, passerelle 192.168.10.254, DNS 8.8.8.8.', 'ip dhcp pool LAN10\nnetwork 192.168.10.0 255.255.255.0\ndefault-router 192.168.10.254\ndns-server 8.8.8.8', N => Object.values(dv(N, 'R1').dhcp.pools).some(p => p.net === ip('192.168.10.0') && p.mask === ip('255.255.255.0') && p.gw === ip('192.168.10.254') && p.dns === ip('8.8.8.8'))],
  ['Sur PC1, refais ipconfig /renew : il doit recevoir 192.168.10.11 (la première adresse libre).', 'Clique sur PC1 : ipconfig /renew', N => dv(N, 'PC1').dhcpSrv === 'R1' && dv(N, 'PC1').ip === ip('192.168.10.11')],
  ['Sur R1, affiche les baux distribués.', 'show ip dhcp binding  (en mode privilégié, ou « do » devant en configuration)', N => !!dv(N, 'R1').seen['show ip dhcp binding']],
  ['Sur R1, crée le pool LAN20 pour le réseau de R2 : 192.168.20.0/24, passerelle 192.168.20.254, DNS 8.8.8.8.', 'ip dhcp pool LAN20\nnetwork 192.168.20.0 255.255.255.0\ndefault-router 192.168.20.254\ndns-server 8.8.8.8', N => Object.values(dv(N, 'R1').dhcp.pools).some(p => p.net === ip('192.168.20.0') && p.gw === ip('192.168.20.254'))],
  ['Sur PC3, ipconfig /renew : échec. Sur R2, active le relais DHCP sur G0/0 vers R1.', 'interface g0/0\nip helper-address 10.0.0.1\n(le relais transforme le broadcast en unicast vers le serveur)', N => I(N, 'R2', 'GigabitEthernet0/0').helper === ip('10.0.0.1')],
  ['Sur PC3, ipconfig /renew : il reçoit une adresse en 192.168.20.x. Puis pingue PC1 depuis PC3.', 'Sur PC3 : ipconfig /renew\nping 192.168.10.11', N => dv(N, 'PC3').dhcpSrv === 'R1' && dv(N, 'PC1').ip != null && dv(N, 'PC3').seen['ping ' + S.n2ip(dv(N, 'PC1').ip)] === true],
  ['Sauvegarde R1 et R2.', 'copy run start  (sur les deux)', N => allSaved(N, ['R1', 'R2'])],
 ],
},
{
 id: 'secu', n: 12, niv: 5, titre: 'SSH et sécurisation du switch',
 intro: "Administre R1 à distance en SSH seulement, depuis le poste de l'admin (PC1). Puis sécurise SW1 : ports inutilisés coupés, sécurité des ports et protection contre les switchs pirates.",
 topo: '   PC1 192.168.1.10 (admin) ─ Fa0/1 ┐\n                                    ├ [SW1] G0/1 ── G0/0 [ R1 ] 192.168.1.254\n   PC2 192.168.1.20         ─ Fa0/2 ┘',
 devs: ['R1', 'SW1', 'PC1', 'PC2'],
 make: () => { const N = S.mkNet([S.R('R1'), S.SW('SW1'), S.newPC('PC1', '192.168.1.10', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.1.20', '255.255.255.0', '192.168.1.254')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SW1', 'g0/1', 'R1', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Sur R1, définis le domaine tssr.lan et un compte local admin (mot de passe chiffré : Cisco123).', 'ip domain-name tssr.lan\nusername admin secret Cisco123', N => dv(N, 'R1').dom === 'tssr.lan' && !!dv(N, 'R1').users.admin && dv(N, 'R1').users.admin.secret],
  ['Génère les clés RSA (1024 bits) et active SSH version 2.', 'crypto key generate rsa\n1024   (à la question du nombre de bits)\nip ssh version 2', N => dv(N, 'R1').rsa >= 768 && dv(N, 'R1').ssh.v === 2],
  ['Sur les lignes VTY 0 à 4 : authentification par les comptes locaux, SSH uniquement.', 'line vty 0 4\nlogin local\ntransport input ssh', N => dv(N, 'R1').vty.login === 'local' && dv(N, 'R1').vty.transport === 'ssh'],
  ['Depuis PC1, connecte-toi en SSH à R1, puis tape show users et exit.', 'Clique sur PC1 : ssh -l admin 192.168.1.254\nmot de passe : Cisco123\nenable\nshow users\nexit', N => !!dv(N, 'R1').seen.sshLogin && !!dv(N, 'R1').seen['show users']],
  ['Depuis PC2, essaie telnet 192.168.1.254 : refusé, seul SSH est permis.', 'Clique sur PC2 : telnet 192.168.1.254', N => !!dv(N, 'PC2').seen['telnet 192.168.1.254'] && dv(N, 'R1').vty.transport === 'ssh'],
  ['Limite l\'accès distant au seul PC1 : ACL 5 et access-class sur les lignes VTY.', 'access-list 5 permit host 192.168.1.10\nline vty 0 4\naccess-class 5 in', N => dv(N, 'R1').vty.acl === '5' && rules(N, 'R1', '5').some(r => r.act === 'permit' && isHost(r.src, '192.168.1.10'))],
  ['Sur SW1, coupe les ports inutilisés Fa0/3 à Fa0/24.', 'interface range fa0/3 - 24\nshutdown', N => { const d = dv(N, 'SW1'); for (let k = 3; k <= 24; k++) { const i = d.ifs['FastEthernet0/' + k]; if (!i || !i.shut) return false; } return true; }],
  ['Sur Fa0/1 et Fa0/2 : mode accès, port-security (1 adresse MAC apprise en sticky, violation shutdown).', 'interface range fa0/1 - 2\nswitchport mode access\nswitchport port-security\nswitchport port-security maximum 1\nswitchport port-security mac-address sticky\nswitchport port-security violation shutdown', N => ['FastEthernet0/1', 'FastEthernet0/2'].every(n => { const p = I(N, 'SW1', n).ps; return p && p.on && p.sticky && p.max === 1 && p.viol === 'shutdown' && p.macs.length === 1; })],
  ['Sur ces deux ports, active portfast et BPDU Guard (un switch branché à la place d\'un PC coupera le port).', 'interface range fa0/1 - 2\nspanning-tree portfast\nspanning-tree bpduguard enable', N => ['FastEthernet0/1', 'FastEthernet0/2'].every(n => I(N, 'SW1', n).portfast && I(N, 'SW1', n).bpdug)],
  ['Vérifie sur SW1 : show port-security et show mac address-table.', 'show port-security\nshow mac address-table  (les adresses sticky sont STATIC)', N => !!dv(N, 'SW1').seen['show port-security'] && !!dv(N, 'SW1').seen['show mac address-table']],
  ['Sauvegarde R1 et SW1.', 'copy run start  (sur les deux)', N => allSaved(N, ['R1', 'SW1'])],
 ],
},
{
 id: 'dep1', n: 13, niv: 4, titre: 'Dépannage : PC1 ne joint plus PC2',
 intro: "Panne signalée : « PC1 n'arrive plus à joindre PC2 depuis ce matin. » Le réseau était configuré (routage statique). Trouve les 2 pannes, sans tout reconfigurer : observe d'abord, corrige ensuite.",
 topo: '   PC1 192.168.1.1 ── G0/0 [ R1 ] G0/1 ──── 10.0.0.0/8 ──── G0/1 [ R2 ] G0/0 ── PC2 192.168.2.1\n                       .254        .1                       .2          .254',
 devs: ['R1', 'R2', 'PC1', 'PC2'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.2.1', '255.255.255.0', '192.168.2.254')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC2', '', 'R2', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.1 255.0.0.0', 'shutdown', 'exit', 'ip route 192.168.2.0 255.255.255.0 10.0.0.2', 'end']);
  S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/0', 'ip address 192.168.2.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.2 255.0.0.0', 'no shut', 'exit', 'ip route 192.168.1.0 255.255.255.0 10.0.0.3', 'end']); return N; },
 tasks: [
  ['Constate la panne : depuis PC1, pingue PC2.', 'Clique sur PC1 : ping 192.168.2.1 (échec)', N => dv(N, 'PC1').seen['ping 192.168.2.1'] !== undefined],
  ['Sur R1, vérifie l\'état des interfaces.', 'show ip interface brief\n→ G0/1 est « administratively down »', N => !!dv(N, 'R1').seen['show ip interface brief']],
  ['Corrige la 1re panne sur R1.', 'Solution : interface g0/1\nno shutdown', N => !I(N, 'R1', 'GigabitEthernet0/1').shut],
  ['Depuis R1, pingue R2 (10.0.0.2), puis regarde la table de routage de R2.', 'ping 10.0.0.2 sur R1 (réussite)\nshow ip route sur R2\n→ la route vers 192.168.1.0 passe par 10.0.0.3, qui n\'existe pas', N => !!dv(N, 'R1').seen['ping 10.0.0.2'] && !!dv(N, 'R2').seen['show ip route']],
  ['Corrige la 2e panne sur R2 : la route de retour.', 'Solution :\nno ip route 192.168.1.0 255.255.255.0 10.0.0.3\nip route 192.168.1.0 255.255.255.0 10.0.0.1', N => route(N, 'R2', '192.168.1.0', '255.255.255.0', '10.0.0.1') && !route(N, 'R2', '192.168.1.0', '255.255.255.0', '10.0.0.3')],
  ['Vérifie : PC1 joint PC2.', 'Clique sur PC1 : ping 192.168.2.1', N => dv(N, 'PC1').seen['ping 192.168.2.1'] === true],
  ['Sauvegarde les deux routeurs.', 'copy run start  (sur R1 et sur R2)', N => allSaved(N, ['R1', 'R2']) && !I(N, 'R1', 'GigabitEthernet0/1').shut && route(N, 'R2', '192.168.1.0', '255.255.255.0', '10.0.0.1')],
 ],
},
{
 id: 'dep2', n: 14, niv: 4, titre: 'Dépannage : VLAN coupé entre deux switchs',
 intro: "Panne signalée : « PC1 et PC3 sont tous les deux au service COMPTA (VLAN 10) mais ne se voient pas. » Les VLAN et le trunk existent déjà. Trouve les 2 erreurs de configuration.",
 topo: '   PC1 V10 192.168.10.1 ─ Fa0/1 [ SW1 ] G0/1 ═══ trunk ═══ G0/1 [ SW2 ] Fa0/1 ─ PC3 V10 192.168.10.3\n   PC2 V20 192.168.20.1 ─ Fa0/2                                   Fa0/2 ─ PC4 V20 192.168.20.3',
 devs: ['SW1', 'SW2', 'PC1', 'PC3', 'PC2', 'PC4'],
 make: () => { const N = S.mkNet([S.SW('SW1'), S.SW('SW2'), S.newPC('PC1', '192.168.10.1', '255.255.255.0'), S.newPC('PC2', '192.168.20.1', '255.255.255.0'), S.newPC('PC3', '192.168.10.3', '255.255.255.0'), S.newPC('PC4', '192.168.20.3', '255.255.255.0')], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['PC3', '', 'SW2', 'f0/1'], ['PC4', '', 'SW2', 'f0/2'], ['SW1', 'g0/1', 'SW2', 'g0/1']]);
  const base = s => ['conf t', 'hostname ' + s, 'vlan 10', 'name COMPTA', 'vlan 20', 'name RH', 'int f0/1', 'switchport mode access', 'switchport access vlan 10', 'int f0/2', 'switchport mode access', 'switchport access vlan 20', 'int g0/1', 'switchport mode trunk'];
  S.preset(N, 'SW1', [...base('SW1'), 'switchport trunk allowed vlan 20', 'end']);
  S.preset(N, 'SW2', [...base('SW2'), 'int f0/1', 'switchport access vlan 20', 'end']); return N; },
 tasks: [
  ['Constate la panne : PC1 ne joint pas PC3, mais PC2 joint PC4.', 'Sur PC1 : ping 192.168.10.3 (échec)\nSur PC2 : ping 192.168.20.3 (réussite) → le trunk fonctionne, mais pas pour le VLAN 10', N => dv(N, 'PC1').seen['ping 192.168.10.3'] !== undefined && dv(N, 'PC2').seen['ping 192.168.20.3'] !== undefined],
  ['Sur SW2, vérifie dans quel VLAN est le port de PC3.', 'show vlan brief\n→ Fa0/1 est dans le VLAN 20 au lieu du 10', N => !!dv(N, 'SW2').seen['show vlan brief']],
  ['Corrige le port de PC3 sur SW2.', 'Solution : interface f0/1\nswitchport access vlan 10', N => access(N, 'SW2', 'FastEthernet0/1', 10)],
  ['Vérifie les trunks : quels VLAN sont autorisés ?', 'show interfaces trunk  (sur SW1)\n→ seul le VLAN 20 est autorisé', N => !!dv(N, 'SW1').seen['show interfaces trunk']],
  ['Autorise le VLAN 10 sur le trunk de SW1, sans retirer le 20.', 'Solution : interface g0/1\nswitchport trunk allowed vlan add 10\n(ou switchport trunk allowed vlan 10,20)', N => { const a = I(N, 'SW1', 'GigabitEthernet0/1').allowed; return trunk(N, 'SW1', 'GigabitEthernet0/1') && (a == null || (a.includes(10) && a.includes(20))); }],
  ['Vérifie : PC1 joint PC3, et PC2 joint toujours PC4.', 'Sur PC1 : ping 192.168.10.3\nSur PC2 : ping 192.168.20.3', N => pingOk(N, 'PC1', '192.168.10.3') && pingOk(N, 'PC2', '192.168.20.3') && dv(N, 'PC1').seen['ping 192.168.10.3'] === true],
  ['Sauvegarde les deux switchs.', 'copy run start  (sur SW1 et sur SW2)', N => allSaved(N, ['SW1', 'SW2']) && access(N, 'SW2', 'FastEthernet0/1', 10)],
 ],
},
{
 id: 'dep3', n: 15, niv: 5, titre: 'Dépannage : pas d\'adresse DHCP',
 intro: "Panne signalée : « PC3 n'a pas d'adresse, et quand il en avait une, il ne sortait pas de son réseau. » R1 est le serveur DHCP des deux réseaux ; R2 relaie. Trouve les 2 erreurs.",
 topo: '   PC1 192.168.10.10 (fixe) ─ G0/0 [ R1 ] G0/1 ── 10.0.0.0/30 ── G0/1 [ R2 ] G0/0 ── PC3 (DHCP)\n                       192.168.10.254   .1                .2   192.168.20.254\n   R1 : pools DHCP LAN10 et LAN20. R2 : relais DHCP sur G0/0.',
 devs: ['R1', 'R2', 'PC3', 'PC1'],
 make: () => { const N = S.mkNet([S.R('R1'), S.R('R2'), S.newPC('PC1', '192.168.10.10', '255.255.255.0', '192.168.10.254'), S.newPC('PC3')], [['PC1', '', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC3', '', 'R2', 'g0/0']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.10.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 10.0.0.1 255.255.255.252', 'no shut', 'exit', 'ip route 192.168.20.0 255.255.255.0 10.0.0.2', 'ip dhcp excluded-address 192.168.10.1 192.168.10.10', 'ip dhcp excluded-address 192.168.20.250 192.168.20.254', 'ip dhcp pool LAN10', 'network 192.168.10.0 255.255.255.0', 'default-router 192.168.10.254', 'dns-server 8.8.8.8', 'exit', 'ip dhcp pool LAN20', 'network 192.168.20.0 255.255.255.0', 'default-router 192.168.20.1', 'dns-server 8.8.8.8', 'end']);
  S.preset(N, 'R2', ['conf t', 'hostname R2', 'int g0/0', 'ip address 192.168.20.254 255.255.255.0', 'ip helper-address 10.0.0.9', 'no shut', 'int g0/1', 'ip address 10.0.0.2 255.255.255.252', 'no shut', 'exit', 'ip route 192.168.10.0 255.255.255.0 10.0.0.1', 'end']); return N; },
 tasks: [
  ['Constate la panne : sur PC3, ipconfig /renew donne une adresse APIPA (169.254.x.x).', 'Clique sur PC3 : ipconfig /renew', N => !!dv(N, 'PC3').seen['ipconfig /renew']],
  ['Sur R2, regarde la configuration de l\'interface G0/0.', 'show running-config\n→ ip helper-address 10.0.0.9 : ce n\'est pas l\'adresse de R1', N => !!dv(N, 'R2').seen['show running-config']],
  ['Corrige le relais DHCP sur R2.', 'Solution : interface g0/0\nno ip helper-address\nip helper-address 10.0.0.1', N => I(N, 'R2', 'GigabitEthernet0/0').helper === ip('10.0.0.1')],
  ['Sur PC3, renouvelle l\'adresse, puis pingue PC1 : ça échoue encore. Regarde la passerelle reçue.', 'ipconfig /renew\nping 192.168.10.10 (échec)\nipconfig → passerelle 192.168.20.1 : ce n\'est pas R2 (192.168.20.254)', N => dv(N, 'PC3').dhcpSrv === 'R1' && dv(N, 'PC3').seen['ping 192.168.10.10'] !== undefined],
  ['Sur R1, corrige la passerelle distribuée par le pool LAN20.', 'Solution : ip dhcp pool LAN20\ndefault-router 192.168.20.254', N => Object.values(dv(N, 'R1').dhcp.pools).some(p => p.net === ip('192.168.20.0') && p.gw === ip('192.168.20.254'))],
  ['Sur PC3, renouvelle l\'adresse et pingue PC1.', 'ipconfig /renew\nping 192.168.10.10', N => dv(N, 'PC3').gw === ip('192.168.20.254') && dv(N, 'PC3').seen['ping 192.168.10.10'] === true],
  ['Sauvegarde R1 et R2.', 'copy run start  (sur les deux)', N => allSaved(N, ['R1', 'R2']) && I(N, 'R2', 'GigabitEthernet0/0').helper === ip('10.0.0.1')],
 ],
},
{
 id: 'dep4', n: 16, niv: 5, titre: 'Dépannage : plus personne n\'accède au serveur',
 intro: "Panne signalée : « Depuis qu'un collègue a ajouté une ACL pour bloquer PC2, plus personne n'accède au serveur. » PC2 doit rester bloqué, PC1 doit retrouver l'accès.",
 topo: '   PC1 192.168.1.10 ─ Fa0/1 ┐\n                           ├ [SW1] G0/1 ── G0/0 [ R1 ] G0/1 ── SRV 192.168.2.100 (serveur web)\n   PC2 192.168.1.20 ─ Fa0/2 ┘          192.168.1.254    192.168.2.254',
 devs: ['R1', 'PC1', 'PC2', 'SRV'],
 make: () => { const N = S.mkNet([S.R('R1'), S.SW('SW1'), S.newPC('PC1', '192.168.1.10', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.1.20', '255.255.255.0', '192.168.1.254'), S.newPC('SRV', '192.168.2.100', '255.255.255.0', '192.168.2.254', true)], [['PC1', '', 'SW1', 'f0/1'], ['PC2', '', 'SW1', 'f0/2'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['SRV', '', 'R1', 'g0/1']]);
  S.preset(N, 'R1', ['conf t', 'hostname R1', 'int g0/0', 'ip address 192.168.1.254 255.255.255.0', 'no shut', 'int g0/1', 'ip address 192.168.2.254 255.255.255.0', 'ip access-group 10 out', 'no shut', 'exit', 'access-list 10 deny host 192.168.1.20', 'end']); S.preset(N, 'SW1', ['conf t', 'hostname SW1', 'end']); return N; },
 tasks: [
  ['Constate la panne : PC1 ne joint plus le serveur.', 'Clique sur PC1 : ping 192.168.2.100 (échec)', N => dv(N, 'PC1').seen['ping 192.168.2.100'] !== undefined],
  ['Sur R1, affiche les ACL.', 'show access-lists\n→ une seule règle « deny » : à la fin de chaque ACL, un « deny any » implicite bloque tout le reste', N => !!dv(N, 'R1').seen['show access-lists']],
  ['Corrige l\'ACL 10 sans retirer la règle qui bloque PC2.', 'Solution : access-list 10 permit any\n(elle s\'ajoute après le deny)', N => { const r = rules(N, 'R1', '10'); return r.length >= 2 && r[0].act === 'deny' && isHost(r[0].src, '192.168.1.20') && r.some(x => x.act === 'permit' && x.src.any); }],
  ['Vérifie : PC1 joint le serveur et ouvre le site web ; PC2 reste bloqué.', 'Sur PC1 : ping 192.168.2.100 et curl http://192.168.2.100\nSur PC2 : ping 192.168.2.100 (échec)', N => dv(N, 'PC1').seen['ping 192.168.2.100'] === true && dv(N, 'PC1').seen['curl 192.168.2.100'] === true && dv(N, 'PC2').seen['ping 192.168.2.100'] === false],
  ['Sauvegarde R1.', 'copy run start', N => S.saved(dv(N, 'R1')) && rules(N, 'R1', '10').some(x => x.act === 'permit' && x.src.any)],
 ],
},
{
 id: 'libre', n: 17, niv: 0, titre: 'Bac à sable',
 intro: "Aucune consigne : entraîne-toi librement. Tout est vierge.",
 topo: '   PC1 192.168.1.1/24 (passerelle .254) ─ Fa0/1 [ SW1 ] G0/1 ─ G0/0 [ R1 ] G0/1 ─ G0/1 [ R2 ] G0/0 ─ PC2 192.168.2.1/24 (passerelle .254)',
 devs: ['R1', 'R2', 'SW1', 'PC1', 'PC2'],
 make: () => S.mkNet([S.R('R1'), S.R('R2'), S.SW('SW1'), S.newPC('PC1', '192.168.1.1', '255.255.255.0', '192.168.1.254'), S.newPC('PC2', '192.168.2.1', '255.255.255.0', '192.168.2.254')], [['PC1', '', 'SW1', 'f0/1'], ['SW1', 'g0/1', 'R1', 'g0/0'], ['R1', 'g0/1', 'R2', 'g0/1'], ['PC2', '', 'R2', 'g0/0']]),
 tasks: [],
},
];
// La tâche finale « Sauvegarde » ne compte que si toutes les autres tâches sont réussies
// (sinon elle paraîtrait validée dès le départ : la configuration de départ est déjà sauvegardée).
for (const L of LABS) { const T = L.tasks, last = T[T.length - 1]; if (last && /copy run start/.test(last[1])) { const ok = last[2], prev = T.slice(0, -1); last[2] = N => ok(N) && prev.every(t => { try { return !!t[2](N); } catch (e) { return false; } }); } }
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
    if (d.kind === 'pc') return `${d.id} : invite de commandes Windows.\nCommandes : ipconfig, ipconfig /renew, ping <IP>, curl http://<IP>, ssh -l <utilisateur> <IP>, telnet <IP>. Tape help pour la liste.\n`;
    return `${d.id} (${d.kind === 'router' ? 'routeur Cisco 1941' : 'switch Cisco 2960'}) : connexion console.\nAide : « ? » liste les commandes, Tab complète, ↑ ↓ rappellent l'historique.\n\nPress RETURN to get started!\n`;
  }
  function loadLab(id, fresh) {
    lab = LABS.find(l => l.id === id) || LABS[0]; ST.cur = lab.id;
    const s = !fresh && ST.labs[lab.id] && ST.labs[lab.id].net;
    N = null; if (s) { try { N = JSON.parse(s); } catch (e) { N = null; } }
    if (!N) N = lab.make(); else { try { S.fixup(N); } catch (e) { N = lab.make(); } }
    for (const d of Object.values(N.devs)) d.pend = null;
    outs = {}; hpos = {}; showAll = false; armReset = false;
    dev = lab.devs[0]; renderLabs(); renderBrief(); renderDevs(); showDev(dev); check(); save();
  }
  function renderLabs() {
    const ok = LABS.filter(l => ST.labs[l.id] && ST.labs[l.id].done).length;
    q('#ciCount').textContent = `${ok}/${LABS.filter(l => l.tasks.length).length} labs réussis`;
    q('#ciLabs').innerHTML = LABS.map(l => { const s = ST.labs[l.id] || {}, cur = l.id === lab.id;
      const etat = !l.tasks.length ? 'Terminal libre, sans tâche' : s.done ? '✓ Réussi' : s.n ? `${s.n}/${l.tasks.length} tâches faites` : 'Pas encore fait';
      return `<button class="sc" data-v="${l.id}"${cur ? ' aria-current="true"' : ''}><span class="tag">Lab ${l.n}${l.niv ? ' · niveau ' + l.niv : ''}${cur ? ' · dernier ouvert' : ''}</span><b>${esc(l.titre)}</b><small>${etat}</small></button>`; }).join('');
    qa('#ciLabs .sc').forEach(b => b.onclick = () => { if (b.dataset.v !== lab.id) loadLab(b.dataset.v); openLab(); });
  }
  function openLab() { q('#ciPick').hidden = true; q('#ciView').hidden = false; window.scrollTo({ top: 0 }); paint(); if (matchMedia('(pointer:fine)').matches) inp.focus(); }
  q('#ciBack').onclick = () => { renderLabs(); q('#ciView').hidden = true; q('#ciPick').hidden = false; window.scrollTo({ top: 0 }); };
  q('#ciPick').addEventListener('labs', renderLabs);

  // Tâche en cours (affichée seule au-dessus du terminal sur téléphone)
  let curF = -2, curN = null, full = false;
  function curReset() { curF = -2; curN = null; full = !lab.tasks.length; q('#ciView').classList.toggle('full', full); q('#ciAll').textContent = 'Voir toutes les tâches et le schéma'; }
  function curTask() {
    const box = q('#ciCur'); if (!lab.tasks.length) { box.hidden = true; return; } box.hidden = false;
    const res = qa('#ciTasks li[data-i]').map(li => li.classList.contains('ok')), f = res.indexOf(false), n = res.filter(Boolean).length;
    const gained = curN != null && n > curN; curN = n;
    q('#ciCurE').textContent = `Lab ${lab.n} · ` + (f < 0 ? 'terminé' : `tâche ${f + 1}/${res.length}`) + (gained ? ' · ✓ tâche validée' : '');
    if (f === curF) return; curF = f;
    q('#ciCurT').textContent = f < 0 ? '✓ Lab réussi : toutes les tâches sont validées.' : lab.tasks[f][0];
    q('#ciCurH').hidden = f < 0; q('#ciCurH').textContent = 'Indice'; q('#ciCurP').hidden = true; q('#ciCurP').textContent = f < 0 ? '' : lab.tasks[f][1];
  }
  q('#ciCurH').onclick = () => { const h = q('#ciCurP'); h.hidden = !h.hidden; q('#ciCurH').textContent = h.hidden ? 'Indice' : 'Cacher l\'indice'; };
  q('#ciAll').onclick = () => { full = !full; q('#ciView').classList.toggle('full', full); q('#ciAll').textContent = full ? 'Masquer le détail' : 'Voir toutes les tâches et le schéma'; };
  // Clavier ouvert sur téléphone : garder la ligne de saisie visible.
  inp.addEventListener('focus', () => { if (innerWidth < 1024) setTimeout(() => inp.scrollIntoView({ block: 'center', behavior: 'smooth' }), 350); });
  function renderBrief() {
    curReset();
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
  function eff() { const d = N.devs[dev]; return (d.kind === 'pc' && d.remote && !d.pend && N.devs[d.remote]) || d; }
  function paint() {
    const d = eff(); const pr = S.prompt(N.devs[dev], N);
    out.textContent = outs[dev]; ps.textContent = pr;
    inp.type = d.pend && d.pend.secret ? 'password' : 'text';
    out.scrollTop = out.scrollHeight;
  }
  function write(s) { outs[dev] += s; const L = outs[dev].split('\n'); if (L.length > 600) outs[dev] = L.slice(-600).join('\n'); }
  function check() {
    if (!lab.tasks.length) { q('#ciProg').textContent = ''; curTask(); return; }
    let n = 0;
    lab.tasks.forEach(([, , ok], i) => { let r = false; try { r = !!ok(N); } catch (e) { } if (r) n++; const li = q(`#ciTasks li[data-i="${i}"]`); li.classList.toggle('ok', r); li.querySelector('.mk').textContent = r ? '✓' : '○'; });
    const all = n === lab.tasks.length;
    q('#ciProg').textContent = `${n}/${lab.tasks.length} tâches` + (all ? ' · Lab réussi ✓' : '');
    ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { n });
    q('#ciDone').hidden = !all; curTask();
    if (all && !(ST.labs[lab.id] && ST.labs[lab.id].done)) { ST.labs[lab.id] = Object.assign(ST.labs[lab.id] || {}, { done: true }); renderLabs(); }
  }
  function run(raw) {
    const d = N.devs[dev]; const e = eff(); const pr = S.prompt(d, N); const secret = (d.pend && d.pend.secret) || (e.pend && e.pend.secret);
    write(pr + (secret ? '' : raw) + '\n');
    if (raw.trim() && !secret && d.kind !== 'pc') { d.hist = (d.hist || []).concat(raw).slice(-50); }
    if (raw.trim() && !secret && d.kind === 'pc') { d.hist = (d.hist || []).concat(raw).slice(-50); }
    hpos[dev] = (d.hist || []).length;
    const r = S.exec(N, dev, raw);
    if (r.out) write(r.out.replace(/\n?$/, '\n'));
    inp.value = r.keep != null ? r.keep : '';
    paint(); check(); save();
  }
  function help() { const d = eff(); if (d.kind === 'pc') { run('help'); return; } const v = inp.value.replace(/\?$/, ''); write(S.prompt(N.devs[dev], N) + v + '?\n'); const r = S.exec(N, dev, v + '?'); if (r.out) write(r.out + '\n'); inp.value = v; paint(); }
  inp.addEventListener('keydown', e => {
    const d = eff();
    if (e.key === 'Enter') { e.preventDefault(); run(inp.value); return; }
    if (e.key === 'Tab') { e.preventDefault(); if (d.kind !== 'pc' && !(d.pend)) inp.value = S.complete(d, inp.value); return; }
    if (e.key === '?' && d.kind !== 'pc' && !d.pend) { e.preventDefault(); help(); return; }
    if ((e.key === 'z' || e.key === 'Z') && e.ctrlKey) { e.preventDefault(); inp.value = ''; run('^Z'); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); const h = d.hist || []; let p = hpos[dev] == null ? h.length : hpos[dev]; p = Math.max(0, Math.min(h.length, p + (e.key === 'ArrowUp' ? -1 : 1))); hpos[dev] = p; inp.value = h[p] || ''; }
  });
  inp.addEventListener('input', () => { const d = eff(); if (inp.value.endsWith('?') && d.kind !== 'pc' && !d.pend) help(); });
  out.addEventListener('click', () => { if (!getSelection().toString()) inp.focus(); });
  q('#ciTab').onclick = () => { const d = eff(); if (d.kind !== 'pc') inp.value = S.complete(d, inp.value); inp.focus(); };
  q('#ciHelp').onclick = () => { help(); inp.focus(); };
  q('#ciUp').onclick = () => { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp' })); inp.focus(); };
  q('#ciCtz').onclick = () => { run('^Z'); inp.focus(); };
  q('#ciClr').onclick = () => { outs[dev] = ''; paint(); inp.focus(); };
  q('#ciSol').onclick = () => { showAll = !showAll; qa('#ciTasks .hint').forEach(p => p.hidden = !showAll); qa('#ciTasks .hb').forEach(b => b.textContent = showAll ? 'Cacher' : 'Indice'); q('#ciSol').textContent = showAll ? 'Cacher les solutions' : 'Voir toutes les solutions'; };
  q('#ciReset').onclick = () => { if (!armReset) { armReset = true; q('#ciReset').textContent = 'Confirmer : tout effacer'; return; } loadLab(lab.id, true); };
  loadLab(ST.cur || LABS[0].id);
})();
