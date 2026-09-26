/**
 * 从 /json/list 里挑出应用主页面那个 CDP 目标。几个工具与验收驱动都用它。
 *
 * 为什么不能"挑第一个 page"或"挑第一个 file:"：程序里还有一个落点叠层窗口，
 * 它也是一个 file: 页面目标（overlay.html），只要标过一次点就一直在，直到程序退出。
 * 按前两种挑法会挑到叠层上，那边没有 __szys，报出来是一句莫名其妙的
 * "Cannot read properties of undefined (reading 'getState')"。所以一律按 index.html 认。
 *
 * 想挑别的目标时给 CDP_TARGET（按 url 或标题匹配），它优先。
 */
export async function fetchTargets(port) {
  return (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json());
}

export function pickAppPage(list, hint = process.env.CDP_TARGET) {
  if (hint) {
    const hit = list.find((t) => (t.url + t.title).includes(hint));
    if (!hit) {
      throw new Error(
        '没有匹配 ' + hint + ' 的目标，现有：' + list.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join(' | ')
      );
    }
    return hit;
  }
  const page = list.find((t) => t.type === 'page' && t.url.includes('index.html'));
  if (!page) {
    throw new Error('没找到应用主页面，现有：' + list.map((t) => `${t.type} ${t.url.slice(0, 60)}`).join(' | '));
  }
  return page;
}
