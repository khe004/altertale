import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const load = async path => import('data:text/javascript;base64,' + Buffer.from(await readFile(path, 'utf8')).toString('base64'));
const { default: worker, upstreamURL } = await load('worker/index.js');
const window = { AT: {} };
vm.runInNewContext(await readFile('web/api.js', 'utf8'), { window, fetch: (...args) => globalThis.fetch(...args), URL, TextDecoder });
const api = window.AT.api;
const event = x => 'data: ' + JSON.stringify(x) + '\r\n\r\n';
function stream(text, sizes = [1, 2, 3, 7, 11]) {
  const bytes = new TextEncoder().encode(text); let offset = 0, i = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) { controller.close(); return; }
    const end = Math.min(bytes.length, offset + sizes[i++ % sizes.length]);
    controller.enqueue(bytes.slice(offset, end)); offset = end;
  }}), { headers: { 'content-type': 'text/event-stream' } });
}
const payload = { model: 'model-main', messages: [{ role: 'user', content: '请推演' }] };
const request = (body, headers = {}, path = '/api/openai') => new Request('https://altertale.chatgpt.site' + path, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body)
});
async function mocked(fn, task) { const previous = globalThis.fetch; globalThis.fetch = fn; try { await task(); } finally { globalThis.fetch = previous; } }

