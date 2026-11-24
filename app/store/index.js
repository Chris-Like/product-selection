import { PATHS } from './paths.js';
import { createFileStore } from './file-store.js';
import { assertContract } from '../core/repository/interface.js';

/** 新形态新增的 4 个仓储契约；原 9 个契约一字不改（D3=B′ 后不再有凭据仓储）。 */
export const EXTENDED_CONTRACT = Object.freeze({
  SiteRepository: ['list', 'get', 'enabled', 'add', 'update', 'softDelete', 'restore'],
  AuthStateRepository: ['pathFor', 'exists', 'meta', 'setMeta'],
  TaskRepository: ['get', 'set', 'patch'],
  RunRepository: ['upsert', 'list', 'latest', 'find'],
  AnalysisRepository: ['get', 'set', 'list'],
});

/** @param {Object} repos */
export function assertExtendedContract(repos) {
  const missing = [];
  for (const [name, methods] of Object.entries(EXTENDED_CONTRACT)) {
    if (!repos[name]) { missing.push(`缺少 ${name}`); continue; }
    for (const m of methods) if (typeof repos[name][m] !== 'function') missing.push(`${name}.${m}`);
  }
  return { ok: missing.length === 0, missing };
}

/** 唯一组装点：文件库 → 载入 → 双契约自检（D3=B′：不再生成主密钥、不读密码密文）。 */
export async function createRepositories(paths = PATHS) {
  const store = createFileStore({ paths });
  await store.ready();
  const base = assertContract(store);
  const ext = assertExtendedContract(store);
  if (!base.ok || !ext.ok) {
    throw new Error(`仓储契约未通过：${[...base.missing, ...ext.missing].join(', ')}`);
  }
  return store;
}

export { PATHS };
