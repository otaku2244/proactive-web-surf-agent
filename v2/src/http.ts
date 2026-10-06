export async function fetchJson<T>(url: string, init: RequestInit, timeoutMs: number): Promise<T> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}: ${detail}`);
  }
  return response.json() as Promise<T>;
}

/** 取文本用（RSS / Atom 这类非 JSON 源）。错误处理与 fetchJson 一致。 */
export async function fetchText(url: string, init: RequestInit, timeoutMs: number): Promise<string> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 200);
    throw new Error(`HTTP ${response.status} from ${new URL(url).host}: ${detail}`);
  }
  return response.text();
}
