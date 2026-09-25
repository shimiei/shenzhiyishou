/**
 * 地址栏输入怎么理解。纯函数，好在 Node 里断言。
 *
 * 用户在地址栏里敲的东西有三种：完整地址、看着像域名的东西、以及想搜的词。
 * "220.205.16.22:39681" 这种没有协议的也要能直接打开，不然自己的服务器每次都得补 http://。
 */
export function normalizeUrl(raw: string): string {
  const target = raw.trim();
  if (!target) return '';
  if (/^[a-z]+:\/\//i.test(target)) return target;
  // about:、file: 这类没有 // 的协议原样放行
  if (/^(about|file|data|chrome|view-source):/i.test(target)) return target;
  // 主机名后面可以跟端口、路径：localhost:5199、online-go.com、b22.talk.kgs
  const looksLikeUrl = /^([\w-]+(\.[\w-]+)+|localhost)(:\d+)?(\/|$|\?|#)/i.test(target);
  return looksLikeUrl ? 'http://' + target : 'https://www.bing.com/search?q=' + encodeURIComponent(target);
}
