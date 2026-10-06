import type { Candidate } from "./types.js";

/**
 * 「最近原文」——他独处时脑子里已经装着的东西。
 *
 * 用途：让选片有连续性。他上一轮刚跟椰工聊完什么，这一轮伸手出去时就从
 * 那个方向摸过去，而不是每次都从零开始随机撞。
 *
 * 数据源：Serein 的 raw_events（sqlite 只读）。Serein 停在 18217，桥在 18220，
 * 这里直读库不走 HTTP —— Serein 的 /v1/host/messages/search 要鉴权且 deploy/.env
 * 里没有 token，直读更省事（同机、只读连接）。
 */

export interface RecentTurn {
  role: "user" | "assistant";
  text: string;
}

/**
 * 取最近的 assistant 发言（Harlan 自己说的话），按 created_at 倒序。
 * 取不到就返回空数组 —— 原文是加分项，不该让整轮冲浪失败。
 */
export async function loadRecentFromSerein(dbPath: string, limit: number): Promise<RecentTurn[]> {
  if (!dbPath) return [];
  try {
    // node:sqlite 在 Node 22 是实验特性。用动态 import 而非 require（ESM 里没有 require）。
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db
        .prepare(
          "SELECT text FROM raw_events WHERE role = 'assistant' ORDER BY created_at DESC LIMIT ?"
        )
        .all(Math.max(1, limit)) as Array<{ text: string | null }>;
      return rows
        .map((row) => ({ role: "assistant" as const, text: String(row.text ?? "") }))
        .filter((turn) => turn.text.trim().length > 0);
    } finally {
      db.close();
    }
  } catch (error) {
    console.warn(
      `[surf] 读取 Serein 最近原文失败（本轮仍会冲浪）: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    return [];
  }
}

/** 单条截断：太长的发言会挤爆选片提示词。按句断开，避免半句进提示词。 */
export function clipTurn(turn: RecentTurn, maxChars = 400): RecentTurn {
  if (turn.text.length <= maxChars) return turn;
  const cut = turn.text.slice(0, maxChars);
  const stop = Math.max(cut.lastIndexOf("。"), cut.lastIndexOf(". "), cut.lastIndexOf("！"));
  return { ...turn, text: (stop > maxChars * 0.5 ? cut.slice(0, stop + 1) : cut).trim() };
}

/** 拼成提示词里的「他最近的原话」段落。没有原文时返回空串（那一段整个不出现）。 */
export function formatRecentContext(turns: RecentTurn[]): string {
  if (!turns.length) return "";
  const lines = turns.map((turn, index) => `[${index + 1}] ${turn.text.replace(/\s+/g, " ")}`);
  return (
    "这是你最近自己说过的话，最新在前。它是你现在带着的底色，" +
    "用来判断这一次伸手出去该往哪个方向摸——不是复述它们，是接着它们往下想。\n" +
    `${lines.join("\n")}\n`
  );
}

/** 冲浪产出：一条候选 + 模型写的脱水摘要。 */
export interface SurfFinding {
  candidate: Candidate;
  note: string;
}