test('规范化 base、完整 endpoint、末尾斜线', () => {
  for (const base of ['https://api.deepseek.com/v1', 'https://api.deepseek.com/v1/', 'https://api.deepseek.com/v1/chat/completions/']) {
    assert.equal(api.openaiURL(base), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(upstreamURL(base, 'openai').href, 'https://api.deepseek.com/v1/chat/completions');
  }
});
test('云端不接受内网、IP、非 HTTPS 或带凭证的地址', () => {
  for (const base of ['http://localhost:11434/v1', 'https://127.0.0.1/v1', 'https://[::1]/v1', 'https://a.internal/v1', 'https://u:p@api.deepseek.com/v1', 'https://api.deepseek.com:444/v1', 'https://api.deepseek.com/v1?secret=x']) assert.throws(() => upstreamURL(base, 'openai'));
});
test('中文多字节跨块、CRLF、用量、没有末尾换行', async () => {
  const result = await api.read(stream(event({ model: 'actual', choices: [{ delta: { content: '天命' } }] }) +
    event({ choices: [{ delta: { content: '未定' } }] }) +
    'data: ' + JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 4 } })), 'openai', 'requested');
  assert.equal(result.text, '天命未定'); assert.equal(result.model, 'actual'); assert.equal(result.inTok, 10); assert.equal(result.outTok, 4);
});
test('多行 SSE data、注释、DONE', async () => {
  const result = await api.read(stream(': keepalive\n\ndata: {"choices":\ndata: [{"delta":{"content":"成功"}}]}\n\ndata: [DONE]\n\n'), 'openai', 'm');
  assert.equal(result.text, '成功');
});
test('隐藏 think 和独立 reasoning，不把思考当正文', async () => {
  const visible = [];
  const result = await api.read(stream(event({ choices: [{ delta: { reasoning_content: '私密思考' } }] }) +
    event({ choices: [{ delta: { content: '<think>思考' } }] }) + event({ choices: [{ delta: { content: '</think>正文' } }] })), 'openai', 'm', x => visible.push(x));
  assert.equal(result.text, '正文'); assert.ok(visible.every(x => !x.includes('思考')));
});
test('兼容只返回 JSON 的 OAI 服务', async () => {
  const result = await api.read(Response.json({ model: 'm', choices: [{ message: { content: [{ type: 'text', text: '正文' }] } }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), 'openai', 'm');
  assert.equal(result.text, '正文'); assert.equal(result.inTok, 3);
});
test('空输出、损坏 SSE、模型报错、截断都显式失败', async () => {
  for (const [data, code] of [
    ['data: [DONE]\n\n', 'empty_completion'], ['data: bad\n\n', 'invalid_response'],
    [event({ error: { message: '余额不足' } }), 'upstream_error'],
    [event({ choices: [{ delta: { content: '半回' }, finish_reason: 'length' }] }), 'truncated']
  ]) await assert.rejects(api.read(stream(data), 'openai', 'm'), e => e.code === code);
});
test('Anthropic 流式正文和缓存用量', async () => {
  const result = await api.read(stream(event({ type: 'message_start', message: { model: 'claude', usage: { input_tokens: 10, cache_read_input_tokens: 20 } } }) +
    event({ type: 'content_block_delta', delta: { type: 'text_delta', text: '军情' } }) +
    event({ type: 'message_delta', usage: { output_tokens: 3 }, delta: { stop_reason: 'end_turn' } })), 'anthropic', 'm');
  assert.equal(result.text, '军情'); assert.equal(result.inTok, 30); assert.equal(result.outTok, 3);
});
test('取消请求保留 cancelled 状态', async () => {
  const control = new AbortController(); control.abort();
  await mocked(async () => { throw new DOMException('Aborted', 'AbortError'); }, async () => {
    await assert.rejects(api.call('openai', { base: 'https://api.deepseek.com/v1' }, 'p', () => {}, control.signal, 'm'), e => e.code === 'cancelled');
  });
});
test('同源转发完整链路和主/小活模型选择', async () => {
  window.ALTERTALE_HOSTED = true;
  let count = 0;
  await mocked(async (url, options) => {
    if (String(url).startsWith('/api/')) return worker.fetch(new Request('https://altertale.chatgpt.site' + url, options));
    assert.equal(String(url), 'https://api.deepseek.com/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer test-key');
    const data = JSON.parse(options.body); assert.equal(data.model, count++ ? 'model-quick' : 'model-main');
    assert.equal(data.stream, true); assert.equal(data.max_tokens, 8000);
    return stream(event({ choices: [{ delta: { content: '连接成功' } }] }) + 'data: [DONE]\n\n');
  }, async () => {
    for (const model of ['model-main', 'model-quick']) {
      const r = await api.call('openai', { base: 'https://api.deepseek.com/v1', key: 'test-key' }, '请只回复：连接成功', () => {}, undefined, model);
      assert.equal(r.text, '连接成功');
    }
  });
  window.ALTERTALE_HOSTED = false;
});
test('转发使用运行时 Key，config 从不暴露 Key', async () => {
  const env = { OPENAI_BASE_URL: 'https://api.deepseek.com/v1', OPENAI_MODEL: 'm', OPENAI_API_KEY: 'server-key' };
  const config = await worker.fetch(new Request('https://site.example/api/config'), env);
  assert.ok(!(await config.text()).includes('server-key'));
  await mocked(async (url, options) => { assert.equal(options.headers.authorization, 'Bearer server-key'); return stream(event({ choices: [{ delta: { content: '成功' } }] })); }, async () => {
    const response = await worker.fetch(request({ payload }), env); assert.equal(response.status, 200); await response.text();
  });
});
test('上游 401/429 不被改成成功，消息不泄露 Key', async () => {
  for (const status of [401, 429]) await mocked(async () => Response.json({ error: { message: 'failed test-key' } }, { status }), async () => {
    const response = await worker.fetch(request({ base: 'https://api.deepseek.com/v1', key: 'test-key', payload }));
    assert.equal(response.status, status); assert.ok(!(await response.text()).includes('test-key'));
  });
});
test('429 保留上游类型，明确区分额度不足与请求限流', async () => {
  for (const kind of ['insufficient_quota', 'rate_limit_exceeded']) {
    await mocked(async () => Response.json({ error: { message: 'upstream details', code: kind, type: kind } }, { status: 429 }), async () => {
      const response = await worker.fetch(request({ base: 'https://api.openai.com/v1', key: 'test-key', payload }));
      await assert.rejects(api.read(response, 'openai', 'm'), error => {
        assert.equal(error.code, 'http_429');
        assert.equal(error.upstreamCode, kind);
        assert.equal(error.upstreamType, kind);
        const copy = api.rateLimitCopy(error);
        if (kind === 'insufficient_quota') assert.ok(copy.includes('额度不足') && copy.includes('Plus'));
        else assert.ok(copy.includes('请求过于频繁') && !copy.includes('余额') && !copy.includes('充值'));
        return true;
      });
    });
  }
  assert.ok(api.rateLimitCopy({ message: 'details' }).includes('暂时无法确认'));
  assert.ok(api.rateLimitCopy({ upstreamType: 'rate_limit_error' }).includes('请求过于频繁'));
});
test('上游错误元数据同样隐藏 Key', async () => {
  await mocked(async () => Response.json({ error: { message: 'test-key', code: 'test-key', type: 'test-key' } }, { status: 429 }), async () => {
    const response = await worker.fetch(request({ base: 'https://api.openai.com/v1', key: 'test-key', payload }));
    assert.ok(!(await response.text()).includes('test-key'));
  });
});
test('跨站请求、无效设置不发送上游请求', async () => {
  await mocked(async () => { assert.fail('不应访问上游'); }, async () => {
    for (const [body, headers, status] of [
      [{ base: 'https://api.deepseek.com/v1', payload }, { origin: 'https://evil.example' }, 403],
      [{ base: 'https://api.deepseek.com/v1', payload }, { 'sec-fetch-site': 'cross-site' }, 403],
      [{ base: 'http://localhost/v1', payload }, {}, 400], [{ base: 'https://api.deepseek.com/v1', payload: {} }, {}, 400]
    ]) assert.equal((await worker.fetch(request(body, headers))).status, status);
  });
});
test('网络失败返回可理解的 502', async () => {
  await mocked(async () => { throw new TypeError('network'); }, async () => {
    assert.equal((await worker.fetch(request({ base: 'https://api.deepseek.com/v1', payload }))).status, 502);
  });
});
test('所有页面内嵌脚本可以编译', async () => {
  const html = await readFile('web/index.html', 'utf8');
  for (const match of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)) if (match[1].trim()) new vm.Script(match[1]);
});
test('服务器 Key 不会发送到用户另填的接口', async () => {
  await mocked(async (url, options) => {
    assert.equal(String(url), 'https://api.other-provider.com/v1/chat/completions');
    assert.equal(options.headers.authorization, undefined);
    return Response.json({ choices: [{ message: { content: '成功' } }] });
  }, async () => {
    await worker.fetch(request({ base: 'https://api.other-provider.com/v1', payload }), { OPENAI_BASE_URL: 'https://api.deepseek.com/v1', OPENAI_API_KEY: 'server-key' });
  });
});
test('小请求采用较小输出上限', async () => {
  await mocked(async (url, options) => {
    assert.equal(JSON.parse(options.body).max_tokens, 128);
    return Response.json({ choices: [{ message: { content: '连接成功' } }] });
  }, async () => {
    await worker.fetch(request({ base: 'https://api.deepseek.com/v1', payload: { ...payload, max_tokens: 128 } }));
  });
});
test('GPT-6.1 Sol 使用 OpenAI 输出上限、推理档和实际用量参数', async () => {
  await mocked(async (url, options) => {
    assert.equal(String(url), 'https://api.openai.com/v1/chat/completions');
    const body = JSON.parse(options.body);
    assert.equal(body.max_tokens, undefined);
    assert.equal(body.max_completion_tokens, 8000);
    assert.equal(body.reasoning_effort, 'medium');
    assert.equal(body.stream_options.include_usage, true);
    return Response.json({ choices: [{ message: { content: '正文' } }] });
  }, async () => {
    const response = await worker.fetch(request({ base: 'https://api.openai.com/v1', key: 'test-key', payload: { ...payload, model: 'gpt-6.1-sol', max_tokens: 8000 } }));
    assert.equal(response.status, 200);
  });
});
test('未配置服务器 Key 时不会宣称模型已接通', async () => {
  const response = await worker.fetch(new Request('https://site.example/api/config'), { OPENAI_BASE_URL: 'https://api.openai.com/v1', OPENAI_MODEL: 'gpt-6.1-sol' });
  assert.equal((await response.json()).openai.configured, false);
});
