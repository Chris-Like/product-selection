import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import test from 'node:test';
import { createAssistantHost, workBuddyLink } from '../../app/server/assistant-host.js';
import { ok } from '../../app/core/shared/result.js';

test('宿主选择保存，已有配置默认 Codex，WorkBuddy 缺少注册配置时提示复制', async () => {
  const settings = {};
  const service = createAssistantHost({
    get: async () => ok(settings),
    patch: async (delta) => { Object.assign(settings, delta); return ok(settings); },
  }, 'C:/example/auto-pick-studio', {});
  assert.deepEqual((await service.status()).data, { host: 'codex', mode: 'prefill', workspace: 'C:/example/auto-pick-studio' });
  assert.equal((await service.update('bad')).ok, false);
  assert.deepEqual((await service.update('workbuddy')).data, { host: 'workbuddy', mode: 'manual' });
  assert.equal(settings.assistant_host, 'workbuddy');
  assert.equal((await service.workBuddy('20 元以内的文具')).ok, false);
});

test('WorkBuddy 预填链接保留中文需求且签名可用公钥验证', () => {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const url = new URL(workBuddyLink('20 元以内的文具 + 便签', { appId: 'demo', kid: 'k1', key: privateKey }));
  assert.equal(url.origin + url.pathname, 'https://workbuddy.cn/app/open-deeplink');
  const fields = Object.fromEntries(url.searchParams);
  const { payload } = JSON.parse(Buffer.from(fields.message, 'base64').toString('utf8'));
  assert.equal(payload.promptContentBlocks[0].text, '20 元以内的文具 + 便签');
  assert.match(fields.nonce, /^[a-f0-9]{32}$/);
  const signed = ['appId', 'kid', 'message', 'nonce', 'scene', 'timestamp'].map((field) =>
    `${field}=${field === 'message' ? fields[field] : Buffer.from(fields[field]).toString('base64')}`).join('&');
  assert.equal(verify('sha256', Buffer.from(signed), publicKey, Buffer.from(fields.sig, 'base64')), true);
});
