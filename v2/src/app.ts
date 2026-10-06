import { createDelivery, renderFinding } from "./delivery.js";
import { discover } from "./discovery.js";
import { createProvider } from "./providers.js";
import { clipTurn, formatRecentContext, loadRecentFromSerein } from "./recent.js";
import { nextRun, retryAt } from "./schedule.js";
import { StateStore } from "./state.js";
import type { AppConfig, RecentContext } from "./types.js";

export class SurfApp {
  private readonly state: StateStore;

  constructor(private readonly config: AppConfig) {
    this.state = new StateStore(config.stateFile);
  }

  async start(): Promise<void> {
    await this.state.load();
  }

  /** 读他最近自己说的话，用来给这一轮选片定方向。读不到就当没有。 */
  private async loadRecent(): Promise<RecentContext> {
    if (!this.config.sereinDbPath) return { turnsText: "", count: 0 };
    const turns = await loadRecentFromSerein(this.config.sereinDbPath, this.config.recentLimit);
    const clipped = turns.map((turn) => clipTurn(turn, this.config.recentClipChars));
    return { turnsText: formatRecentContext(clipped), count: clipped.length };
  }

  async run(force = false): Promise<boolean> {
    const now = new Date();
    if (!force && !this.state.isDue(now)) return false;
    try {
      const found = await discover(this.config);
      const available = this.state.unseen(found);
      const pool = available.length ? available : found;
      // 交错取样后各源已均匀分布，这里按配置上限截断即可。
      const candidates = pool.slice(0, this.config.candidateLimit);
      const recent = await this.loadRecent();
      console.log(`[surf] 候选 ${candidates.length} 条，最近原文 ${recent.count} 条`);
      const selection = await createProvider(this.config).select(candidates, recent);
      const candidate = candidates[selection.index];
      const finding = { candidate, note: selection.summary };
      await createDelivery(this.config).send(finding);
      // 日志打完整装配 + 分段计数。之前这里 slice(0,200)，而标题+网址+原图
      // 就吃满 230 字符，摘要排在第231 字之后被整段切掉，看着像"摘要丢了"。
      const rendered = renderFinding(finding);
      console.log(
        `[surf] 已投递（${rendered.length} 字）：\n` +
        `  标题 ${finding.candidate.title.length} · 网址 ${finding.candidate.url.length} · ` +
        `原图 ${(finding.candidate.image ?? "").length} · 摘要 ${finding.note.length}\n` +
        `  装配全文：${rendered}`
      );
      if (selection.usage) {
        const u = selection.usage;
        const ledger = await this.state.recordUsage(this.config.openai.model, u);
        const fmt = (n?: number) => (n === undefined ? "未返回" : String(n));
        const visible = u.completionTokens !== undefined && u.reasoningTokens !== undefined
          ? u.completionTokens - u.reasoningTokens
          : undefined;
        console.log(
          `[surf] token 用量：prompt ${fmt(u.promptTokens)} + completion ${fmt(u.completionTokens)}` +
          ` = ${fmt(u.totalTokens)}` +
          (u.reasoningTokens !== undefined
            ? `（其中思维链 ${u.reasoningTokens}，实际可见输出 ${visible ?? "?"}）`
            : "") +
          (u.cacheHitTokens ? ` · 缓存命中 ${u.cacheHitTokens}` : "") +
          `\n[surf] 实测：提示词 ${u.promptChars} 字符 / 摘要 ${u.completionChars} 字符 · ${u.elapsedMs}ms`
        );
        console.log(
          `[surf] 累计：${ledger.calls} 次调用 · 总 token ${ledger.totalTokens}` +
          `（输入 ${ledger.promptTokens} / 输出 ${ledger.completionTokens}）· 按字符估 ${ledger.estimatedTotalTokens}`
        );
      }
      await this.state.success(candidate.url, nextRun(
        now,
        this.config.timezone,
        this.config.dayStartHour,
        this.config.dayEndHour,
        this.config.minIntervalHours,
        this.config.maxIntervalHours
      ));
      return true;
    } catch (error) {
      await this.state.failure(error, retryAt(now));
      // 跑空也要回报给桥：桥会包成「刚才想去翻点东西，没翻成（…）」走独处通知。
      // 不回报 = 这一轮静默消失，看起来像"什么都没发生"。
      const message = error instanceof Error ? error.message : String(error);
      try {
        await createDelivery(this.config).reportFailure(message);
      } catch (reportError) {
        console.error(`[surf] 失败回报也失败了：${reportError instanceof Error ? reportError.message : String(reportError)}`);
      }
      throw error;
    }
  }
}