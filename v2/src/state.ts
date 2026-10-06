import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { TokenUsage } from "./types.js";

/** 累计用量，按模型分桶；只保留最近若干次明细。 */
export interface UsageLedger {
  calls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /** completion 里思维链那部分。推理模型有，可用来算"看不见的花费"。 */
  reasoningTokens: number;
  /** 上游支持时统计的 prompt 缓存命中 token。 */
  cacheHitTokens: number;
  /** 上游没回usage 时的兜底：按字符估的 token 数（英文 ~3.6 字符/token）。 */
  estimatedTotalTokens: number;
  lastAt?: string;
}

interface StoredState {
  nextRunAt: string;
  seenUrls: string[];
  lastError?: string;
  /** 本机 LLM（选片）累计用量。 */
  usage?: UsageLedger;
  /** 最近 30 次明细，按时间倒序。 */
  usageHistory?: Array<TokenUsage & { at: string; model: string }>;
}

const HISTORY_LIMIT = 30;

export class StateStore {
  private state: StoredState = { nextRunAt: new Date(0).toISOString(), seenUrls: [] };

  constructor(private readonly file: string) {}

  async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8")) as StoredState;
      this.state = { ...parsed, usage: parsed.usage, usageHistory: parsed.usageHistory ?? [] };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  isDue(now = new Date()): boolean {
    return now >= new Date(this.state.nextRunAt);
  }

  unseen<T extends { url: string }>(items: T[]): T[] {
    const seen = new Set(this.state.seenUrls);
    return items.filter((item) => !seen.has(item.url));
  }

  async success(url: string, nextRunAt: Date): Promise<void> {
    this.state = {
      ...this.state,
      nextRunAt: nextRunAt.toISOString(),
      seenUrls: [url, ...this.state.seenUrls.filter((item) => item !== url)].slice(0, 500)
    };
    delete this.state.lastError;
    await this.save();
  }

  async failure(error: unknown, nextRunAt: Date): Promise<void> {
    this.state.nextRunAt = nextRunAt.toISOString();
    this.state.lastError = error instanceof Error ? error.message : String(error);
    await this.save();
  }

  /** 记一次 LLM 调用用量，并累计。 */
  async recordUsage(model: string, usage: TokenUsage): Promise<UsageLedger> {
    const estimated = Math.round(usage.promptChars / 3.6) + Math.round(usage.completionChars / 1.8);
    const ledger: UsageLedger = {
      calls: (this.state.usage?.calls ?? 0) + 1,
      promptTokens: (this.state.usage?.promptTokens ?? 0) + (usage.promptTokens ?? 0),
      completionTokens: (this.state.usage?.completionTokens ?? 0) + (usage.completionTokens ?? 0),
      totalTokens: (this.state.usage?.totalTokens ?? 0) + (usage.totalTokens ?? 0),
      reasoningTokens: (this.state.usage?.reasoningTokens ?? 0) + (usage.reasoningTokens ?? 0),
      cacheHitTokens: (this.state.usage?.cacheHitTokens ?? 0) + (usage.cacheHitTokens ?? 0),
      estimatedTotalTokens: (this.state.usage?.estimatedTotalTokens ?? 0) + estimated,
      lastAt: new Date().toISOString()
    };
    this.state.usage = ledger;
    this.state.usageHistory = [
      { ...usage, at: new Date().toISOString(), model },
      ...(this.state.usageHistory ?? [])
    ].slice(0, HISTORY_LIMIT);
    await this.save();
    return ledger;
  }

  private async save(): Promise<void> {
    await mkdir(path.dirname(path.resolve(this.file)), { recursive: true });
    await writeFile(this.file, JSON.stringify(this.state, null, 2), { encoding: "utf8", mode: 0o600 });
  }
}
