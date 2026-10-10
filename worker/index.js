// The build embeds web/ here so the deployed Worker is a single ESM file.
const assets = /* ALTERTALE_ASSETS */ {};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }
});

export function upstreamURL(base, provider) {
  const u = new URL(String(base).trim());
  const host = u.hostname.toLowerCase();
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      (u.port && u.port !== '443') || !host.includes('.') ||
      /(^|\.)(localhost|local|internal|test|invalid|example)$/.test(host) ||
      host.endsWith('.local') || host.endsWith('.internal') ||
      /^[\d.]+$/.test(host) || host.includes(':')) {
    throw new Error('请填写公网 HTTPS 接口地址；云端无法访问本机 Ollama 或内网服务。');
  }
  u.pathname = u.pathname.replace(/\/+$/, '');
  if (provider === 'anthropic') {
    if (!u.pathname.endsWith('/messages')) u.pathname += '/messages';
  } else if (!u.pathname.endsWith('/chat/completions')) {
    u.pathname += '/chat/completions';
  }
  return u;
}

async function proxy(request, env, provider) {
  const origin = request.headers.get('origin');
  if ((origin && origin !== new URL(request.url).origin) || request.headers.get('sec-fetch-site') === 'cross-site')
    return json({ error: { message: '请从本站发送请求。' } }, 403);
  if (!request.headers.get('content-type')?.startsWith('application/json'))
    return json({ error: { message: '请求格式应为 JSON。' } }, 415);
  if (Number(request.headers.get('content-length')) > 2_000_000)
    return json({ error: { message: '请求内容过长。' } }, 413);
  let input;
  try {
    const raw = await request.text();
    if (raw.length > 2_000_000) return json({ error: { message: '请求内容过长。' } }, 413);
    input = JSON.parse(raw);
  } catch { return json({ error: { message: '无法读取接口设置。' } }, 400); }
  const { payload } = input || {};
  if (!payload || typeof payload.model !== 'string' || !payload.model.trim() ||
      !Array.isArray(payload.messages) || payload.messages.length !== 1 ||
      payload.messages[0]?.role !== 'user' || typeof payload.messages[0]?.content !== 'string')
    return json({ error: { message: '请填写模型名和推演内容。' } }, 400);
  const base = provider === 'anthropic' ? 'https://api.anthropic.com/v1' : (input.base || env.OPENAI_BASE_URL);
  let url;
  try { url = upstreamURL(base, provider); }
  catch (e) { return json({ error: { message: e.message } }, 400); }
  // A saved server Key must never be sent to a visitor-selected endpoint.
  let defaultEndpoint = '';
  try { defaultEndpoint = upstreamURL(env.OPENAI_BASE_URL, 'openai').href; } catch {}
  const serverKey = provider === 'anthropic' ? env.ANTHROPIC_API_KEY : url.href === defaultEndpoint ? env.OPENAI_API_KEY : '';
  const key = String(input.key || serverKey || '').trim();
  const headers = { 'content-type': 'application/json', 'accept': 'text/event-stream, application/json' };
  if (provider === 'anthropic') {
    headers['x-api-key'] = key;
    headers['anthropic-version'] = '2023-06-01';
  } else if (key) headers.authorization = 'Bearer ' + key;
  try {
    const upstream = await fetch(url, {
      method: 'POST', headers, redirect: 'error', signal: request.signal,
      body: JSON.stringify({ model: payload.model, messages: payload.messages,
        max_tokens: Math.min(8000, Math.max(32, Number(payload.max_tokens) || 8000)), stream: true })
    });
    if (!upstream.ok) {
      let message = `模型服务返回 ${upstream.status}，请检查接口地址、Key、模型名和余额。`;
      try {
        const body = await upstream.json();
        if (typeof body.error?.message === 'string') message = body.error.message.slice(0, 600);
      } catch {}
      if (key) message = message.split(key).join('[已隐藏]');
      return json({ error: { message } }, upstream.status);
    }
    return new Response(upstream.body, { status: upstream.status, headers: {
      'content-type': upstream.headers.get('content-type') || 'text/event-stream; charset=utf-8',
      'cache-control': 'no-store, no-transform', 'x-content-type-options': 'nosniff'
    } });
  } catch (e) {
    return json({ error: { message: '无法连接模型服务，请检查公网接口地址后重试。' } }, e.name === 'AbortError' ? 408 : 502);
  }
}

export default {
  async fetch(request, env = {}, ctx) {
    const path = new URL(request.url).pathname;
    if (path === '/api/config' && request.method === 'GET') return json({
      hosted: true, openai: { configured: !!(env.OPENAI_BASE_URL && env.OPENAI_MODEL),
        base: env.OPENAI_BASE_URL || '', model: env.OPENAI_MODEL || '', quick: env.OPENAI_QUICK_MODEL || '' }
    });
    if (path === '/api/openai' || path === '/api/anthropic') {
      if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } });
      return proxy(request, env, path === '/api/anthropic' ? 'anthropic' : 'openai');
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const asset = assets[path === '/' ? '/index.html' : path];
    if (!asset) return new Response('Not found', { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.body, { headers: {
      'content-type': asset.type, 'cache-control': 'no-cache',
      'x-content-type-options': 'nosniff', 'referrer-policy': 'same-origin'
    } });
  }
};
