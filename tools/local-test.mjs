import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import http from 'node:http';
import { createLocalServer } from './local-server.mjs';
import { keychainEncryption } from './chatgpt-keychain.mjs';
import { publicError } from './chatgpt-runtime.mjs';
import { ConnectionStore } from '../vendor/siwc/dist/storage.js';
import { streamResponse } from '../vendor/siwc/dist/responses.js';

const session = { status: 'connected', sharing: true, identity: { email: 'test@example.invalid' } };
const models = [{ slug: 'gpt-6.1-sol', displayName: 'GPT-6.1 Sol' }];
async function serve(overrides, task) {
  const calls = [];
  const client = {
    getSession: async () => session, listModels: async () => models,
    signIn: async options => { calls.push(options); return session; },
    cancelSignIn() {}, disconnect: async () => {},
    streamResponse: async options => { calls.push(options); options.onDelta('天命'); options.onDelta('未定'); return { text: '天命未定' }; },
    ...overrides
  };
  const server = createLocalServer({ runtimeFactory: async () => client });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const post = (path, body, headers = {}) => fetch(base + '/api/chatgpt/' + path, { method: 'POST',
    headers: { origin: base, 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try { await task({ base, post, calls }); } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
function browser(base) {
  const window = { AT: {}, ALTERTALE_LOCAL: true }, values = new Map();
  const box = { style: {}, querySelector: () => null };
  const context = { window, URL, TextDecoder, AbortController,
    fetch: (path, options = {}) => fetch(base + path, { ...options, headers: { ...options.headers, ...(options.method === 'POST' ? { origin: base } : {}) } }),
    document: { createElement: () => box, querySelector: () => ({ before() {} }) },
    localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } };
  return { window, context, box };
}

test('本地页面有登录控件入口，状态和模型列表不泄露凭证', async () => {
  await serve({ getSession: async () => ({ ...session, credentials: 'secret-marker' }), listModels: async () => models.map(m => ({ ...m, token: 'secret-marker' })) }, async ({ base }) => {
    const html = await (await fetch(base)).text();
    assert.ok(html.includes('window.ALTERTALE_LOCAL=true;') && html.includes('src="chatgpt.js"'));
    for (const path of ['session', 'models']) {
      const r = await fetch(base + '/api/chatgpt/' + path); assert.equal(r.status, 200);
      assert.ok(!(await r.text()).includes('secret-marker'));
    }
    for (const path of ['/../.env.local', '/tools/local-server.mjs', '/missing.js']) assert.equal((await fetch(base + path)).status, 404);
  });
});
test('拒绝外站、伪造 Host、无 Origin 和表单请求，不启动登录或推演', async () => {
  await serve({}, async ({ base, post, calls }) => {
    for (const headers of [{ origin: 'https://evil.invalid' }, { origin: '' }]) assert.equal((await post('sign-in', {}, headers)).status, 403, JSON.stringify(headers));
    // Node fetch replaces Host; use a raw HTTP request for the rebinding check.
    const rebinding = await new Promise((resolve, reject) => {
      const req = http.get(base + '/api/chatgpt/session', { headers: { host: 'evil.invalid' } }, res => { res.resume(); resolve(res.statusCode); }); req.once('error', reject);
    });
    assert.equal(rebinding, 403);
    assert.equal((await post('sign-in', {}, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await fetch(base + '/api/chatgpt/session', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
    assert.equal(calls.length, 0);
  });
});
test('仅登录身份，没有套餐授权时不允许推演', async () => {
  await serve({ getSession: async () => ({ ...session, sharing: false }), streamResponse: () => assert.fail('不得推演') }, async ({ base, post }) => {
    assert.equal((await fetch(base + '/api/chatgpt/models')).status, 403);
    const r = await post('generate', { model: 'gpt-6.1-sol', prompt: '推演' });
    assert.equal(r.status, 403); assert.equal((await r.json()).error.code, 'sharing_not_enabled');
  });
});
test('本地登录后用 6.1 Sol 从网页完成流式调用，兼容现有 LLM 接口', async () => {
  await serve({}, async ({ base, post, calls }) => {
    assert.equal((await post('sign-in', { reconsent: true })).status, 200);
    assert.equal(calls[0].reconsent, true);
    const { window, context, box } = browser(base);
    for (const path of ['web/api.js', 'web/chatgpt.js']) vm.runInNewContext(await readFile(path, 'utf8'), context);
    await window.AT.chatgpt.init(() => {});
    const provider = window.AT.chatgpt.provider(); assert.equal(provider.kind, 'chatgpt');
    const chunks = [], result = await provider.call('完整的推演提示词', text => chunks.push(text));
    assert.equal(result.text, '天命未定'); assert.equal(result.model, 'gpt-6.1-sol'); assert.equal(result.tier, 'ChatGPT 套餐');
    assert.deepEqual(chunks.slice(0, 2), ['天命', '天命未定']);
    assert.equal(calls[1].input, '完整的推演提示词');
    window.AT.chatgpt.render(false); assert.ok(box.innerHTML.includes('使用 ChatGPT 套餐'));
  });
});
test('未知模型和无效输入不会发送推演请求', async () => {
  await serve({ streamResponse: () => assert.fail('不得推演') }, async ({ post }) => {
    assert.equal((await post('generate', { prompt: '推演', model: 'not-available' })).status, 400);
    assert.equal((await post('generate', { prompt: '', model: 'gpt-6.1-sol' })).status, 400);
  });
});
test('上游中途失败不提交半段结果，套餐限额错误无需充值 API', async () => {
  await serve({ streamResponse: async options => {
    options.onDelta('半段'); throw { code: 'subscription_sharing_usage_limit_exceeded', status: 429, message: 'secret-marker' };
  } }, async ({ base }) => {
    const { window, context } = browser(base);
    for (const path of ['web/api.js', 'web/chatgpt.js']) vm.runInNewContext(await readFile(path, 'utf8'), context);
    await window.AT.chatgpt.init(() => {});
    await assert.rejects(window.AT.chatgpt.provider().call('推演'), error => {
      assert.equal(error.code, 'chatgpt_error'); assert.ok(error.message.includes('套餐') && !error.message.includes('secret-marker') && !error.message.includes('充值')); return true;
    });
  });
});
test('取消网页请求会取消模型生成', async () => {
  let cancelled;
  const aborted = new Promise(resolve => { cancelled = resolve; });
  await serve({ streamResponse: async options => {
    options.onDelta('正在推演');
    await new Promise(resolve => options.signal.addEventListener('abort', () => { cancelled(); resolve(); }, { once: true }));
    throw { code: 'cancelled' };
  } }, async ({ base }) => {
    const control = new AbortController();
    const r = await fetch(base + '/api/chatgpt/generate', { method: 'POST', signal: control.signal, headers: { origin: base, 'content-type': 'application/json' }, body: JSON.stringify({ prompt: '推演', model: 'gpt-6.1-sol' }) });
    await r.body.getReader().read(); control.abort();
    await Promise.race([aborted, new Promise((_, reject) => setTimeout(() => reject(new Error('取消没有传到模型')), 1500).unref())]);
  });
});
test('保存凭证使用系统密钥加密，重启可解密；密钥丢失或密文损坏时拒绝读取', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'altertale-credentials-test-'));
  let key = null; const entry = { getPassword: () => key, setPassword: value => { key = value; } };
  const store = new ConnectionStore(directory, keychainEncryption(entry));
  const saved = { version: 2, profiles: [], pendingRegistrations: [{ id: 'test-id', label: 'secret-marker', clientId: 'test-client', savedAt: new Date().toISOString() }] };
  try {
    await store.withLock(() => store.write(saved));
    const onDisk = await readFile(join(directory, 'chatgpt-auth.json'), 'utf8'); assert.ok(!onDisk.includes('secret-marker'));
    const reopened = new ConnectionStore(directory, keychainEncryption(entry));
    assert.deepEqual(await reopened.withLock(() => reopened.read()), saved);
    const encrypted = keychainEncryption(entry).encrypt('synthetic-token'); encrypted[15] ^= 1;
    assert.throws(() => keychainEncryption(entry).decrypt(encrypted));
    key = null;
    const missing = new ConnectionStore(directory, keychainEncryption(entry)); await assert.rejects(missing.withLock(() => missing.read()));
    assert.equal(await readFile(join(directory, 'chatgpt-auth.json'), 'utf8'), onDisk);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('官方 SDK 走 public Responses，store=false/stream=true，必须完成；不传旧接口参数', async () => {
  const previous = globalThis.fetch; let completed = true;
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body); assert.equal(body.store, false); assert.equal(body.stream, true);
    assert.ok(Array.isArray(body.input)); assert.ok(!('max_output_tokens' in body)); assert.ok(!('max_tokens' in body));
    const events = [{ type: 'response.output_text.delta', delta: '正文' }, ...(completed ? [{ type: 'response.completed', response: { status: 'completed' } }] : [])];
    return new Response(events.map(e => 'data: ' + JSON.stringify(e) + '\n\n').join(''), { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    const options = { model: 'gpt-6.1-sol', input: '推演' }, signal = new AbortController().signal;
    assert.equal((await streamResponse('synthetic-token', options, signal)).text, '正文');
    completed = false; await assert.rejects(streamResponse('synthetic-token', options, signal), error => error.code === 'stream_interrupted');
  } finally { globalThis.fetch = previous; }
});
test('未分类错误不暴露原始消息或堆栈', () => {
  assert.ok(!JSON.stringify(publicError(new Error('synthetic-token'))).includes('synthetic-token'));
});
