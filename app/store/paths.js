import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** 所有本机路径集中在这里，别处不拼路径；不引用归档目录。 */
export const PATHS = Object.freeze({
  root: ROOT,
  data: path.join(ROOT, 'data'),
  storeFile: path.join(ROOT, 'data', 'store.json'),
  agentBridgeFile: path.join(ROOT, 'data', '.agent-bridge.json'),
  authDir: path.join(ROOT, 'playwright', '.auth'),
  rulesDir: path.join(ROOT, 'app', 'config', 'site-rules'),
  webDir: path.join(ROOT, 'app', 'web'),
});

export const DEFAULT_PORT = 17860;
