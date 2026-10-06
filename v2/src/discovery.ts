import { fetchText } from "./http.js";
import type { AppConfig, Candidate } from "./types.js";

/**
 * 源分两类：
 *   feed 型（Aeon / Psyche / ArchDaily）—— 给最新内容，不需要关键词
 *   搜索型（arXiv）—— 关键词就是分类代码本身
 *
 * 所以 DISCOVERY_TOPICS 对 feed 型不生效（它们不搜），对 arXiv 生效。
 */

const RSS_HEADERS = {
  accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
  "user-agent": "proactive-web-surf-agent-v2",
};

// ── RSS / Atom 解析 ──────────────────────────────────────────────

interface FeedItem {
  title: string;
  link: string;
  summary: string;
  published: number;
  image: string;
}

function stripCdata(s: string): string {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function decodeEntities(s: string): string {
  return s
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function pick(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return null;
  const v = decodeEntities(stripCdata(m[1]));
  return v || null;
}

/** Atom 的 <link href="..."/> 与 RSS 的 <link>...</link> 两种形态都要认。 */
function pickLink(block: string): string {
  const href = block.match(/<link[^>]*href="([^"]+)"/i);
  if (href) return href[1].trim();
  const plain = pick(block, "link");
  if (plain) return plain;
  const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i);
  if (guid) {
    const g = decodeEntities(stripCdata(guid[1]));
    if (/^https?:\/\//.test(g)) return g;
  }
  return "";
}

function pickDate(block: string): number {
  for (const tag of ["pubDate", "published", "updated", "dc:date"]) {
    const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
    if (!m) continue;
    const t = Date.parse(stripCdata(m[1]).trim());
    if (!Number.isNaN(t)) return t;
  }
  return 0;
}

/**
 * 原图：RSS 的 media:content / media:thumbnail / enclosure，
 * 退化时从 description 里的第一个 <img src> 取。
 * 实测 Aeon / Psyche / ArchDaily 三源命中率 100%，arXiv 无图。
 */
function pickImage(block: string): string {
  const tagged = block.match(/<(?:media:(?:content|thumbnail)|enclosure)[^>]*url="([^"]+)"/i);
  if (tagged) return tagged[1].trim();
  const img = block.match(/<img[^>]*src="([^"]+)"/i);
  return img ? img[1].trim() : "";
}

function parseFeed(xml: string): FeedItem[] {
  const chunks = xml.split(/<item[\s>]/i);
  const blocks = chunks.length > 1 ? chunks.slice(1) : xml.split(/<entry[\s>]/i).slice(1);
  const out: FeedItem[] = [];
  for (const b of blocks) {
    const title = pick(b, "title");
    const link = pickLink(b);
    if (!title || !link) continue;
    out.push({
      title,
      link,
      summary: pick(b, "description") ?? pick(b, "summary") ?? pick(b, "content") ?? "",
      published: pickDate(b),
      image: pickImage(b),
    });
  }
  return out;
}

/**
 * 摘要不再截断。
 *
 * 原来按 320 字符截（按句断开），实测四源长度分布差异极大：
 *   Aeon     中位 151 / 最长 175
 *   Psyche   中位 154 / 最长 212
 *   ArchDaily 中位 562 / 最长 1021
 *   arXiv    中位 1524 / 最长 1903
 * 320 这个上限会把 ArchDaily 砍掉近一半、arXiv 砍到只剩开头一句
 *（arXiv 的 abstract 本来就是一段完整论述，砍半就等于没给内容）。
 * 16 条交错全量进提示词实测 12291 字符 ≈ 3400 token，负担可接受。
 */

// ── 源实现 ───────────────────────────────────────────────────────

/** Aeon 长随笔。用 /essays.rss 而不是 /feed.rss —— 后者混着 videos。 */
async function aeonEssays(topic: string, config: AppConfig): Promise<Candidate[]> {
  const xml = await fetchText("https://aeon.co/essays.rss", { headers: RSS_HEADERS }, config.timeoutMs);
  return parseFeed(xml).map((i) => ({
    source: "Aeon Essays",
    title: i.title,
    url: i.link,
    summary: i.summary,
    image: i.image,
    _t: i.published,
  }));
}

