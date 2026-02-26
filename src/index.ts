/**
 * Helix Router - OpenClaw Smart Two-Stage Model Router Plugin
 *
 * Stage 1: Uses LOW model to evaluate task complexity
 * Stage 2: Routes to PRO/MID/LOW based on complexity score
 *
 * Default strategy: MID (balanced speed and quality)
 */

import type {
  OpenClawPluginDefinition,
  OpenClawPluginApi,
  ProviderPlugin,
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  ChatMessage,
  HelixRouterConfig,
  ProvidersConfig,
  RoutingLogEntry,
} from "./types.js";
import { ComplexityEvaluator } from "./complexity-evaluator.js";
import { RoutingEngine } from "./routing-engine.js";
import { HelixLogger, LOG_FILE } from "./logger.js";
import { join } from "node:path";
import { homedir } from "node:os";
import { readFileSync, existsSync, mkdirSync } from "node:fs";

const VERSION = "1.0.0";

// Default provider configuration (your bifrost setup)
const DEFAULT_PROVIDERS: ProvidersConfig = {
  pro: {
    baseUrl: process.env.HELIX_PRO_URL ?? "http://192.168.1.60:8310/v1",
    apiKey: process.env.HELIX_PRO_KEY ?? "",
    model: process.env.HELIX_PRO_MODEL ?? "kiro-proxy/pro",
  },
  mid: {
    baseUrl: process.env.HELIX_MID_URL ?? "http://192.168.1.60:8310/v1",
    apiKey: process.env.HELIX_MID_KEY ?? "",
    model: process.env.HELIX_MID_MODEL ?? "kiro-proxy/mid",
  },
  low: {
    baseUrl: process.env.HELIX_LOW_URL ?? "http://192.168.1.60:8310/v1",
    apiKey: process.env.HELIX_LOW_KEY ?? "",
    model: process.env.HELIX_LOW_MODEL ?? "kiro-proxy/low",
  },
};

// Generate unique request IDs
function generateRequestId(): string {
  return `hr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Plugin state
let evaluator: ComplexityEvaluator | null = null;
let router: RoutingEngine | null = null;
let helixLogger: HelixLogger | null = null;

const plugin: OpenClawPluginDefinition = {
  id: "helix-router",
  name: "Helix Router",
  description: "Smart two-stage LLM router - complexity evaluation + intelligent routing to PRO/MID/LOW",
  version: VERSION,

  async register(api: OpenClawPluginApi) {
    const log = api.logger;

    // Load configuration
    const config = loadConfig(api);
    log.info(`[Helix] Initializing Helix Router v${VERSION}`);

    // Initialize components
    evaluator = new ComplexityEvaluator(
      config.providers.low,
      log,
      config.cache?.ttlMs ?? 3600000
    );

    router = new RoutingEngine(
      config.providers,
      config.routing,
      log
    );

    helixLogger = new HelixLogger(true, log);

    // Register provider
    const provider = createHelixProvider(config);
    api.registerProvider(provider);

    log.info("[Helix] Provider registered: helix-router");
    log.info(`[Helix] PRO model: ${config.providers.pro.model}`);
    log.info(`[Helix] MID model: ${config.providers.mid.model}`);
    log.info(`[Helix] LOW model: ${config.providers.low.model}`);
    log.info(`[Helix] Thresholds: PRO>=${config.routing?.proThreshold ?? 75}, MID>=${config.routing?.midThreshold ?? 35}`);

    // Register /helix command
    api.registerCommand({
      name: "helix",
      description: "Helix Router commands: stats, reset, config",
      acceptsArgs: true,
      requireAuth: false,
      handler: async (ctx) => {
        const args = ctx.args?.trim().toLowerCase() || "stats";

        if (args === "stats") {
          return { text: helixLogger!.formatStats() };
        }

        if (args === "reset") {
          helixLogger!.resetStats();
          return { text: "Stats reset successfully." };
        }

        if (args === "config") {
          const stats = router!.getStats();
          return {
            text: [
              "**Helix Router Configuration**",
              "",
              "**Providers:**",
              ...stats.providers,
              "",
              "**Thresholds:**",
              `- PRO: score >= ${stats.thresholds.proThreshold}`,
              `- MID: score >= ${stats.thresholds.midThreshold}`,
              `- LOW: score < ${stats.thresholds.midThreshold}`,
              "",
              `**Log file:** \`${LOG_FILE}\``,
            ].join("\n"),
          };
        }

        return {
          text: [
            "**Helix Router Commands**",
            "",
            "• `/helix stats` - Show routing statistics",
            "• `/helix reset` - Reset statistics",
            "• `/helix config` - Show current configuration",
          ].join("\n"),
        };
      },
    });

    // Register service for cleanup
    api.registerService({
      id: "helix-router-service",
      start: () => {
        log.info("[Helix] Service started");
      },
      stop: () => {
        log.info("[Helix] Service stopped");
      },
    });

    log.info("[Helix] Helix Router ready - smart routing enabled");
  },
};

