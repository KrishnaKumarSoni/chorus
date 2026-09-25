import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Settings } from '../../shared/types';
import { DEFAULT_DEBATE_PROMPTS } from '../orchestrator/prompts';

export const DEFAULT_SETTINGS: Settings = {
  globalInstructions: '',
  defaultMode: 'solo',
  soloProvider: 'claude',
  models: { claude: '', codex: '' },
  effort: { claude: 'high', codex: 'medium' },
  consensusStarter: 'codex',
  consensusMaxTurns: 6,
  debatePrompts: DEFAULT_DEBATE_PROMPTS,
  appearance: 'system',
  accent: 'jade',
  sidebarCollapsed: false,
  webAccess: true,
};

export class SettingsStore {
  private value: Settings = { ...DEFAULT_SETTINGS };
  constructor(private readonly file: string) {}

  async init(): Promise<Settings> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      const raw = JSON.parse(await fs.readFile(this.file, 'utf8')) as Partial<Settings>;
      this.value = {
        ...DEFAULT_SETTINGS,
        ...raw,
        models: { ...DEFAULT_SETTINGS.models, ...(raw.models ?? {}) },
        effort: { ...DEFAULT_SETTINGS.effort, ...(raw.effort ?? {}) },
        debatePrompts: { ...DEFAULT_SETTINGS.debatePrompts, ...(raw.debatePrompts ?? {}) },
      };
    } catch {
      /* first run */
    }
    return this.value;
  }

  get(): Settings {
    return this.value;
  }

  async set(patch: Partial<Settings>): Promise<Settings> {
    this.value = {
      ...this.value,
      ...patch,
      models: { ...this.value.models, ...(patch.models ?? {}) },
      effort: { ...this.value.effort, ...(patch.effort ?? {}) },
      debatePrompts: { ...this.value.debatePrompts, ...(patch.debatePrompts ?? {}) },
    };
    await fs.writeFile(this.file, JSON.stringify(this.value, null, 2), 'utf8');
    return this.value;
  }
}
