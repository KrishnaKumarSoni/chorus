import { existsSync, promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { bundledCodexPath, readCodexModels } from './codexCatalog';

describe('codex catalog', () => {
  it('finds the Codex binary bundled with the SDK', () => {
    const bin = bundledCodexPath();
    expect(bin && existsSync(bin)).toBe(true);
  });

  it('lists visible models by priority and keeps the configured one as default', async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), 'chorus-codex-'));
    await fs.writeFile(path.join(home, 'config.toml'), 'model = "gpt-5.5"\n');
    await fs.writeFile(
      path.join(home, 'models_cache.json'),
      JSON.stringify({
        models: [
          { slug: 'gpt-5.5', display_name: 'GPT-5.5', visibility: 'list', priority: 12 },
          { slug: 'hidden', visibility: 'hide', priority: 0 },
          { slug: 'gpt-6-astra', display_name: 'GPT-6-Astra', visibility: 'list', priority: 1, context_window: 272_000 },
        ],
      }),
    );
    const models = await readCodexModels(home);
    expect(models.map((m) => m.id)).toEqual(['gpt-6-astra', 'gpt-5.5']);
    expect(models.find((m) => m.isDefault)?.id).toBe('gpt-5.5');
  });
});