/**
 * Load and merge configuration
 */
function loadConfig(api: OpenClawPluginApi): HelixRouterConfig {
  // Start with defaults
  const config: HelixRouterConfig = {
    providers: DEFAULT_PROVIDERS,
    routing: {
      proThreshold: 75,
      midThreshold: 35,
      defaultRoute: "mid",
    },
    cache: {
      enabled: true,
      ttlMs: 3600000,
    },
  };

  // Override from plugin config if present
  if (api.pluginConfig?.providers) {
    const { pro, mid, low } = api.pluginConfig.providers;
    if (pro) config.providers.pro = { ...config.providers.pro, ...pro };
    if (mid) config.providers.mid = { ...config.providers.mid, ...mid };
    if (low) config.providers.low = { ...config.providers.low, ...low };
  }

  if (api.pluginConfig?.routing) {
    config.routing = { ...config.routing, ...api.pluginConfig.routing };
  }

  if (api.pluginConfig?.cache) {
    config.cache = { ...config.cache, ...api.pluginConfig.cache };
  }

  // Also try loading from config file
  const configPath = join(homedir(), ".openclaw", "helix-router", "config.json");
  if (existsSync(configPath)) {
    try {
      const fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
      if (fileConfig.providers) {
        config.providers = { ...config.providers, ...fileConfig.providers };
      }
      if (fileConfig.routing) {
        config.routing = { ...config.routing, ...fileConfig.routing };
      }
    } catch (e) {
      // Ignore parse errors
    }
  }

  return config;
}

/**
 * Create the Helix Router provider for OpenClaw
 */
function createHelixProvider(config: HelixRouterConfig): ProviderPlugin {
  return {
    id: "helix-router",
    label: "Helix Router",
    docsPath: "https://github.com/helix/router",
    aliases: ["helix", "smart"],
    envVars: [],

    // Dynamic models getter
    get models() {
      return {
        baseUrl: "http://helix-router.local/v1", // Virtual - handled by proxy
        api: "openai-completions",
        apiKey: "helix-internal",
        models: [
          {
            id: "auto",
            name: "Helix Auto (Smart Routing)",
            api: "openai-completions",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 200000,
            maxTokens: 64000,
          },
          {
            id: "pro",
            name: "Helix PRO (High Cognitive)",
            api: "openai-completions",
            reasoning: true,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 200000,
            maxTokens: 64000,
          },
          {
            id: "mid",
            name: "Helix MID (Daily Driver)",
            api: "openai-completions",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 128000,
            maxTokens: 32000,
          },
          {
            id: "low",
            name: "Helix LOW (Lightweight)",
            api: "openai-completions",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0 },
            contextWindow: 128000,
            maxTokens: 16000,
          },
        ],
      };
    },

    auth: [],
  };
}

export default plugin;

// Also export for programmatic use
export { ComplexityEvaluator } from "./complexity-evaluator.js";
export { RoutingEngine } from "./routing-engine.js";
export { HelixLogger } from "./logger.js";
export { HelixProxy } from "./proxy.js";
export { HelixServer, startServer } from "./server.js";
export type * from "./types.js";
