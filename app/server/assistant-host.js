import { constants, createPrivateKey, randomBytes, sign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { ok, err } from '../core/shared/result.js';

const b64 = (value) => Buffer.from(value, 'utf8').toString('base64');
export const assistantHost = (value) => value === 'workbuddy' ? 'workbuddy' : 'codex';

export function workBuddyLink(prompt, { appId, kid, key }) {
  const message = b64(JSON.stringify({
    title: '智能选品助手', description: '在 WorkBuddy 继续选品需求',
    payload: { action: 'start', promptContentBlocks: [{ type: 'text', text: prompt }] },
  }));
  const packet = {
    appId, kid, message, nonce: randomBytes(16).toString('hex'), scene: 'newTask',
    timestamp: String(Math.floor(Date.now() / 1000)),
  };
  // 与 WorkBuddy 官方 PC 示例的七字段签名包一致，message 已经编码。
  const signingText = Object.entries(packet).map(([name, value]) =>
    `${name}=${name === 'message' ? value : b64(value)}`).join('&');
  packet.sig = sign('sha256', Buffer.from(signingText), { key, padding: constants.RSA_PKCS1_PADDING }).toString('base64');
  return `https://workbuddy.cn/app/open-deeplink?${new URLSearchParams(packet)}`;
}

export function createAssistantHost(settings, workspace, env = process.env) {
  const appId = env.AUTO_PICK_WORKBUDDY_APP_ID?.trim();
  const kid = env.AUTO_PICK_WORKBUDDY_KEY_ID?.trim();
  const keyFile = env.AUTO_PICK_WORKBUDDY_KEY_FILE?.trim();
  let key;
  async function status() {
    const { data } = await settings.get();
    const host = assistantHost(data?.assistant_host);
    if (host === 'codex') return ok({ host, mode: 'prefill', workspace });
    if (appId && kid && keyFile && isAbsolute(keyFile)) {
      try {
        key ||= createPrivateKey(await readFile(keyFile));
        if (key.asymmetricKeyType === 'rsa' && key.asymmetricKeyDetails?.modulusLength === 2048) {
          return ok({ host, mode: 'prefill' });
        }
      } catch { /* 密钥文件可能尚未部署 */ }
    }
    return ok({ host, mode: 'manual' });
  }
  async function update(host) {
    if (!['codex', 'workbuddy'].includes(host)) return err('STORAGE_FAILED', '请选择 Codex 或 WorkBuddy', '检查基础配置中的 AI 选项');
    const result = await settings.patch({ assistant_host: host });
    return result?.ok === false ? result : status();
  }
  async function workBuddy(prompt) {
    const { data } = await status();
    if (data.host !== 'workbuddy' || data.mode !== 'prefill') return err('PERMISSION_DENIED', 'WorkBuddy 直连尚未配置', '请先配置开放平台应用和签名密钥');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 1000) {
      return err('STORAGE_FAILED', '选品需求为空或太长', '修改后重新打开 WorkBuddy');
    }
    return ok({ url: workBuddyLink(prompt, { appId, kid, key }) });
  }
  return { status, update, workBuddy };
}
