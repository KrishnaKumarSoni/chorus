import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import { shell } from 'electron';
import type { AuthEvent, Provider } from '../../shared/types';
import { codexHome } from '../providers/codexCatalog';

// Claude Code OAuth (Claude Pro/Max). Public client id for the desktop flow,
// the same one the Claude Code CLI uses; PKCE means there is no client secret.
const CLAUDE_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const CLAUDE_AUTHORIZE_URL = 'https://claude.ai/oauth/authorize';
const CLAUDE_TOKEN_URL = 'https://platform.claude.com/v1/oauth/token';
const CLAUDE_REDIRECT_URI = 'http://localhost:53692/callback';
const CLAUDE_CALLBACK_PORT = 53692;
const CLAUDE_SCOPES = 'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload';

const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface ClaudeFlow {
  verifier: string;
  state: string;
  server: http.Server;
  cancel: () => void;
}

/**
 * In-app sign-in for both providers, so the user never drops to a terminal.
 *
 * Claude runs the standard desktop OAuth flow (authorization code + PKCE, with
 * a loopback redirect) and stores the resulting tokens in the same macOS
 * keychain item the Claude Code CLI reads (`Claude Code-credentials` ->
 * `claudeAiOauth`). The bundled CLI the Agent SDK spawns then reuses those
 * tokens and refreshes them on its own.
 *
 * Codex delegates to `codex login`, which runs its own loopback exchange on
 * port 1455 and writes `auth.json` itself.
 *
 * The app never handles a password: the provider's own consent page collects
 * credentials and we only ever receive the resulting OAuth tokens.
 */
export class AuthService {
  private claude?: ClaudeFlow;
  private codexProc?: ReturnType<typeof spawn>;

  constructor(private readonly emit: (e: AuthEvent) => void) {}

  isBusy(provider: Provider): boolean {
    return provider === 'claude' ? !!this.claude : !!this.codexProc;
  }

  async start(provider: Provider): Promise<void> {
    if (provider === 'claude') return this.startClaude();
    return this.startCodex();
  }

  cancel(provider: Provider): void {
    if (provider === 'claude') this.claude?.cancel();
    else this.codexProc?.kill('SIGTERM');
  }

  /** Forget the stored credential for a provider. */
  async signOut(provider: Provider): Promise<void> {
    if (provider === 'claude') {
      await run('security', ['delete-generic-password', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username]).catch(() => undefined);
    } else {
      await fs.rm(`${codexHome()}/auth.json`, { force: true });
    }
  }

  // ---------- Claude ----------

  private async startClaude(): Promise<void> {
    this.claude?.cancel();
    const verifier = b64url(randomBytes(32));
    const challenge = b64url(createHash('sha256').update(verifier).digest());
    const state = b64url(randomBytes(24));

    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      try {
        server.close();
      } catch {
        /* already closed */
      }
      this.claude = undefined;
      fn();
    };

