#!/usr/bin/env node
/**
 * apply_code_translations.js — 把 code 區塊的翻譯提案套進某個語系，並登錄白名單。
 *
 *   node scripts/apply_code_translations.js en            # 檢視提案，不改檔
 *   node scripts/apply_code_translations.js en --write    # 套用 + 寫進 i18n/code-translate.json
 *
 * 為什麼要分兩步：check_i18n 的 B 閘門要求 <pre>/<code>/<kbd> 與 zh 逐字相同，
 * 這是刻意的——指令、設定鍵、埠號被「順手翻譯」是最難發現也最傷讀者的錯。
 * 真的該翻的（程式碼裡的中文註解、中文佔位值）走這裡：一筆一筆登錄成白名單，
 * 之後 zh 那邊改了 code 區塊，白名單對不上就會紅燈，不會默默失效。
 *
 * 提案檔：i18n/_proposals/<file>.json
 *   {"file":"ch7_acl.html","entries":[{"unit":"#default-deny","zh":"<原封不動的整個區塊>","en":"<只翻中文後的同一個區塊>"}]}
 */

'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');

const REPO_ROOT = i18n.REPO_ROOT;
const code = process.argv[2];
const WRITE = process.argv.includes('--write');
if (!code) {
  console.error('用法：node scripts/apply_code_translations.js <locale> [--write]');
  process.exit(2);
}
const locales = i18n.loadLocales(REPO_ROOT);
const dir = path.join(REPO_ROOT, (locales[code] && locales[code].dir) || code);
const propDir = path.join(REPO_ROOT, 'i18n', '_proposals');
const wlPath = path.join(REPO_ROOT, 'i18n', 'code-translate.json');
const wl = i18n.readJSON(wlPath, { _readme: '', allow: [] });
wl._readme =
  'code 區塊的例外清單：只有列在這裡的 <pre>/<code>/<kbd> 才允許與 zh 不同（通常是程式碼裡的中文註解或中文佔位值）。zh 那邊改了就會對不上而紅燈。由 scripts/apply_code_translations.js 維護。';
wl.allow = wl.allow || [];

const HAN = /[㐀-䶿一-鿿豈-﫿]/;

function unitRange(html, unit) {
  if (!unit || !unit.startsWith('#')) return { start: 0, end: html.length };
  const id = unit.slice(1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const open = new RegExp(`<section\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i').exec(html);
  if (!open) return { start: 0, end: html.length };
  const start = open.index;
  const close = html.indexOf('</section>', start + open[0].length);
  return { start, end: close < 0 ? html.length : close + '</section>'.length };
}

function countInUnit(html, unit, value) {
  const { start, end } = unitRange(html, unit);
  return html.slice(start, end).split(value).length - 1;
}

function replaceInUnit(html, unit, from, to) {
  const { start, end } = unitRange(html, unit);
  return html.slice(0, start) + html.slice(start, end).replace(from, to) + html.slice(end);
}

let applied = 0, skipped = 0, rejected = 0;

for (const f of fs.existsSync(propDir) ? fs.readdirSync(propDir).filter((x) => x.endsWith('.json')) : []) {
  const prop = JSON.parse(fs.readFileSync(path.join(propDir, f), 'utf8'));
  const target = path.join(dir, prop.file);
  if (!fs.existsSync(target)) {
    console.error(`✗ ${prop.file}: ${code}/ 下找不到這個檔`);
    rejected++;
    continue;
  }
  let html = fs.readFileSync(target, 'utf8');
  const replacements = [];
  const key = (w) => `${w.file}|${w.unit}|${w.zh}`;

  // Validate against the original file before replacing anything. Applying entries
  // one by one is order-sensitive when two proposals swap values (A -> B, B -> A).
  for (const [entryIndex, e] of (prop.entries || []).entries()) {
    if (!e.zh || !e.en) { rejected++; continue; }
    if (e.zh === e.en) { skipped++; continue; }
    if (HAN.test(e.en)) {
      console.error(`✗ ${prop.file} ${e.unit}: 譯後仍有漢字，跳過`);
      rejected++;
      continue;
    }

    const entry = { file: prop.file, unit: e.unit, zh: e.zh, [code]: e.en };
    const idx = wl.allow.findIndex((w) => key(w) === key(entry));
    const whitelistMatches = idx >= 0 && wl.allow[idx][code] === e.en;
    const sourceCount = countInUnit(html, e.unit, e.zh);
    const targetCount = countInUnit(html, e.unit, e.en);

    // A matching whitelist entry and no remaining source means the proposal is
    // already applied. Some approved entries intentionally translate repeated
    // blocks in one unit, so the translated form may occur more than once. A true
    // swap is the other valid case: each target remains as its partner's source.
    const isSwap = (prop.entries || []).some(
      (other) => other !== e && other.unit === e.unit && other.zh === e.en && other.en === e.zh,
    );
    const completedSwap = isSwap && sourceCount === 1 && targetCount === 1;
    if (whitelistMatches && targetCount >= 1 && (sourceCount === 0 || completedSwap)) {
      skipped++;
      console.log(`= ${prop.file} ${e.unit}（已套用）`);
      continue;
    }
    if (sourceCount !== 1) {
      const detail = idx >= 0 && !whitelistMatches ? '（白名單譯文不一致）' : '';
      console.error(`✗ ${prop.file} ${e.unit}: 原文區塊在 ${code}/ 出現 ${sourceCount} 次（需要剛好 1 次）${detail}，跳過`);
      rejected++;
      continue;
    }

    const marker = `__I18N_CODE_TRANSLATION_${f}_${entryIndex}__`;
    if (countInUnit(html, e.unit, marker)) {
      console.error(`✗ ${prop.file} ${e.unit}: 暫存標記與頁面內容衝突，跳過`);
      rejected++;
      continue;
    }
    replacements.push({ e, entry, idx, marker });
  }

  // Use unique markers so swaps and chains are applied simultaneously.
  for (const { e, marker } of replacements) html = replaceInUnit(html, e.unit, e.zh, marker);
  for (const { e, entry, idx, marker } of replacements) {
    html = replaceInUnit(html, e.unit, marker, e.en);
    if (idx >= 0) wl.allow[idx] = { ...wl.allow[idx], ...entry };
    else wl.allow.push(entry);
    applied++;
    console.log(`✓ ${prop.file} ${e.unit}`);
  }
  if (WRITE) fs.writeFileSync(target, html);
}

if (WRITE) {
  fs.writeFileSync(wlPath, JSON.stringify(wl, null, 2) + '\n');
  console.log(`\n已套用 ${applied} 筆，白名單共 ${wl.allow.length} 筆${skipped ? `（略過 ${skipped} 筆無變更）` : ''}${rejected ? `，拒絕 ${rejected} 筆` : ''}`);
} else {
  console.log(`\n（預覽，未寫入）可套用 ${applied} 筆${skipped ? `，略過 ${skipped}` : ''}${rejected ? `，拒絕 ${rejected}` : ''}。加 --write 才會真的改。`);
}
process.exit(rejected ? 1 : 0);
