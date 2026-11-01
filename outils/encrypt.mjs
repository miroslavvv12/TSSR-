// Chiffre le contenu de l'appli avec une clé AES-256 aléatoire, elle-même chiffrée avec la clé publique.
// Usage : node encrypt.mjs keys.json app_plain.html content.enc
import { webcrypto as crypto } from 'node:crypto';
import fs from 'node:fs';
const S = crypto.subtle;
const [keysFile, inFile, outFile] = process.argv.slice(2);
const keys = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
const pub = await S.importKey('spki', Buffer.from(keys.pub, 'base64'), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
const k = crypto.getRandomValues(new Uint8Array(32));
const wrapped = new Uint8Array(await S.encrypt({ name: 'RSA-OAEP' }, pub, k));
const ck = await S.importKey('raw', k, 'AES-GCM', false, ['encrypt']);
const iv = crypto.getRandomValues(new Uint8Array(12));
const ct = new Uint8Array(await S.encrypt({ name: 'AES-GCM', iv }, ck, fs.readFileSync(inFile)));
const head = new Uint8Array(2); new DataView(head.buffer).setUint16(0, wrapped.length);
fs.writeFileSync(outFile, Buffer.concat([head, wrapped, iv, ct]));
console.log('chiffré', ct.length, 'octets');