    const server = http.createServer(async (req, res) => {
      if (!req.url?.startsWith('/callback')) {
        res.writeHead(404).end();
        return;
      }
      const url = new URL(req.url, CLAUDE_REDIRECT_URI);
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const err = url.searchParams.get('error_description') ?? url.searchParams.get('error');
      if (err) {
        res.writeHead(200, { 'content-type': 'text/html' }).end(resultPage('Sign-in failed', err));
        finish(() => this.emit({ provider: 'claude', phase: 'error', message: err }));
        return;
      }
      if (!code || gotState !== state) {
        res.writeHead(400, { 'content-type': 'text/html' }).end(resultPage('Sign-in failed', 'The callback did not match this sign-in attempt.'));
        finish(() => this.emit({ provider: 'claude', phase: 'error', message: 'The callback did not match this sign-in attempt.' }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html' }).end(resultPage('Signed in', 'You can close this tab and go back to Chorus.'));
      this.emit({ provider: 'claude', phase: 'exchanging' });
      try {
        await this.exchangeClaude(code, state, verifier);
        finish(() => this.emit({ provider: 'claude', phase: 'done' }));
      } catch (e) {
        finish(() => this.emit({ provider: 'claude', phase: 'error', message: (e as Error).message }));
      }
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', (e: NodeJS.ErrnoException) =>
        reject(new Error(e.code === 'EADDRINUSE' ? `Port ${CLAUDE_CALLBACK_PORT} is already in use; close the other sign-in and try again.` : e.message)),
      );
      server.listen(CLAUDE_CALLBACK_PORT, '127.0.0.1', () => resolve());
    });

    this.claude = { verifier, state, server, cancel: () => finish(() => this.emit({ provider: 'claude', phase: 'cancelled' })) };

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLAUDE_CLIENT_ID,
      redirect_uri: CLAUDE_REDIRECT_URI,
      scope: CLAUDE_SCOPES,
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state,
    });
    const authUrl = `${CLAUDE_AUTHORIZE_URL}?${params.toString()}`;
    this.emit({ provider: 'claude', phase: 'awaiting-browser', url: authUrl });
    await shell.openExternal(authUrl);
  }

  /**
   * Fallback for when the browser cannot reach the loopback server (for example
   * a browser on another machine): the user pastes the final redirect URL, or
   * the `code#state` string the consent page shows.
   */
  async completeClaudeManual(input: string): Promise<void> {
    const flow = this.claude;
    if (!flow) throw new Error('No Claude sign-in is in progress. Start one first.');
    const trimmed = input.trim();
    let code: string | undefined;
    let state = flow.state;
    if (trimmed.includes('code=')) {
      const u = new URL(trimmed.includes('://') ? trimmed : `http://localhost:${CLAUDE_CALLBACK_PORT}/callback?${trimmed.replace(/^[^?]*\?/, '')}`);
      code = u.searchParams.get('code') ?? undefined;
      state = u.searchParams.get('state') ?? flow.state;
    } else if (trimmed) {
      const [c, s] = trimmed.split('#');
      code = c;
      state = s || flow.state;
    }
    if (!code) throw new Error('Could not find an authorization code in what you pasted.');
    this.emit({ provider: 'claude', phase: 'exchanging' });
    try {
      await this.exchangeClaude(code, state, flow.verifier);
      try {
        flow.server.close();
      } catch {
        /* ignore */
      }
      this.claude = undefined;
      this.emit({ provider: 'claude', phase: 'done' });
    } catch (e) {
      this.emit({ provider: 'claude', phase: 'error', message: (e as Error).message });
      throw e;
    }
  }

  private async exchangeClaude(code: string, state: string, verifier: string): Promise<void> {
    const res = await fetch(CLAUDE_TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        client_id: CLAUDE_CLIENT_ID,
        code,
        state,
        redirect_uri: CLAUDE_REDIRECT_URI,
        code_verifier: verifier,
      }),
    });
    if (!res.ok) throw new Error(`Token exchange failed (${res.status}). ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
      account?: { subscription_type?: string };
    };
    if (!data.access_token || !data.refresh_token) throw new Error('The token response was missing an access or refresh token.');
    const cred = {
      claudeAiOauth: {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
        scopes: (data.scope ?? CLAUDE_SCOPES).split(' ').filter(Boolean),
        subscriptionType: data.account?.subscription_type ?? 'max',
      },
    };
    await run('security', ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', os.userInfo().username, '-w', JSON.stringify(cred)]);
  }

  // ---------- Codex ----------

  private async startCodex(): Promise<void> {
    if (this.codexProc) throw new Error('A Codex sign-in is already in progress.');
    // Sign in against the user's canonical Codex home; the app's own codex-home
    // symlinks auth.json to it, so both stay in sync.
    const home = codexHome();
    await fs.mkdir(home, { recursive: true });
    const proc = spawn('codex', ['login'], {
      env: { ...process.env, CODEX_HOME: home, PATH: `${process.env.PATH ?? ''}:/usr/local/bin:/opt/homebrew/bin:${os.homedir()}/.local/bin` },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.codexProc = proc;
    let opened = false;
    const onData = (buf: Buffer) => {
      const m = buf.toString().match(/https:\/\/auth\.openai\.com\/oauth\/authorize\S+/);
      if (m && !opened) {
        opened = true;
        this.emit({ provider: 'codex', phase: 'awaiting-browser', url: m[0] });
        shell.openExternal(m[0]).catch(() => undefined);
      }
    };
    proc.stdout?.on('data', onData);
    proc.stderr?.on('data', onData);
    proc.on('error', (e) => {
      this.codexProc = undefined;
      this.emit({ provider: 'codex', phase: 'error', message: /ENOENT/.test(e.message) ? 'The `codex` command was not found. Install the Codex CLI, then try again.' : e.message });
    });
    proc.on('exit', (code, signal) => {
      this.codexProc = undefined;
      if (code === 0) this.emit({ provider: 'codex', phase: 'done' });
      else if (signal) this.emit({ provider: 'codex', phase: 'cancelled' });
      else this.emit({ provider: 'codex', phase: 'error', message: `Codex sign-in ended with code ${code}.` });
    });
  }
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let err = '';
    p.stderr.on('data', (d) => (err += String(d)));
    p.on('error', reject);
    p.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} failed: ${err.trim() || `exit ${code}`}`))));
  });
}

function resultPage(title: string, body: string): string {
  return `<!doctype html><meta charset="utf-8"><title>${title}</title><body style="font:15px -apple-system,system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f4f4f3;color:#1c1c1e"><div style="text-align:center"><h1 style="font-size:20px;font-weight:600;margin:0 0 8px">${title}</h1><p style="color:#63636a;margin:0">${body}</p></div></body>`;
}
