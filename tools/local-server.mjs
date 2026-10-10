import http from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { makeRuntime, publicError, usageURL } from './chatgpt-runtime.mjs';

const WEB = resolve(dirname(fileURLToPath(import.meta.url)), '../web');
const failure = (code, status = 400) => Object.assign(new Error(code), { code, status });
const json = (res, value, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
};
async function readJSON(req) {
  if (!req.headers['content-type']?.startsWith('application/json')) throw failure('invalid_request', 415);
  let text = '';
  for await (const chunk of req) {
    text += chunk;
    if (Buffer.byteLength(text) > 2_000_000) throw failure('invalid_request', 413);
  }
  try { return JSON.parse(text); } catch { throw failure('invalid_request'); }
}

export function createLocalServer({ runtimeFactory = makeRuntime, webRoot = WEB } = {}) {
  let client, signingIn = false, generating = false;
  // Lazily initialized: serving the game does not access keys or start OAuth.
  const runtime = async () => {
    if (!client) { try { client = await runtimeFactory(); } catch { throw failure('encryption_unavailable', 503); } }
    return client;
  };
  const server = http.createServer(async (req, res) => {
    const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
    // Fixed loopback host blocks DNS rebinding. JSON writes require the page's
    // Origin, so another website cannot initiate sign-in or spend plan usage.
    if (req.headers.host !== host || (req.headers.origin && req.headers.origin !== origin) || req.headers['sec-fetch-site'] === 'cross-site')
      return json(res, { error: { code: 'forbidden', message: '请从本机游戏页面操作。' } }, 403);
    const url = new URL(req.url, origin), path = url.pathname;
    const control = new AbortController();
    res.once('close', () => { if (!res.writableEnded) control.abort(); });
    try {
      if (path.startsWith('/api/chatgpt/')) {
        if (!['GET', 'POST'].includes(req.method)) return json(res, { error: { code: 'method_not_allowed' } }, 405);
        if (req.method === 'POST' && req.headers.origin !== origin) return json(res, { error: { code: 'forbidden', message: '请从游戏页面操作。' } }, 403);
        const body = req.method === 'POST' ? await readJSON(req) : null;
        const chatgpt = await runtime();
        if (path === '/api/chatgpt/session' && req.method === 'GET') {
          const s = await chatgpt.getSession();
          return json(res, { session: { status: s.status, sharing: s.sharing, profileId: s.profileId,
            identity: s.identity ? { name: s.identity.name, email: s.identity.email } : undefined,
            ...(s.error ? { error: publicError(s.error) } : {}) }, usageURL });
        }
        if (path === '/api/chatgpt/sign-in' && req.method === 'POST') {
          if (signingIn || generating) throw failure('busy', 409);
          signingIn = true;
          try {
            const session = await chatgpt.signIn({ signal: control.signal, ...(body?.reconsent === true ? { reconsent: true } : {}) });
            return json(res, { session: { status: session.status, sharing: session.sharing,
              identity: session.identity ? { name: session.identity.name, email: session.identity.email } : undefined } });
          } finally { signingIn = false; }
        }
        if (path === '/api/chatgpt/cancel-sign-in' && req.method === 'POST') { chatgpt.cancelSignIn(); return json(res, { ok: true }); }
        if (path === '/api/chatgpt/disconnect' && req.method === 'POST') {
          try { await chatgpt.disconnect(); }
          catch (error) { if (error.code === 'revocation_failed') return json(res, { ok: true, error: publicError(error) }); throw error; }
          return json(res, { ok: true });
        }
        if (path === '/api/chatgpt/models' && req.method === 'GET') {
          const session = await chatgpt.getSession();
          if (!session.sharing) throw failure('sharing_not_enabled', 403);
          const models = await chatgpt.listModels({ signal: control.signal });
          return json(res, { models: models.map(m => ({ slug: m.slug, displayName: m.displayName })) });
        }
        if (path === '/api/chatgpt/generate' && req.method === 'POST') {
          if (signingIn || generating) throw failure('busy', 409);
          if (typeof body?.prompt !== 'string' || !body.prompt.trim() || typeof body?.model !== 'string') throw failure('invalid_request');
          const reasoningEffort = body.reasoningEffort;
          if (reasoningEffort !== undefined && !['low', 'medium', 'high', 'xhigh', 'max'].includes(reasoningEffort)) throw failure('invalid_request');
          generating = true;
          try {
            const session = await chatgpt.getSession();
            if (!session.sharing) throw failure('sharing_not_enabled', 403);
            const models = await chatgpt.listModels({ signal: control.signal });
            if (!models.some(m => m.slug === body.model)) throw failure('model_not_found', 400);
            res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff' });
            const send = value => { if (!res.destroyed) res.write('data: ' + JSON.stringify(value) + '\n\n'); };
            const result = await chatgpt.streamResponse({ model: body.model, input: body.prompt, signal: control.signal,
              ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
              onDelta: delta => send({ model: body.model, choices: [{ delta: { content: delta } }] }) });
            // The SDK requires response.completed. Failures never produce DONE.
            if (!result.text.trim()) throw failure('empty_completion');
            send({ model: body.model, choices: [{ delta: {}, finish_reason: 'stop' }] });
            if (!res.destroyed) res.end('data: [DONE]\n\n');
          } finally { generating = false; }
          return;
        }
        return json(res, { error: { code: 'not_found' } }, 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) return json(res, { error: { code: 'method_not_allowed' } }, 405);
      let filename;
      try { filename = await realpath(resolve(webRoot, '.' + decodeURIComponent(path === '/' ? '/index.html' : path))); }
      catch { return json(res, { error: { code: 'not_found' } }, 404); }
      const root = await realpath(webRoot);
      const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
      if (!filename.startsWith(root + sep) || !types[extname(filename)]) return json(res, { error: { code: 'not_found' } }, 404);
      let data = await readFile(filename);
      if (filename === resolve(root, 'index.html')) data = Buffer.from(data.toString().replace('<script src="api.js"></script>',
        '<script src="api.js"></script><script>window.ALTERTALE_LOCAL=true;</script><script src="chatgpt.js"></script>'));
      res.writeHead(200, { 'content-type': types[extname(filename)], 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer' });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (res.destroyed) return;
      const safe = publicError(error);
      if (res.headersSent) res.end('data: ' + JSON.stringify({ error: safe }) + '\n\n');
      else json(res, { error: safe }, Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 502);
    }
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.ALTERTALE_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('ALTERTALE_PORT 必须是 1–65535 的端口。');
  const server = createLocalServer();
  server.once('error', error => { console.error(error.code === 'EADDRINUSE' ? '端口已占用，请关闭已有游戏，或设置 ALTERTALE_PORT。' : '本地服务器启动失败。'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`天命未定：http://127.0.0.1:${port}\n打开页面，点击 Continue with ChatGPT 登录并授权使用套餐。`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => server.close(() => process.exit(0)));
}
