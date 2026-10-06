export interface Candidate {
  source: string;
  title: string;
  url: string;
  summary: string;
  /** 仅解析阶段使用：发布时间戳，交错取样后剥离，不进提示词。 */
  _t?: number;
}

export interface Selection {
  index: number;
  message: string;
}

export interface ModelProvider {
  select(candidates: Candidate[]): Promise<Selection>;
}

export interface DeliveryChannel {
  send(candidate: Candidate, message: string): Promise<void>;
}

export interface AppConfig {
  provider: "openai-compatible" | "anthropic";
  companionName: string;
  recipientName: string;
  companionPrompt: string;
  deliveryChannel: "console" | "telegram";
  discoverySources: string[];
  discoveryTopics: string[];
  /** 进模型挑选的候选上限。原实现写死 20，feed 型源一天只出一批时会被吃空。 */
  candidateLimit: number;
  timezone: string;
  dayStartHour: number;
  dayEndHour: number;
  minIntervalHours: number;
  maxIntervalHours: number;
  runOnStart: boolean;
  stateFile: string;
  timeoutMs: number;
  openai: { baseUrl: string; apiKey: string; model: string };
  anthropic: { baseUrl: string; apiKey: string; model: string };
  telegram: { token: string; chatId: string };
}
