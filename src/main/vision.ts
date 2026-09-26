import type { VisionRequest, VisionResult } from '../shared/protocol';

/**
 * 视觉大模型那一问，放在主进程发。
 *
 * 界面里直接 fetch 是不行的：渲染进程的 CSP 只允许 connect-src 'self'，
 * 请求根本出不去，报回来的是一句"Failed to fetch"，看着像接口地址写错了。
 * 主进程走 Chromium 自己的网络栈（net.fetch），没有 CSP 也没有跨域限制，
 * 系统代理和证书也照常生效。
 */

/** 让模型只吐棋盘。行数、每行几个字符都写死，后面按这个校验。 */
export function visionPrompt(size: number): string {
  return `这是一张围棋棋盘的照片或截图。棋盘是 ${size} 路。请只输出 ${size} 行，每行 ${size} 个字符，用 . 表示空点，X 表示黑子，O 表示白子，不要任何解释和多余文字。`;
}

/** 拼一个 OpenAI 兼容的 chat/completions 请求体。 */
export function visionBody(req: VisionRequest): Record<string, unknown> {
  return {
    model: String(req.model ?? '').trim(),
    temperature: 0,
    // 有的模型会先吐一大段思考过程，不划上限的话正文可能被截没
    max_tokens: 4000,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: visionPrompt(req.size) },
          { type: 'image_url', image_url: { url: req.imageDataUrl } }
        ]
      }
    ]
  };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface VisionOptions {
  fetchImpl?: FetchLike;
  timeoutMs?: number;
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * 发给视觉大模型，把它的正文取回来。
 *
 * 失败时尽量把"到底哪儿不对"带回去：连不上、超时、HTTP 状态码加服务端原话、
 * 返回的不是 JSON、返回了但没有正文，各是各的说法。
 */
export async function visionChat(req: VisionRequest, opts: VisionOptions = {}): Promise<VisionResult> {
  const endpoint = String(req.endpoint ?? '').trim();
  const apiKey = String(req.apiKey ?? '').trim();
  if (!endpoint) return { ok: false, error: '接口地址是空的' };
  if (!apiKey) return { ok: false, error: '密钥是空的' };
  if (!req.imageDataUrl) return { ok: false, error: '没有图片' };
  const doFetch: FetchLike = opts.fetchImpl ?? ((url, init) => fetch(url, init));

  let res: Response;
  try {
    res = await doFetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(visionBody(req)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 120000)
    });
  } catch (e) {
    const msg = message(e);
    return { ok: false, error: /abort|timed? ?out/i.test(msg) ? `等了 ${Math.round((opts.timeoutMs ?? 120000) / 1000)} 秒没等到回应` : msg };
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    return { ok: false, status: res.status, error: `接口返回 ${res.status}`, body: text.slice(0, 300) || res.statusText };
  }
  let json: { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> };
  try {
    json = JSON.parse(text) as typeof json;
  } catch {
    return { ok: false, error: '接口返回的不是 JSON', body: text.slice(0, 300) };
  }
  const choice = json.choices?.[0];
  const content = (choice?.message?.content ?? '').trim();
  if (!content) {
    return {
      ok: false,
      error: choice?.finish_reason === 'length' ? '接口把回答截断了，没有正文' : '接口没有返回正文',
      body: text.slice(0, 300)
    };
  }
  return { ok: true, content };
}
