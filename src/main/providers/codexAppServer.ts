import { spawn } from 'node:child_process';
import { bundledCodexPath } from './codexCatalog';

/**
 * Ask the bundled Codex app-server one question over its JSON-RPC stdio
 * protocol, then shut it down. Used for account data the exec SDK does not
 * expose, such as plan rate limits.
 */
export function codexRequest<T>(method: string, params: unknown, env: NodeJS.ProcessEnv, timeoutMs = 15_000): Promise<T> {
  const bin = bundledCodexPath();
  if (!bin) return Promise.reject(new Error('The bundled Codex binary is missing.'));
  return new Promise<T>((resolve, reject) => {
    const proc = spawn(bin, ['app-server'], { env, stdio: ['pipe', 'pipe', 'ignore'] });
    let buf = '';
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      proc.kill();
      fn();
    };
    const timer = setTimeout(() => finish(() => reject(new Error('Codex did not answer in time.'))), timeoutMs);
    const send = (m: object) => proc.stdin.write(`${JSON.stringify(m)}\n`);
    proc.on('error', (e) => finish(() => reject(e)));
    proc.on('exit', () => finish(() => reject(new Error('Codex exited before answering.'))));
    proc.stdout.setEncoding('utf8');
    proc.stdout.on('data', (chunk: string) => {
      buf += chunk;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let msg: { id?: number; result?: unknown; error?: { message?: string } };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.id === 1) {
          send({ method: 'initialized' });
          send({ id: 2, method, params });
        } else if (msg.id === 2) {
          if (msg.error) finish(() => reject(new Error(msg.error?.message ?? 'Codex returned an error.')));
          else finish(() => resolve(msg.result as T));
        }
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'chorus', version: '0.1.0' } } });
  });
}
