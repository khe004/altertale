/* Local-only ChatGPT plan UI. OAuth credentials never enter this page. */
(function (root) {
  'use strict';
  if (!root.ALTERTALE_LOCAL) return;
  const api = root.AT.api, MODEL_STORE = 'altertale-chatgpt-model-v2';
  const MAIN_EFFORT = 'low', QUICK_MODEL = 'gpt-6-luna', QUICK_EFFORT = 'low';
  const state = { session: { status: 'disconnected', sharing: false }, models: [], model: '', message: '', connecting: false, testing: false };
  let change = () => {}, box;
  const esc = text => String(text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const request = async (path, body, signal) => {
    const response = await fetch('/api/chatgpt/' + path, { cache: 'no-store', signal,
      ...(body !== undefined ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) });
    const data = await response.json();
    if (!response.ok) throw { code: 'chatgpt_error', message: data.error?.message || 'ChatGPT 连接失败。' };
    return data;
  };
  async function refresh() {
    const data = await request('session'); state.session = data.session; state.models = []; state.model = '';
    if (state.session.sharing) {
      const result = await request('models'); state.models = result.models;
      let saved = ''; try { saved = localStorage.getItem(MODEL_STORE) || ''; } catch {}
      state.model = state.models.find(m => m.slug === saved)?.slug || state.models.find(m => m.slug === 'gpt-6.1-sol')?.slug || state.models[0]?.slug || '';
      if (!state.model) state.message = '此账户没有可用模型，请检查套餐授权。';
    }
    if (state.session.error) state.message = state.session.error.message;
  }
  const controller = root.AT.chatgpt = {
    async init(onChange) {
      change = onChange;
      box = document.createElement('section'); box.className = 'keybox'; box.id = 'chatgptPlan';
      box.style.cssText = 'max-width:70rem;margin:1rem auto;padding:1rem;width:calc(100% - 2rem)';
      document.querySelector('.wrap').before(box);
      try { await refresh(); } catch (e) { state.message = e.message || '无法读取本机 ChatGPT 登录状态。'; }
      change();
    },
    provider() {
      if (!state.session.sharing || !state.model) return null;
      return { kind: 'chatgpt', call: controller.call };
    },
    async call(prompt, onText = () => {}, signal, options = {}) {
      try {
        const quick = options.tier === 'quick';
        const model = quick && state.models.some(item => item.slug === QUICK_MODEL) ? QUICK_MODEL : state.model;
        const response = await fetch('/api/chatgpt/generate', { method: 'POST', headers: { 'content-type': 'application/json' },
          signal, body: JSON.stringify({ prompt, model, reasoningEffort: quick && model === QUICK_MODEL ? QUICK_EFFORT : MAIN_EFFORT }) });
        if (!response.ok) {
          const data = await response.json(); throw { code: 'chatgpt_error', message: data.error?.message || 'ChatGPT 请求失败。' };
        }
        const result = await api.read(response, 'openai', model, onText, signal);
        return { ...result, tier: `ChatGPT 套餐 · ${quick && model === QUICK_MODEL ? QUICK_EFFORT : MAIN_EFFORT}` };
      } catch (e) {
        if (signal?.aborted || e.name === 'AbortError') throw { code: 'cancelled' };
        if (e.code === 'upstream_error') throw { code: 'chatgpt_error', message: e.message };
        if (e.code) throw e;
        throw { code: 'chatgpt_error', message: '本地连接中断，请确认游戏服务仍在运行。' };
      }
    },
    render(gameBusy) {
      if (!box) return;
      const s = state.session, connected = s.status === 'connected';
      const disabled = gameBusy || state.connecting || state.testing;
      box.innerHTML = `<strong>使用 ChatGPT 套餐推演</strong>
        <span>${connected ? `已登录：${esc(s.identity?.email || s.identity?.name || 'ChatGPT 账户')}` : '登录你的 Plus / Pro 账户，授权后即可推演，无需 API Key。'} ${s.sharing ? '· 使用 ChatGPT 套餐' : ''}</span>
        <div class="row">${state.connecting ? '<button class="ui-btn" id="cancelChatGPT" type="button">取消登录</button>' :
          `<button class="ui-btn" id="connectChatGPT" type="button" ${disabled ? 'disabled' : ''}>${connected ? (s.sharing ? '重新登录 ChatGPT' : '授权使用套餐') : 'Continue with ChatGPT'}</button>`}
        ${connected ? `<button class="ui-btn" id="disconnectChatGPT" type="button" ${disabled ? 'disabled' : ''}>退出登录</button>` : ''}
        <a href="https://chatgpt.com/settings/usage" target="_blank" rel="noopener noreferrer">管理用量</a></div>
        ${s.sharing ? `<label>推演模型 <select id="chatgptModel" ${disabled ? 'disabled' : ''}>${state.models.map(m => `<option value="${esc(m.slug)}" ${m.slug === state.model ? 'selected' : ''}>${esc(m.displayName)} · ${esc(m.slug)}</option>`).join('')}</select></label>
          <div class="row"><button class="ui-btn" id="testChatGPT" type="button" ${disabled || !state.model ? 'disabled' : ''}>测试推演连接</button><button class="ui-btn" id="refreshChatGPT" type="button" ${disabled ? 'disabled' : ''}>刷新模型列表</button></div>` : ''}
        <span role="status" aria-live="polite">${esc(state.message)}</span>
        <small>推演、说书和复核默认使用所选模型 · low；拆令、预检和改字优先使用 GPT-6 Luna · low。均计入 ChatGPT 套餐用量。</small>`;
      const find = id => box.querySelector('#' + id);
      const action = async (message, task) => {
        state.message = message; change();
        try { await task(); } catch (e) { state.message = e.message || '操作失败，请重试。'; }
        change();
      };
      if (find('connectChatGPT')) find('connectChatGPT').onclick = () => {
        state.connecting = true;
        return action('请在打开的浏览器里登录并授权使用 ChatGPT 套餐……', async () => {
          try {
            await request('sign-in', { reconsent: connected });
            await refresh();
            state.message = state.session.sharing ? '套餐已授权，选择起点或继续存档即可推演。' : '登录成功，还需要授权使用套餐才能推演。';
          } finally { state.connecting = false; }
        });
      };
      if (find('cancelChatGPT')) find('cancelChatGPT').onclick = () => action('正在取消……', async () => { await request('cancel-sign-in', {}); });
      if (find('disconnectChatGPT')) find('disconnectChatGPT').onclick = () => action('正在退出……', async () => {
        const result = await request('disconnect', {}); await refresh();
        state.message = result.error?.message || '本机已退出。要撤销应用授权，请到 ChatGPT 设置 → 安全与登录 → 登录连接。';
      });
      if (find('chatgptModel')) find('chatgptModel').onchange = e => {
        state.model = e.target.value; try { localStorage.setItem(MODEL_STORE, state.model); } catch {} change();
      };
      if (find('refreshChatGPT')) find('refreshChatGPT').onclick = () => action('正在刷新……', async () => { await refresh(); state.message = '已刷新当前账户的模型列表。'; });
      if (find('testChatGPT')) find('testChatGPT').onclick = () => {
        state.testing = true;
        return action('正在测试，会使用少量 ChatGPT 套餐用量……', async () => {
          try { await controller.call('请只回复：连接成功'); state.message = '连接成功，可以继续推演。'; }
          finally { state.testing = false; }
        });
      };
    }
  };
})(window);
