import type { AppConfig, DeliveryChannel, SurfFinding } from "./types.js";

/** 产物小标题。裸行，**不能带【】** —— 见下方硬约束第 4 条。 */
export const FINDING_HEAD = "之前独处冲浪时发现的东西：";

/**
 * 产物格式（自留地投喂用），由积温侧拼进 notice：
 *   之前独处冲浪时发现的东西：
 *   《标题》
 *   原网址
 *   原图（若有）
 *   脱水摘要
 *
 * ⚠️ 硬约束（积温 / Serein 侧依赖，改动前先看 jiwen-bridge/_test/文案草稿-研究结论.md）：
 *   1. **必须多行**。下游 Serein 的剥离按行判定，压成单行会让整块被吞 ——
 *      连她紧随其后的原话一起没。
 *   2. title 里的换行要压掉。
 *   3. image 为空就整项略掉，不留空壳。
 *   4. **整段不得出现【】**。Serein 见到任何行首【X】都会重算块跳过态：
 *      · 内层小标题若带【】且不在它的白名单里 → 跳过态提前关闭 → 产物整段泄漏进归档；
 *      · 产物里的标题若带【】同理。
 *      所以这里统一剥掉。
 */
export function renderFinding(finding: SurfFinding): string {
  const { candidate, note } = finding;
  const lines: string[] = [FINDING_HEAD];
  const title = sanitize(candidate.title);
  if (title) lines.push(title);
  if (candidate.url) lines.push(sanitize(candidate.url));
  if (candidate.image) lines.push(sanitize(candidate.image));
  const body = sanitize(note);
  if (body) lines.push(body);
  return lines.join("\n");
}

/** 压掉换行、剥掉【】，防止被下游误判成块标记。 */
export function sanitize(value: string): string {
  return (value || "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/【/g, "")
    .replace(/】/g, "")
    .trim();
}

class ConsoleDelivery implements DeliveryChannel {
  async send(finding: SurfFinding): Promise<void> {
    console.log(`\n${finding.note}\n\n${finding.candidate.title}\n${finding.candidate.url}\n`);
    if (finding.candidate.image) console.log(`${finding.candidate.image}\n`);
  }

  async reportFailure(error: string): Promise<void> {
    console.log(`\n[surf] 本轮跑空：${error}\n`);
  }
}

/**
 * 交给积温桥，不自己投递。
 * 必须走积温：回环认领表（lib/loopback.js）只在积温进程里，
 * 绕过去投会让积温把这条当成她的发言 —— 踩三个坑。
 */
class JiwenDelivery implements DeliveryChannel {
  constructor(private readonly config: AppConfig) {}

  private async post(payload: Record<string, unknown>): Promise<void> {
    const url = `${this.config.jiwenBaseUrl.replace(/\/$/, "")}${this.config.jiwenFindingPath}`;
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.config.jiwenToken}`
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    if (!response.ok) {
      throw new Error(`jiwen bridge HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    }
  }

  async send(finding: SurfFinding): Promise<void> {
    await this.post({
      ok: true,
      scene: "surf_finding",
      source: finding.candidate.source,
      title: sanitize(finding.candidate.title),
      url: sanitize(finding.candidate.url),
      image: sanitize(finding.candidate.image ?? ""),
      note: sanitize(finding.note)
    });
  }

  /** 跑空也要回报 —— 否则桥侧收不到任何东西，这一轮静默消失。 */
  async reportFailure(error: string): Promise<void> {
    await this.post({ ok: false, scene: "surf_finding", error: sanitize(error).slice(0, 200) });
  }
}

class TelegramDelivery implements DeliveryChannel {
  constructor(private readonly config: AppConfig) {}

  async send(finding: SurfFinding): Promise<void> {
    const { candidate, note } = finding;
    const text = `${note}\n\n${candidate.title}\n${candidate.url}`;
    const res = await fetch(`https://api.telegram.org/bot${this.config.telegram.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: this.config.telegram.chatId, text, disable_web_page_preview: false }),
      signal: AbortSignal.timeout(this.config.timeoutMs)
    });
    if (!res.ok) throw new Error(`telegram HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  async reportFailure(error: string): Promise<void> {
    // telegram 通道不并入积温，跑空就地记日志。
    console.log(`[surf] 跑空：${error}`);
  }
}

export function createDelivery(config: AppConfig): DeliveryChannel {
  if (config.deliveryChannel === "jiwen") return new JiwenDelivery(config);
  if (config.deliveryChannel === "telegram") return new TelegramDelivery(config);
  return new ConsoleDelivery();
}