/** Psyche 混合 feed。按路径只留 ideas（长文），剔掉 videos/guides/notes 等。 */
async function psycheIdeas(topic: string, config: AppConfig): Promise<Candidate[]> {
  const xml = await fetchText("https://psyche.co/feed.rss", { headers: RSS_HEADERS }, config.timeoutMs);
  return parseFeed(xml)
    .filter((i) => /psyche\.co\/(ideas|essay|essays)\//i.test(i.link))
    .map((i) => ({
      source: "Psyche Ideas",
      title: i.title,
      url: i.link,
      summary: i.summary,
      image: i.image,
      _t: i.published,
    }));
}

/** ArchDaily 建筑方案与空间实录。 */
async function archDaily(topic: string, config: AppConfig): Promise<Candidate[]> {
  const xml = await fetchText("https://www.archdaily.com/feed/rss", { headers: RSS_HEADERS }, config.timeoutMs);
  return parseFeed(xml).map((i) => ({
    source: "ArchDaily",
    title: i.title,
    url: i.link,
    summary: i.summary,
    image: i.image,
    _t: i.published,
  }));
}

/**
 * arXiv 按分类检索。
 * topic 传 `cs.CY` 或直接传 `cat:cs.CY` 都认；含冒号则原样当查询用。
 */
async function arxiv(topic: string, config: AppConfig): Promise<Candidate[]> {
  const raw = (topic || "cs.CY").trim();
  const q = raw.includes(":") ? raw : `cat:${raw}`;
  const url =
    `http://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}` +
    `&start=0&max_results=8&sortBy=submittedDate&sortOrder=descending`;
  const xml = await fetchText(
    url,
    { headers: { ...RSS_HEADERS, accept: "application/atom+xml" } },
    config.timeoutMs
  );
  return parseFeed(xml).map((i) => ({
    source: "arXiv",
    title: i.title,
    url: i.link.replace(/^http:/, "https:"),
    summary: i.summary,
    image: i.image,
    _t: i.published,
  }));
}

type SourceFn = (topic: string, config: AppConfig) => Promise<Candidate[]>;

const SOURCES: Record<string, SourceFn> = {
  aeon: aeonEssays,
  psyche: psycheIdeas,
  archdaily: archDaily,
  arxiv,
};

/** feed 型源不搜，跑一次即可（否则会按 topic 重复抓同一份 feed）。 */
const FEED_SOURCES = new Set(["aeon", "psyche", "archdaily"]);

// ── 编排 ─────────────────────────────────────────────────────────

type Stamped = Candidate & { _t?: number };

/** feed 给的顺序不可信，按发布时间倒序自己排一遍。 */
function byFreshness(items: Candidate[]): Stamped[] {
  return (items as Stamped[]).slice().sort((a, b) => (b._t ?? 0) - (a._t ?? 0));
}

/**
 * 单源重试（退避 1.5s / 4s），作为串行之外的双保险。
 */
async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const BACKOFF_MS = [1500, 4000];
  let lastError: unknown;
  for (let attempt = 0; attempt <= BACKOFF_MS.length; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt === BACKOFF_MS.length) break;
      const wait = BACKOFF_MS[attempt];
      console.warn(`[surf] ${label} 第 ${attempt + 1} 次失败（${String(error).slice(0, 80)}），${wait}ms 后重试`);
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
  }
  throw lastError;
}

/** arXiv 官方要求请求间隔 ≥3 秒，对突发并发敏感（见 discover 注释）。 */
const SERIAL_GAP_MS = 3200;

export async function discover(config: AppConfig): Promise<Candidate[]> {
  // feed 型源：彼此无请求间隔要求，四路并发最快。
  const parallel: Array<{ label: string; run: () => Promise<Candidate[]> }> = [];
  // 搜索型源：单独串行，之间留 ≥3 秒。
  const serial: Array<{ label: string; run: () => Promise<Candidate[]> }> = [];

  for (const name of config.discoverySources) {
    const fn = SOURCES[name.toLowerCase()];
    if (!fn) throw new Error(`Unknown discovery source: ${name}`);
    if (FEED_SOURCES.has(name.toLowerCase())) {
      parallel.push({ label: name, run: () => fn("", config) });
      continue;
    }
    for (const topic of config.discoveryTopics) {
      serial.push({ label: `${name}:${topic}`, run: () => fn(topic, config) });
    }
  }

  const settled: Array<PromiseSettledResult<Candidate[]>> = [];
  const labels: string[] = [];

  const parallelRun = Promise.allSettled(
    parallel.map((t) => withRetry(t.label, t.run))
  ).then((results) => {
    results.forEach((r, i) => {
      settled.push(r);
      labels.push(parallel[i].label);
    });
  });

  // 串行组单独跑完再合并，不与feed 组并发。
  const serialRun = (async () => {
    const results: Array<PromiseSettledResult<Candidate[]>> = [];
    for (let i = 0; i < serial.length; i++) {
      if (i > 0) await new Promise((resolve) => setTimeout(resolve, SERIAL_GAP_MS));
      results.push(await Promise.allSettled([withRetry(serial[i].label, serial[i].run)]).then((r) => r[0]));
    }
    return results;
  })();

  const [parallelSettled, serialSettled] = await Promise.all([parallelRun, serialRun]);
  serialSettled.forEach((r, i) => {
    settled.push(r);
    labels.push(serial[i].label);
  });

  const failed: string[] = [];
  const groups: Stamped[][] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled") groups.push(byFreshness(r.value));
    else failed.push(`${labels[i]}: ${String(r.reason).slice(0, 120)}`);
  });

  if (groups.length === 0) {
    throw new Error(`All discovery sources failed${failed.length ? `: ${failed.join("; ")}` : ""}`);
  }
  if (failed.length) {
    console.warn(`[surf] ${failed.length}/${settled.length} source task(s) failed:\n  - ${failed.join("\n  - ")}`);
  }

  // 轮流取：每源一条一条来。原实现是顺序拼接 + slice(0,20)，
  // 靠后的源会被整批砍掉（实测五个主题时第四、五个主题 0 条进模型）。
  const out: Stamped[] = [];
  const seen = new Set<string>();
  for (let i = 0; out.length < 60; i++) {
    let progressed = false;
    for (const group of groups) {
      const item = group[i];
      if (!item || seen.has(item.url)) continue;
      seen.add(item.url);
      delete item._t;
      out.push(item);
      progressed = true;
      if (out.length >= 60) break;
    }
    if (!progressed) break;
  }
  return out;
}