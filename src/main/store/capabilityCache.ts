import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Capability, Provider } from '../../shared/types';
import { recalibrate } from '../context/tokens';

/** Conservative window used only until a provider reports the real number. */
export const FALLBACK_CONTEXT_WINDOW = 128_000;

export class CapabilityCache {
  private map: Record<string, Capability> = {};
  constructor(private readonly file: string) {}

  private key(provider: Provider, model: string) {
    return `${provider}:${model}`;
  }

  async init(): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try {
      this.map = JSON.parse(await fs.readFile(this.file, 'utf8'));
    } catch {
      this.map = {};
    }
  }

  get(provider: Provider, model: string): Capability {
    return this.map[this.key(provider, model)] ?? { contextWindow: FALLBACK_CONTEXT_WINDOW, calibration: 1, source: 'fallback' };
  }

  /** Catalog data (model lists) never overrides a discovered value. */
  async seed(provider: Provider, model: string, contextWindow: number, maxOutputTokens?: number): Promise<void> {
    const cur = this.map[this.key(provider, model)];
    if (cur && cur.source === 'discovered') return;
    this.map[this.key(provider, model)] = { contextWindow, maxOutputTokens, calibration: cur?.calibration ?? 1, source: 'catalog' };
    await this.save();
  }

  async discovered(provider: Provider, model: string, contextWindow: number, maxOutputTokens?: number): Promise<void> {
    const cur = this.get(provider, model);
    this.map[this.key(provider, model)] = { ...cur, contextWindow, maxOutputTokens: maxOutputTokens ?? cur.maxOutputTokens, source: 'discovered' };
    await this.save();
  }

  async observe(provider: Provider, model: string, estimated: number, actual: number): Promise<void> {
    const cur = this.get(provider, model);
    this.map[this.key(provider, model)] = { ...cur, calibration: recalibrate(cur.calibration, estimated, actual) };
    await this.save();
  }

  private async save() {
    await fs.writeFile(this.file, JSON.stringify(this.map, null, 2), 'utf8');
  }
}
