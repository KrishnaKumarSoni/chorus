// End-to-end smoke test: launches the built app under Playwright, drives the UI, screenshots each step.
// Usage: node scripts/smoke.mjs [--send]   (--send performs a real Solo message through Codex)
import { _electron as electron } from 'playwright';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const send = process.argv.includes('--send');
const userData = mkdtempSync(path.join(tmpdir(), 'chorus-smoke-'));
const shots = path.resolve('test-results');
const env = { ...process.env, CHORUS_USER_DATA: userData };
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
const app = await electron.launch({ args: ['out/main/index.js'], env });
app.process().stderr?.on('data', (d) => process.stdout.write(`[main:err] ${d}`));
app.process().stdout?.on('data', (d) => process.stdout.write(`[main] ${d}`));
const page = await app.firstWindow();
page.on('console', (m) => { if (m.type() === 'error') console.log('[renderer]', m.text()); });
await page.waitForSelector('text=Start a conversation', { timeout: 15000 });
await page.screenshot({ path: `${shots}/01-empty.png` });

await page.click('text=Start a conversation');
await page.waitForSelector('textarea[aria-label="Message"]');
await page.fill('textarea[aria-label="Message"]', 'Give me two crisp reasons usage-based pricing beats seats for an analytics product.');
await page.screenshot({ path: `${shots}/02-composer.png` });

// Settings sheet + provider status
await page.keyboard.press('Meta+,');
await page.waitForSelector('[role="dialog"]');
await page.waitForFunction(() => !document.body.innerText.includes('Checking…'), null, { timeout: 60000 }).catch(() => undefined);
await page.screenshot({ path: `${shots}/03-settings.png` });
const status = await page.evaluate(() => window.chorus.providers.status());
console.log('providers:', JSON.stringify(status.map((s) => ({ p: s.provider, ok: s.ok, detail: s.detail, models: s.models.slice(0, 3).map((m) => m.id) }))));
await page.keyboard.press('Escape');

if (send) {
  await page.evaluate(() => window.chorus.settings.set({ soloProvider: 'codex', effort: { codex: 'low', claude: 'low' } }));
  await page.click('textarea[aria-label="Message"]');
  await page.keyboard.press('Enter');
  await page.waitForSelector('article', { timeout: 20000 });
  await page.screenshot({ path: `${shots}/04-streaming.png` });
  await page.waitForFunction(() => !document.querySelector('.caret') && !document.querySelector('.shimmer'), null, { timeout: 240000 });
  await page.screenshot({ path: `${shots}/05-solo-done.png`, fullPage: false });
  const conv = await page.evaluate(async () => { const l = await window.chorus.conversations.list(); return window.chorus.conversations.get(l[0].id); });
  console.log('turns:', conv.turns.map((t) => ({ role: t.role, author: t.author?.provider, status: t.status, chars: t.text.length, usage: t.usage })));
  console.log('sessions:', JSON.stringify(conv.sessions));

  // Compare: Claude will show its auth error next to a live GPT reply
  await page.fill('textarea[aria-label="Message"]', 'Now the strongest counter-argument, in three sentences.');
  await page.click('[role="radio"]:has-text("Compare")');
  await page.click('textarea[aria-label="Message"]');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelectorAll('article').length >= 3, null, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector('.caret') && !document.querySelector('.shimmer'), null, { timeout: 240000 });
  await page.screenshot({ path: `${shots}/06-compare.png` });
  const conv2 = await page.evaluate(async () => { const l = await window.chorus.conversations.list(); return window.chorus.conversations.get(l[0].id); });
  console.log('turns:', conv2.turns.map((t) => ({ role: t.role, author: t.author?.provider, status: t.status, chars: t.text.length, err: t.error?.slice(0, 80) })));
}
await app.close();
console.log('userData:', userData);
