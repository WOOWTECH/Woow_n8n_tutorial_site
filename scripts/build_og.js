#!/usr/bin/env node
/**
 * build_og.js — 產生每個語系的 Open Graph 分享卡（1200×630 PNG）。
 *
 *   node scripts/build_og.js            # 產生所有語系（依 i18n/locales.json）
 *   node scripts/build_og.js --check    # 只檢查檔案在不在，缺了就 exit 1（CI 用）
 *
 * 為什麼要有這支：分享卡是「站名 + 副標」的圖片版，語系不同就得換一張，
 * 而且不能用內含中文 callout 的截圖當英文站的分享卡。版型走 WoowTech 視覺規範
 * （白卡 28px 圓角、藍色只當 spot、Poppins 標題、一個 Yellowtail 暖色詞、無 emoji）。
 *
 * 相依：playwright（只有產圖時需要，CI 的 bootstrap job 會裝）。改文案改 chapters.json 即可。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const i18n = require('./lib/i18n');

const REPO_ROOT = i18n.REPO_ROOT;
const CHECK = process.argv.includes('--check');
const OUT_DIR = path.join(REPO_ROOT, 'assets', 'og');

// 每個語系一張：kicker（小標）、script（Yellowtail 暖色詞，各語系共用）、tag（網址）
const roots = [{ code: null, dir: '', cfgPath: path.join(REPO_ROOT, 'chapters.json') }];
for (const [code, loc] of Object.entries(i18n.loadLocales(REPO_ROOT))) {
  if (code.startsWith('_')) continue;
  roots.push({ code, dir: loc.dir || code, cfgPath: path.join(REPO_ROOT, loc.dir || code, 'chapters.json') });
}

const SCRIPT_WORD = 'your network, your home';

const cards = [];
for (const r of roots) {
  if (!fs.existsSync(r.cfgPath)) continue;
  const cfg = JSON.parse(fs.readFileSync(r.cfgPath, 'utf8'));
  const s = cfg.site;
  const file = (s.ogImage || '').replace(/^assets\/og\//, '');
  if (!file) continue;
  cards.push({
    out: path.join(OUT_DIR, file),
    kicker: `${s.license.holder} · ${s.brand}`,
    title: s.title,
    sub: `${s.subtitle} · ${(cfg.chapters || []).length}${r.code === null ? ' 章教學' : '-chapter tutorial'}`,
    tag: s.baseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''),
    lang: s.lang,
    titleSize: r.code === null ? '56px' : '60px',
  });
}

if (CHECK) {
  const missing = cards.filter((c) => !fs.existsSync(c.out));
  if (missing.length) {
    console.error('✗ 缺少分享卡（跑 node scripts/build_og.js）：');
    missing.forEach((c) => console.error('  · ' + path.relative(REPO_ROOT, c.out)));
    process.exit(1);
  }
  console.log(`✓ ${cards.length} 張分享卡都在`);
  process.exit(0);
}

const tpl = (c) => `<!doctype html><html lang="${c.lang}"><head><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@500;600;700&family=Outfit:wght@400;500&family=Yellowtail&family=Noto+Sans+TC:wght@500;700&display=swap">
<style>
html,body{margin:0;width:1200px;height:630px;background:#EFF1F5;font-family:Outfit,"Noto Sans TC",sans-serif;color:#212121}
.card{position:absolute;inset:40px;background:#fff;border-radius:28px;box-shadow:0 26px 60px -18px rgba(97,131,252,.28);padding:64px 72px;box-sizing:border-box}
.kicker{font:600 20px Poppins,"Noto Sans TC",sans-serif;letter-spacing:.12em;text-transform:uppercase;color:#646262}
.script{font:400 44px Yellowtail,cursive;color:#E66D3E;margin-top:26px}
h1{font:700 ${c.titleSize}/1.1 Poppins,"Noto Sans TC",sans-serif;letter-spacing:-.02em;margin:10px 0 18px;max-width:1000px}
.sub{font:400 26px/1.4 Outfit,"Noto Sans TC",sans-serif;color:#646262;max-width:900px}
.tile{position:absolute;right:72px;top:64px;width:96px;height:96px;border-radius:24px;background:#EEF2FF;display:flex;align-items:center;justify-content:center}
.tile svg{width:56px;height:56px;fill:#6183FC}
.tag{position:absolute;left:72px;bottom:56px;font:600 20px Poppins,sans-serif;color:#3F63E8;background:#EEF2FF;padding:10px 22px;border-radius:999px}
.wm{position:absolute;right:72px;bottom:60px;font:600 26px Poppins,sans-serif;letter-spacing:-.02em}
.wm span{color:#6183FC}
</style></head><body><div class="card">
<div class="kicker">${c.kicker}</div>
<div class="script">${SCRIPT_WORD}</div>
<h1>${c.title}</h1>
<div class="sub">${c.sub}</div>
<div class="tile"><svg viewBox="0 0 24 24"><path d="M12,1L3,5V11C3,16.55 6.84,21.74 12,23C17.16,21.74 21,16.55 21,11V5L12,1M12,7C13.4,7 14.8,8.1 14.8,9.5V11C15.4,11 16,11.6 16,12.3V15.8C16,16.4 15.4,17 14.7,17H9.2C8.6,17 8,16.4 8,15.7V12.2C8,11.6 8.6,11 9.2,11V9.5C9.2,8.1 10.6,7 12,7M12,8.2C11.2,8.2 10.5,8.7 10.5,9.5V11H13.5V9.5C13.5,8.7 12.8,8.2 12,8.2Z"/></svg></div>
<div class="tag">${c.tag}</div>
<div class="wm">woow<span>tech</span></div>
</div></body></html>`;

(async () => {
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (e) {
    console.error('✗ 需要 playwright 才能產圖：npm i -D playwright && npx playwright install chromium');
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  for (const c of cards) {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
    await page.setContent(tpl(c), { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    if (!(await page.evaluate(() => document.fonts.check('44px Yellowtail')))) {
      console.warn(`! ${path.basename(c.out)}：Yellowtail 沒載到，字體會落回預設（檢查對 fonts.googleapis.com 的連線）`);
    }
    await page.screenshot({ path: c.out });
    console.log('✓ ' + path.relative(REPO_ROOT, c.out));
    await page.close();
  }
  await browser.close();
})();
