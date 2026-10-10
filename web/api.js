/* OAI/Anthropic transport shared by the page and offline protocol tests. */
(function (root) {
  'use strict';
  const api = root.AT.api = {};
  api.openaiURL = base => {
    const u = new URL(String(base).trim());
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.search || u.hash)
      throw { code: 'invalid_config', message: '请填写完整接口地址，例如 https://api.deepseek.com/v1。' };
    u.pathname = u.pathname.replace(/\/+$/, '');
    if (!u.pathname.endsWith('/chat/completions')) u.pathname += '/chat/completions';
    return u.href;
  };
  api.text = content => typeof content === 'string' ? content : Array.isArray(content) ? content.map(x => x.text || '').join('') : '';
  api.visible = text => text.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/<think>[\s\S]*$/gi, '').trim();
  api.rateLimitCopy = error => {
    const kind = error.upstreamCode || error.upstreamType;
    if (kind === 'insufficient_quota' || kind === 'billing_hard_limit_reached')
      return '模型 API 额度不足或已达到支出上限，请检查 API 平台的余额与额度。ChatGPT Plus 与 API 分开计费。';
    if (kind === 'rate_limit_exceeded' || kind === 'rate_limit_error')
      return '模型服务请求过于频繁，请稍后重试；如持续出现，请检查 API 的请求与 token 速率限制。';
    return '模型服务返回 429，暂时无法确认是限流还是额度不足。' + (error.message ? '\n' + error.message : '请在 API 平台检查用量与账单。');
  };
  api.read = async (response, provider, model, onText = () => {}, signal) => {
    if (!response.ok) {
      let message = '', upstreamCode = '', upstreamType = '';
      try { const d = await response.json(); message = d.error?.message || d.message || ''; upstreamCode = d.error?.code || ''; upstreamType = d.error?.type || ''; } catch {}
      throw { code: 'http_' + response.status, message, upstreamCode, upstreamType };
    }
    const meta = { model, tier: '', inTok: 0, outTok: 0 };
    let text = '';
    const consume = ev => {
      if (ev.error || ev.type === 'error') throw { code: 'upstream_error', message: ev.error?.message || '模型服务返回错误。', upstreamCode: ev.error?.code || '', upstreamType: ev.error?.type || '' };
      if (provider === 'openai') {
        if (ev.model) meta.model = ev.model;
        if (ev.usage) {
          meta.inTok = ev.usage.prompt_tokens ?? meta.inTok;
          meta.outTok = ev.usage.completion_tokens ?? meta.outTok;
        }
        const c = ev.choices?.[0];
        text += api.text(c?.delta?.content ?? c?.message?.content);
        if (c?.finish_reason === 'length' || c?.finish_reason === 'max_tokens') throw { code: 'truncated', message: '输出达到模型长度上限，请换用支持较长输出的模型后重试。' };
      } else {
        if (ev.type === 'message_start' && ev.message) {
          meta.model = ev.message.model || meta.model;
          const u = ev.message.usage || {};
          meta.inTok = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        } else if (ev.type === 'message_delta') {
          meta.outTok = ev.usage?.output_tokens ?? meta.outTok;
          if (ev.delta?.stop_reason === 'max_tokens') throw { code: 'truncated', message: '输出达到模型长度上限，请重试。' };
        } else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') text += ev.delta.text;
        else if (ev.type === 'message' || Array.isArray(ev.content)) {
          meta.model = ev.model || meta.model;
          text += api.text(ev.content);
          meta.inTok = ev.usage?.input_tokens || 0; meta.outTok = ev.usage?.output_tokens || 0;
          if (ev.stop_reason === 'max_tokens') throw { code: 'truncated' };
        }
      }
      onText(api.visible(text));
    };
    if (response.headers.get('content-type')?.includes('application/json')) {
      consume(await response.json());
    } else {
      if (!response.body) throw { code: 'empty_completion' };
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = '', data = [], ended = false;
      const dispatch = () => {
        if (!data.length) return;
        const raw = data.join('\n'); data = [];
        if (raw.trim() === '[DONE]') { ended = true; return; }
        let event;
        try { event = JSON.parse(raw); } catch { throw { code: 'invalid_response', message: '接口返回了无法解析的流式数据。' }; }
        consume(event);
      };
      const line = value => {
        if (value.endsWith('\r')) value = value.slice(0, -1);
        if (!value) dispatch();
        else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
      };
      try {
        while (!ended) {
          if (signal?.aborted) throw { code: 'cancelled' };
          const { done, value } = await reader.read();
          buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
          let newline;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            line(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1);
          }
          if (done) { if (buffer) line(buffer); dispatch(); break; }
        }
      } finally { try { await reader.cancel(); } catch {} reader.releaseLock(); }
    }
    text = api.visible(text);
    if (!text) throw { code: 'empty_completion' };
    return { text, ...meta };
  };
  api.call = async (provider, config, prompt, onText, signal, model, maxTokens = 8000) => {
    const payload = { model, max_tokens: maxTokens, stream: true, messages: [{ role: 'user', content: prompt }] };
    const hosted = !!root.ALTERTALE_HOSTED;
    const url = hosted ? '/api/' + provider : provider === 'openai' ? api.openaiURL(config.base) : 'https://api.anthropic.com/v1/messages';
    const headers = { 'content-type': 'application/json' };
    if (!hosted) {
      if (provider === 'openai' && config.key) headers.authorization = 'Bearer ' + config.key;
      if (provider === 'anthropic') Object.assign(headers, { 'x-api-key': config.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' });
    }
    try {
      const response = await fetch(url, { method: 'POST', headers, signal,
        body: JSON.stringify(hosted ? { base: config.base, key: config.key, payload } : payload) });
      return await api.read(response, provider, model, onText, signal);
    } catch (e) {
      if (signal?.aborted || e?.name === 'AbortError') throw { code: 'cancelled' };
      if (e?.code) throw e;
      throw { code: 'fetch_blocked', message: String(e) };
    }
  };
})(window);
