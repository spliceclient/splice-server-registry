#!/usr/bin/env node
'use strict';
/*
 * Splice server-presence registry validator + builder. Pure Node (no deps) so CI is trivial.
 *
 *   node scripts/validate.js            → validate every server; exit 1 if ANY is invalid (used by PR CI —
 *                                         a bad-format submission fails the check and can't be merged).
 *   node scripts/validate.js --build    → build dist/presence.json from the VALID entries only (invalid ones
 *                                         are skipped, i.e. auto-removed from what clients read); exit 0.
 *
 * A server lives in servers/<id>/ with:
 *   metadata.json  { "ip": "...", "name": "...", "details": "..."(optional) }
 *   icon.png       a square PNG, 64..1024 px, <= 512 KB
 * The built entry's "icon" is the raw-GitHub URL of that committed icon.png — so the image is frozen at
 * approval time and can never be swapped by the owner afterwards.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SERVERS_DIR = path.join(ROOT, 'servers');
const DIST = path.join(ROOT, 'dist', 'presence.json');

// Base for icon URLs in the built file. In CI this is set from the repo, e.g.
// https://raw.githubusercontent.com/<owner>/<repo>/main
const ICON_BASE = (process.env.REGISTRY_RAW_BASE || 'https://raw.githubusercontent.com/OWNER/REPO/main').replace(/\/+$/, '');

const LIMITS = {
  idRe: /^[a-z0-9][a-z0-9-]{1,38}$/,               // folder name
  ipRe: /^(?=.{1,100}$)[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/i,
  nameMax: 32,
  detailsMax: 64,
  iconMaxBytes: 512 * 1024,
  iconMinPx: 64,
  iconMaxPx: 1024,
};

function fail(list, id, msg) { list.push(`[${id}] ${msg}`); }

/** Read a PNG's width/height from its IHDR (bytes 16..24). Returns null if not a valid PNG. */
function pngSize(buf) {
  if (buf.length < 24) return null;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) if (buf[i] !== sig[i]) return null;
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

function validateServer(id) {
  const errors = [];
  const dir = path.join(SERVERS_DIR, id);
  if (!LIMITS.idRe.test(id)) fail(errors, id, `folder name must match ${LIMITS.idRe} (lowercase letters/digits/hyphens)`);

  // metadata.json
  let meta = null;
  const metaPath = path.join(dir, 'metadata.json');
  if (!fs.existsSync(metaPath)) {
    fail(errors, id, 'missing metadata.json');
  } else {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); }
    catch (e) { fail(errors, id, 'metadata.json is not valid JSON: ' + e.message); }
  }
  if (meta) {
    const allowed = new Set(['ip', 'name', 'details']);
    for (const k of Object.keys(meta)) if (!allowed.has(k)) fail(errors, id, `unknown field "${k}" (allowed: ip, name, details)`);
    if (typeof meta.ip !== 'string' || !LIMITS.ipRe.test(meta.ip)) fail(errors, id, 'ip missing/invalid (host or host:port, e.g. play.example.net)');
    if (typeof meta.name !== 'string' || !meta.name.trim()) fail(errors, id, 'name is required');
    else if (meta.name.length > LIMITS.nameMax) fail(errors, id, `name too long (max ${LIMITS.nameMax})`);
    else if (/[\x00-\x1f]/.test(meta.name)) fail(errors, id, 'name has control characters');
    if (meta.details != null) {
      if (typeof meta.details !== 'string') fail(errors, id, 'details must be a string');
      else if (meta.details.length > LIMITS.detailsMax) fail(errors, id, `details too long (max ${LIMITS.detailsMax})`);
      else if (/[\x00-\x1f]/.test(meta.details)) fail(errors, id, 'details has control characters');
    }
  }

  // icon.png
  const iconPath = path.join(dir, 'icon.png');
  if (!fs.existsSync(iconPath)) {
    fail(errors, id, 'missing icon.png');
  } else {
    const buf = fs.readFileSync(iconPath);
    if (buf.length > LIMITS.iconMaxBytes) fail(errors, id, `icon.png too big (${buf.length} bytes, max ${LIMITS.iconMaxBytes})`);
    const size = pngSize(buf);
    if (!size) fail(errors, id, 'icon.png is not a valid PNG');
    else {
      if (size.w !== size.h) fail(errors, id, `icon.png must be square (got ${size.w}x${size.h})`);
      if (size.w < LIMITS.iconMinPx || size.w > LIMITS.iconMaxPx) fail(errors, id, `icon.png must be ${LIMITS.iconMinPx}..${LIMITS.iconMaxPx}px (got ${size.w})`);
    }
  }

  return { id, meta, errors };
}

function main() {
  const build = process.argv.includes('--build');
  if (!fs.existsSync(SERVERS_DIR)) { console.error('no servers/ directory'); process.exit(build ? 0 : 1); }

  const ids = fs.readdirSync(SERVERS_DIR).filter((d) => {
    try { return fs.statSync(path.join(SERVERS_DIR, d)).isDirectory(); } catch (_) { return false; }
  });

  const results = ids.map(validateServer);

  // Duplicate-IP check across the valid ones.
  const seen = new Map();
  for (const r of results) {
    if (r.errors.length || !r.meta) continue;
    const key = String(r.meta.ip).toLowerCase();
    if (seen.has(key)) r.errors.push(`[${r.id}] duplicate ip "${r.meta.ip}" (also in ${seen.get(key)})`);
    else seen.set(key, r.id);
  }

  const valid = results.filter((r) => r.errors.length === 0);
  const invalid = results.filter((r) => r.errors.length > 0);

  for (const r of invalid) for (const e of r.errors) console.error('INVALID ' + e);
  console.log(`\n${valid.length} valid, ${invalid.length} invalid, ${results.length} total.`);

  if (build) {
    // icon = the Discord Rich-Presence ASSET KEY staff upload for this server (srv_<id>). Discord's URL-based
    // external assets now 401, so the client can only show pre-uploaded asset keys. The committed icon.png is
    // the source staff upload + review; it isn't fetched at runtime.
    const entries = valid.map((r) => ({
      ip: r.meta.ip,
      name: r.meta.name,
      details: r.meta.details || '',
      icon: 'srv_' + r.id.replace(/-/g, '_'),
    }));
    fs.mkdirSync(path.dirname(DIST), { recursive: true });
    fs.writeFileSync(DIST, JSON.stringify(entries, null, 2) + '\n');
    console.log(`built ${DIST} with ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} (invalid excluded).`);
    process.exit(0);
  }

  process.exit(invalid.length ? 1 : 0);
}

main();
