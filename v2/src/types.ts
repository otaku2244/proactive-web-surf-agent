export interface Candidate {
  source: string;
  title: string;
  url: string;
  summary: string;
  /** 原图直链。RSS 的 media:content / enclosure，退化时取 description 里的首个 img。
   *  实测 Aeon / Psyche / ArchDaily 命中率 100%，arXiv 无图。 */
  image: string;
  /** 仅解析阶段使用：发布时间戳，交错取样后剥离，不进提示词。 */
  _t?: number;
}

export interface Selection {
  index: number;
  /** 脱水后的客观切片（中文）。不提她、不带感情。 */
  summary: string;
  /** 本次调用的 token 用量（上游 usage 字段；上游不给则为 undefined）。 */
  usage?: TokenUsage;
}

/**
 * 一次 LLM 调用的 token 与耗时。
 * `promptChars` 是我们自己算的（上游不一定回prompt 数），
 * 用来在usage 缺失时仍能给出量级。
 */
export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  /** completion里属于思维链的部分（推理模型有，非推理模型 undefined）。
   *  实测 deepseek-flash 这一项能占到 completion 的 60% 以上。 */
  reasoningTokens?: number;
  /** 命中 prompt 缓存的 token 数。上游支持时才有。 */
  cacheHitTokens?: number;
  /** 本地实测：拼好的提示词字符数。 */
  promptChars: number;
  /** 本地实测：模型输出字符数。 */
  completionChars: number;
  elapsedMs: number;
}

/** 最近原文（Serein raw_events），只用于给选片定方向，不回传任何原文。 */
export interface RecentContext {
  /** 已拼好的提示词段落；为空表示没读到原文，那段整个不出现。 */
  turnsText: string;
  count: number;
}

export interface ModelProvider {
  select(candidates: Candidate[], recent: RecentContext): Promise<Selection>;
}

export interface DeliveryChannel {
  /** 产出「他独处时摸到的一段原材料」。 */
  send(finding: SurfFinding): Promise<void>;
  /**
   * 冲浪没跑成（抓取失败 / 模型不返回合法选择 / 超时）时回报。
   * 桥会把它包成「刚才想去翻点东西，没翻成（…）」，同样走独处通知投递。
   * 不回报 = 桥侧什么都不知道，这一轮就白烧了。
   */
  reportFailure(error: string): Promise<void>;
}

export interface SurfFinding {
  candidate: Candidate;
  /** 模型写的脱水摘要。 */
  note: string;
}

export interface AppConfig {
  provider: "openai-compatible" | "anthropic";
  companionName: string;
  /** 保留字段：产物不提收件人，所以这个名字不再进提示词。 */
  recipientName: string;
  companionPrompt: string;
  deliveryChannel: "console" | "jiwen" | "telegram";
  discoverySources: string[];
  discoveryTopics: string[];
  /** 进模型挑选的候选上限。 */
  candidateLimit: number;
  /** Serein 的 sqlite 库路径，用于读最近原文；留空则不注入该段。 */
  sereinDbPath: string;
  /** 取最近多少条 assistant 发言。 */
  recentLimit: number;
  /** 单条原文截断长度。 */
  recentClipChars: number;
  /** 积温桥地址（jiwen 通道用），例：http://127.0.0.1:18220 */
  jiwenBaseUrl: string;
  jiwenToken: string;
  /** 产物回投路径。必须与桥的 SURF_FINDING_PATH 一致。 */
  jiwenFindingPath: string;
  /**
   * 关掉推理模型的思维链。默认 true。
   * 与积温判定器（lib/analyzer.js 的 LLM_DISABLE_THINKING）同一套开关语义。
   * 换非推理模型时设 0 或 false。
   */
  disableThinking: boolean;
  timezone: string;
  dayStartHour: number;
  dayEndHour: number;
  minIntervalHours: number;
  maxIntervalHours: number;
  /** 自主排期开关。挂到积温后由桥 spawn，本进程不自主排期。 */
  autoSchedule: boolean;
  stateFile: string;
  timeoutMs: number;
  openai: { baseUrl: string; apiKey: string; model: string };
  anthropic: { baseUrl: string; apiKey: string; model: string };
  telegram: { token: string; chatId: string };
}