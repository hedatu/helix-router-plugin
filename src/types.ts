/**
 * Helix Router Type Definitions
 */

// ============= Provider Configuration =============

export interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface ProvidersConfig {
  pro: ProviderConfig;
  mid: ProviderConfig;
  low: ProviderConfig;
}

// ============= Complexity Evaluation =============

export type ReasoningDepth = "low" | "medium" | "high";
export type TaskType =
  | "classification"
  | "extraction"
  | "summarization"
  | "writing"
  | "coding"
  | "architecture_design"
  | "mathematical_reasoning"
  | "visualization"
  | "multi_step_planning"
  | "other";
export type ConstraintLevel = "low" | "medium" | "high";
export type AccuracyRequirement = "low" | "medium" | "high";
export type TokenSize = "small" | "medium" | "large" | "very_large";

export interface ComplexityEvaluation {
  reasoning_depth: ReasoningDepth;
  task_type: TaskType;
  constraint_level: ConstraintLevel;
  required_accuracy: AccuracyRequirement;
  estimated_token_size: TokenSize;
  complexity_score: number; // 0-100
  confidence: number; // 0-1
}

// ============= Routing =============

export type RouteTier = "pro" | "mid" | "low";

export interface RoutingDecision {
  tier: RouteTier;
  score: number;
  taskType: TaskType;
  confidence: number;
  reasoning: string;
  cached: boolean;
}

export interface RoutingThresholds {
  proThreshold: number; // default 75
  midThreshold: number; // default 35
}

// ============= Request/Response =============

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  tools?: ToolDefinition[];
  tool_choice?: string | { type: string; function: { name: string } };
  response_format?: { type: string };
  stop?: string[];
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
}

export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string;
  delta?: Partial<ChatMessage>;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface StreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: Partial<ChatMessage>;
    finish_reason: string | null;
  }>;
}

// ============= Plugin Configuration =============

export interface HelixRouterConfig {
  providers: ProvidersConfig;
  routing?: RoutingThresholds & {
    defaultRoute?: RouteTier;
  };
  cache?: {
    enabled?: boolean;
    ttlMs?: number;
  };
}

// ============= Logging =============

export interface RoutingLogEntry {
  timestamp: string;
  requestId: string;
  userId?: string;
  score: number;
  route: RouteTier;
  modelUsed: string;
  taskType: TaskType;
  confidence: number;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  evaluationLatencyMs: number;
  mainLatencyMs: number;
  cached: boolean;
  promptHash: string;
}

// ============= OpenClaw Plugin Types =============

export interface OpenClawPluginApi {
  logger: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
    debug: (msg: string) => void;
  };
  config: Record<string, unknown>;
  pluginConfig?: HelixRouterConfig;
  registerProvider: (provider: ProviderPlugin) => void;
  registerTool: (tool: unknown) => void;
  registerCommand: (command: PluginCommand) => void;
  registerService: (service: PluginService) => void;
}

export interface ProviderPlugin {
  id: string;
  label: string;
  docsPath?: string;
  aliases?: string[];
  envVars?: string[];
  models: ModelProviderConfig;
  auth?: Array<{
    type: string;
    envVar?: string;
    description?: string;
  }>;
}

export interface ModelProviderConfig {
  baseUrl: string;
  api: string;
  apiKey?: string;
  models: ModelDefinitionConfig[];
}

export interface ModelDefinitionConfig {
  id: string;
  name: string;
  api: string;
  reasoning?: boolean;
  input?: string[];
  cost?: {
    input: number;
    output: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  contextWindow?: number;
  maxTokens?: number;
}

export interface PluginCommand {
  name: string;
  description: string;
  acceptsArgs?: boolean;
  requireAuth?: boolean;
  handler: (ctx: PluginCommandContext) => Promise<{ text: string; isError?: boolean }>;
}

export interface PluginCommandContext {
  args?: string;
  userId?: string;
  channelId?: string;
}

export interface PluginService {
  id: string;
  start: () => void | Promise<void>;
  stop: () => void | Promise<void>;
}

export interface OpenClawPluginDefinition {
  id: string;
  name: string;
  description: string;
  version: string;
  register: (api: OpenClawPluginApi) => void | Promise<void>;
}
