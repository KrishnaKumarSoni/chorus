// Visual check: launches the built app against a given user-data dir and screenshots the main surfaces.
// Usage: node scripts/visual-check.mjs <userDataDir> <shotsDir>
import { _electron as electron } from 'playwright';
import path from 'node:path';

const [userData, shots] = process.argv.slice(2).map((p) => path.resolve(p));
const env = { ...process.env, CHORUS_USER_DATA: userData };
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
const app = await electron.launch({ args: ['out/main/index.js'], env });
const page = await app.firstWindow();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(String(e)));
await page.setViewportSize?.({ width: 1380, height: 900 });
const shot = (name) => page.screenshot({ path: `${shots}/${name}.png` });
const set = (patch) => page.evaluate((p) => window.chorus.settings.set(p), patch);

await set({ appearance: 'light', accent: 'jade', sidebarCollapsed: false });
await page.reload();
await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 20000 });
await page.waitForFunction(() => document.querySelectorAll('[role="meter"]').length > 0, null, { timeout: 60000 }).catch(() => errors.push('no meters'));
await shot('01-main-light');

await page.keyboard.press('Meta+,');
await page.waitForSelector('[role="dialog"]');
await page.waitForTimeout(400);
await shot('02-settings-general');
await page.click('[role="tab"]:has-text("Models")');
await page.waitForFunction(() => !document.querySelector('[role="dialog"]')?.textContent?.includes('Checking…'), null, { timeout: 90000 }).catch(() => errors.push('providers still checking after 90s'));
await page.waitForTimeout(400);
await shot('03-settings-models');
await page.click('#model-claude');
await page.waitForSelector('[role="listbox"]');
await page.waitForTimeout(350);
await shot('04-model-select-open');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Escape');
await page.waitForTimeout(250);
const stillOpen = await page.$('[role="dialog"]');
if (!stillOpen) errors.push('Escape in listbox closed the whole dialog');
await page.click('[role="tab"]:has-text("Consensus")');
await page.waitForTimeout(400);
await shot('05-settings-consensus');
await page.click('[role="tab"]:has-text("Appearance")');
await page.waitForTimeout(400);
await shot('06-settings-appearance');
await page.click('[role="radio"][aria-label="Iris"]');
await page.click('[role="radio"]:has-text("Dark")');
await page.waitForTimeout(400);
await shot('07-settings-appearance-dark-iris');
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await shot('08-main-dark');
await page.click('[aria-label="Hide sidebar"]');
await page.waitForTimeout(500);
await shot('09-sidebar-collapsed');
await page.click('[aria-label="Show sidebar"]');
await page.click('[aria-label="Reply mode"] button:has-text("Consensus")');
await page.waitForTimeout(400);
await shot('10-composer-consensus');
await set({ appearance: 'light', accent: 'jade', sidebarCollapsed: false });
await page.waitForTimeout(300);
const convo = page.locator('nav[aria-label="Conversation list"] button[aria-current]').first();
const rows = page.locator('nav[aria-label="Conversation list"] .sidebar-row');
if ((await rows.count()) > 2) { await rows.nth(2).click(); await page.waitForTimeout(600); await shot('11-thread-light'); }
console.log(JSON.stringify({ errors }));
await app.close();
