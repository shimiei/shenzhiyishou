/**
 * 会话文件：关掉程序时开着的那几盘棋，下次打开照着重建（userData/session.json）。
 *
 * 这份只是现场快照，不参与任何判断：读不出来（文件坏了、版本对不上、格式换过）就当没有，
 * 界面照常开一盘空棋。所以这里不校验、不备份，坏了删掉就是。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { sessionFile } from './paths';

export function loadSession(): unknown {
  try {
    if (!existsSync(sessionFile())) return null;
    return JSON.parse(readFileSync(sessionFile(), 'utf8')) as unknown;
  } catch {
    return null;
  }
}

export function saveSession(data: unknown): void {
  try {
    mkdirSync(path.dirname(sessionFile()), { recursive: true });
    writeFileSync(sessionFile(), JSON.stringify(data), 'utf8');
  } catch {
    // 写不进去（磁盘满、目录没权限）不该影响下棋，下次改动还会再试一遍
  }
}
