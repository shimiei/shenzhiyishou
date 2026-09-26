/**
 * 验收用的"外面那个客户端"：一个独立进程里的普通窗口，里面装着那张假棋盘页。
 *
 * 它扮演的就是程序外面那个窗口：主进程读它的位置、按窗口抓它的画面、往它上面真点鼠标。
 * 驱动通过标准输入给它下命令：
 *   move <x> <y> <w> <h>   挪窗口（验收"窗口挪了位置还认不认得出"）
 *   info                   报一次自己的几何
 *   quit                   退出
 * 它自己一行行往外报 JSON，驱动拿它跟自己那套 Win32 读数对照。
 *
 * 用法：node_modules/electron/dist/electron.exe tools/fake-client/main.js --title=… --bounds=x,y,w,h --query=…
 */
const { app, BrowserWindow } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const readline = require('node:readline');
const { execFile } = require('node:child_process');

const argv = process.argv.slice(2);
const args = new Map();
for (const a of argv) {
  if (!a.startsWith('--')) continue;
  const i = a.indexOf('=');
  if (i < 0) args.set(a.slice(2), '1');
  else args.set(a.slice(2, i), a.slice(i + 1));
}

const query = args.get('query') || 'start=empty&bare=1&px=560';
// loadFile 会把 ? 转义掉，带上查询串的地址得自己拼成 file:// 交给 loadURL
const page = pathToFileURL(path.join(__dirname, '..', 'browser-board-test.html')).href + '?' + query;
const bounds = (args.get('bounds') || '80,80,900,760').split(',').map(Number);

function say(line) {
  process.stdout.write(JSON.stringify(line) + '\n');
}

app.whenReady().then(() => {
  // --quiet：别抢前台、别盖住用户正开着的东西。验收常在用户用着电脑的时候跑，
  // 这个窗口只要"存在且能被抓到"就够了，出不出现在人眼前无所谓。
  const quiet = args.has('quiet');
  const win = new BrowserWindow({
    x: bounds[0],
    y: bounds[1],
    width: bounds[2],
    height: bounds[3],
    title: args.get('title') || 'SZYS 假客户端',
    autoHideMenuBar: true,
    backgroundColor: '#eceff4',
    show: !quiet,
    webPreferences: { contextIsolation: true, nodeIntegration: false }
  });
  if (quiet) {
    win.showInactive();
    // 刚显示的窗口会跑到最上面，压到用户那个窗口上；压回最底层去
    const raw = win.getNativeWindowHandle();
    const hwnd = (raw.length >= 8 ? raw.readBigInt64LE() : BigInt(raw.readUInt32LE(0))).toString();
    const ps =
      'Add-Type @\'using System;using System.Runtime.InteropServices;public class Z{' +
      '[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int t,uint f);}\'@;' +
      '[Z]::SetWindowPos([IntPtr]' + hwnd + ',[IntPtr]1,0,0,0,0,0x13) | Out-Null';
    execFile('powershell', ['-NoProfile', '-Command', ps], () => {});
  }
  const info = () => {
    if (win.isDestroyed()) return;
    say({
      ok: true,
      type: 'info',
      bounds: win.getBounds(),
      content: win.getContentBounds(),
      focused: win.isFocused()
    });
  };
  win.webContents.on('did-finish-load', () => say({ ok: true, type: 'loaded' }));
  void win.loadURL(page);
  // 页面标题会成为窗口标题，也让下面这一行报出来，驱动好按名字找窗口
  win.on('page-title-updated', () => say({ ok: true, type: 'title', title: win.getTitle() }));
  setTimeout(info, 900);

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const parts = line.trim().split(/\s+/);
    const cmd = parts[0];
    if (cmd === 'move') {
      const [x, y, w, h] = parts.slice(1).map(Number);
      win.setBounds({ x, y, width: w, height: h });
      setTimeout(info, 300);
    } else if (cmd === 'size') {
      const [w, h] = parts.slice(1).map(Number);
      const b = win.getBounds();
      win.setBounds({ x: b.x, y: b.y, width: w, height: h });
      setTimeout(info, 300);
    } else if (cmd === 'info') {
      info();
    } else if (cmd === 'quit') {
      app.quit();
    }
  });
  app.on('window-all-closed', () => app.quit());
  say({ ok: true, type: 'ready', pid: process.pid });
});
