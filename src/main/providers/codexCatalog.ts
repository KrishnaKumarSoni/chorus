import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Effort, ModelDescriptor } from '../../shared/types';

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
}

interface CachedModel {
  slug: string;
  display_name?: string;
  context_window?: number;
  visibility?: string;
  priority?: number;
  supported_reasoning_levels?: Array<{ effort: string }>;
  default_reasoning_level?: string;
}

const EFFORTS: Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

export async function readConfiguredModel(home = codexHome()): Promise<string | undefined> {
  try {
    const toml = await fs.readFile(path.join(home, 'config.toml'), 'utf8');
    const m = toml.match(/^\s*model\s*=\s*"([^"]+)"/m);
    return m?.[1];
  } catch {
    return undefined;
  }
}

/** Codex keeps a model catalog (with context windows) next to its config; use it as the discovery source. */
export async function readCodexModels(home = codexHome()): Promise<ModelDescriptor[]> {
  const configured = await readConfiguredModel(home);
  let models: CachedModel[] = [];
  try {
    const raw = JSON.parse(await fs.readFile(path.join(home, 'models_cache.json'), 'utf8')) as { models?: CachedModel[] };
    models = raw.models ?? [];
  } catch {
    /* no cache yet */
  }
  const listed = models
    .filter((m) => m.slug && (m.visibility ?? 'list') === 'list')
    .sort((a, b) => (a.priority ?? 999) - (b.priority ?? 999))
    .map<ModelDescriptor>((m) => ({
      provider: 'codex',
      id: m.slug,
      label: m.display_name ?? m.slug,
      contextWindow: m.context_window,
      efforts: (m.supported_reasoning_levels ?? []).map((l) => l.effort).filter((e): e is Effort => EFFORTS.includes(e as Effort)),
      isDefault: m.slug === configured,
    }));
  if (configured && !listed.some((m) => m.id === configured)) {
    listed.unshift({ provider: 'codex', id: configured, label: configured, isDefault: true });
  }
  if (listed.length && !listed.some((m) => m.isDefault)) listed[0].isDefault = true;
  return listed;
}
