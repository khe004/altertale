import { createChatGPT } from '@siwc/local';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { systemEncryption } from './chatgpt-keychain.mjs';

export const usageURL = 'https://chatgpt.com/settings/usage';
const messages = {
  subscription_sharing_usage_limit_exceeded: '已达到 ChatGPT 套餐或本应用的用量限额，请在 ChatGPT 设置 → 用量查看重置时间与应用限额。',
  subscription_sharing_user_not_eligible: '当前 ChatGPT 账户或工作区不支持套餐用量共享，请确认登录了你的 Plus 账户。',
  sharing_not_enabled: '尚未授权使用 ChatGPT 套餐，请点击“授权使用套餐”重新登录并勾选对应权限。',
  not_connected: '请先登录 ChatGPT。',
  reauth_required: 'ChatGPT 登录已过期，请重新登录。',
  encryption_unavailable: '系统钥匙串不可用，请解锁钥匙串后重试。Linux 需要可用的 Secret Service。',
  storage_encryption_unavailable: '系统钥匙串不可用，请解锁钥匙串后重试。保存的登录凭证已保留。',
  revocation_failed: '本机登录已清除，但未能确认远端撤销。请到 ChatGPT 设置 → 安全与登录 → 登录连接撤销本应用。',
  storage_decryption_failed: '无法解密保存的登录，请检查原来的系统钥匙串。',
  model_not_found: '这个模型当前不可用，请刷新模型列表后重新选择。',
  cancelled: '已取消。',
  access_denied: '你取消了登录或授权，可以稍后重试。',
  network_error: '无法连接 OpenAI，请检查网络后重试。',
  stream_interrupted: '模型连接中断，本次结果尚未完成，可以重试。',
  response_incomplete: '模型未完成本次推演，可以重试。',
  empty_completion: '模型没有返回正文，请重试。',
  sign_in_in_progress: '登录正在进行，请先完成或取消。',
  busy: '已有推演正在进行，请等它完成或取消。',
  invalid_request: '推演请求格式不正确。'
};

export function publicError(error) {
  // SDK errors carry safe codes. Never forward arbitrary upstream/native error
  // messages, stacks, tokens, or submitted prompts to the page.
  const candidate = String(error?.code || 'connection_error');
  const code = /^[a-zA-Z0-9_]{1,100}$/.test(candidate) ? candidate : 'connection_error';
  let message = messages[code];
  if (!message && code.includes('usage_limit_exceeded')) message = messages.subscription_sharing_usage_limit_exceeded;
  if (!message && error?.status === 429) message = '请求过于频繁，请稍后重试，并检查 ChatGPT 设置 → 用量。';
  if (!message && ['stream_interrupted', 'stream_incomplete', 'invalid_stream'].includes(code)) message = messages.stream_interrupted;
  return { code, message: message || 'ChatGPT 未能完成请求。请重试；若持续失败，请检查登录、授权与网络。',
    ...(Number.isInteger(error?.status) ? { status: error.status } : {}) };
}

export async function makeRuntime() {
  // No access to Codex's credentials and no API key provisioning. This app gets
  // its own registration only after the user clicks Continue with ChatGPT.
  return createChatGPT({ appName: '天命未定 · AlterTale', appId: 'altertale',
    redirectPort: 0, sendHostId: true,
    storageDir: join(homedir(), '.config', 'altertale', 'chatgpt'),
    credentialEncryption: await systemEncryption() });
}
