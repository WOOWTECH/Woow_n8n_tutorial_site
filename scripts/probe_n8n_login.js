// Probe n8n login form: navigate to signin, dump the form DOM, screenshot.
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const SHOT = path.join(__dirname, 'probe_login.png');

function loadEnv() {
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}

(async () => {
  const env = loadEnv();
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(env.N8N_URL + '/signin', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  console.log('URL:', page.url());
  console.log('TITLE:', await page.title());
  const inputs = await page.$$eval('input, button', els => els.slice(0, 20).map(e => ({
    tag: e.tagName.toLowerCase(),
    type: e.type || null,
    name: e.name || null,
    id: e.id || null,
    placeholder: e.placeholder || null,
    label: e.getAttribute('aria-label') || null,
    text: (e.textContent || '').trim().slice(0, 40) || null,
  })));
  console.log('FORM ELEMENTS:');
  for (const el of inputs) console.log(' ', JSON.stringify(el));
  await page.screenshot({ path: SHOT });
  console.log('Screenshot:', SHOT);
  await browser.close();
})();
