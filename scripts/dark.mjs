import { _electron as electron } from 'playwright';
import path from 'node:path';
const src = process.argv[2]; // userData dir from a previous live smoke run (has a conversation)
const env = { ...process.env, CHORUS_USER_DATA: src };
for (const k of Object.keys(env)) if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_')) delete env[k];
const app = await electron.launch({ args: ['out/main/index.js'], env });
const page = await app.firstWindow();
await page.emulateMedia({ colorScheme: 'dark' });
await page.waitForSelector('textarea[aria-label="Message"]', { timeout: 15000 });
await page.waitForTimeout(800);
await page.screenshot({ path: path.resolve('test-results/07-dark.png') });
await app.close();
