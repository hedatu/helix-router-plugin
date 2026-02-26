/**
 * Helix Router Proxy
 *
 * Handles the actual request routing:
 * 1. Evaluates complexity using LOW model
 * 2. Routes to appropriate tier (PRO/MID/LOW)
 * 3. Forwards request and returns response
 * 4. Supports streaming
 */

import type {
  ChatCompletionRequest,
  ChatCompletionResponse,
  StreamChunk,
  RouteTier,
  RoutingLogEntry,
  ProviderConfig,
} from "./types.js";
import { ComplexityEvaluator } from "./complexity-evaluator.js";
import { RoutingEngine } from "./routing-engine.js";
import { HelixLogger } from "./logger.js";

export interface ProxyConfig {
  providers: {
    pro: ProviderConfig;
    mid: ProviderConfig;
    low: ProviderConfig;
  };
  routing?: {
    proThreshold?: number;
    midThreshold?: number;
  };
  cache?: {
    enabled?: boolean;
    ttlMs?: number;
  };
}

export class HelixProxy {
  private evaluator: ComplexityEvaluator;
  private router: RoutingEngine;
  private logger: HelixLogger;
  private consoleLogger: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void };

  constructor(
    config: ProxyConfig,
    logger: { info: (msg: string) => void; error: (msg: string) => void; warn: (msg: string) => void }
  ) {
    this.consoleLogger = logger;
    
    this.evaluator = new ComplexityEvaluator(
      config.providers.low,
      logger,
      config.cache?.ttlMs ?? 3600000
    );

    this.router = new RoutingEngine(
      config.providers,
      config.routing ?? {},
      logger
    );

    this.logger = new HelixLogger(config.cache?.enabled ?? true, logger);
  }

  /**
   * Handle a chat completion request
   */
  async handleRequest(
    request: ChatCompletionRequest,
    requestId?: string
  ): Promise<Response> {
    const id = requestId ?? this.generateId();
    const startTime = Date.now();

    try {
      // Step 1: Evaluate complexity
      const evalResult = await this.evaluator.evaluate(request.messages);
      const evaluationLatencyMs = evalResult.latencyMs;

      // Step 2: Make routing decision
      const decision = this.router.decide(evalResult.evaluation, evalResult.cached);

      // Step 3: Get provider for selected tier
      const provider = this.router.getProvider(decision.tier);

      this.consoleLogger.info(
        `[Helix] Request ${id}: ${decision.tier.toUpperCase()} ` +
        `(score: ${decision.score}, task: ${decision.taskType}) ` +
        `${decision.cached ? "(cached)" : ""}`
      );

      // Step 4: Forward request to selected provider
      const response = await this.forwardRequest(request, provider, decision.tier);

      // Step 5: Log the routing decision
      const totalLatencyMs = Date.now() - startTime;

      // Extract token usage if available
      let tokensIn = 0;
      let tokensOut = 0;
      try {
        const clone = response.clone();
        const data = await clone.json() as ChatCompletionResponse;
        tokensIn = data.usage?.prompt_tokens ?? 0;
        tokensOut = data.usage?.completion_tokens ?? 0;
      } catch {
        // Streaming response, can't extract usage
      }

      const logEntry: RoutingLogEntry = {
        timestamp: new Date().toISOString(),
        requestId: id,
        score: decision.score,
        route: decision.tier,
        modelUsed: provider.model,
        taskType: decision.taskType,
        confidence: decision.confidence,
        tokensIn,
        tokensOut,
        latencyMs: totalLatencyMs,
        evaluationLatencyMs,
        mainLatencyMs: totalLatencyMs - evaluationLatencyMs,
        cached: decision.cached,
        promptHash: evalResult.promptHash,
      };

      this.logger.logRouting(logEntry);

      return response;
    } catch (error) {
      const totalLatencyMs = Date.now() - startTime;
      this.consoleLogger.error(`[Helix] Request ${id} failed: ${error}`);

      // Fallback to MID on error
      this.consoleLogger.warn(`[Helix] Falling back to MID tier`);
      const provider = this.router.getProvider("mid");
      return this.forwardRequest(request, provider, "mid");
    }
  }

  /**
   * Forward request to target provider
   */
  private async forwardRequest(
    request: ChatCompletionRequest,
    provider: ProviderConfig,
    tier: RouteTier
  ): Promise<Response> {
    // Replace model ID with provider's model
    const forwardedRequest = {
      ...request,
      model: provider.model,
    };

    // Map helix-router model IDs to actual tiers
    // If user explicitly requested a tier, use it
    if (request.model === "helix-router/pro" || request.model === "pro") {
      forwardedRequest.model = this.router.getProvider("pro").model;
    } else if (request.model === "helix-router/mid" || request.model === "mid") {
      forwardedRequest.model = this.router.getProvider("mid").model;
    } else if (request.model === "helix-router/low" || request.model === "low") {
      forwardedRequest.model = this.router.getProvider("low").model;
    }
    // Otherwise use the routed tier's model

    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(forwardedRequest),
    });

    return response;
  }

  /**
   * Handle streaming request
   */
  async *handleStreamRequest(
    request: ChatCompletionRequest,
    requestId?: string
  ): AsyncGenerator<StreamChunk, void, unknown> {
    const id = requestId ?? this.generateId();
    const startTime = Date.now();

    try {
      // Step 1: Evaluate complexity
      const evalResult = await this.evaluator.evaluate(request.messages);
      const evaluationLatencyMs = evalResult.latencyMs;

      // Step 2: Make routing decision
      const decision = this.router.decide(evalResult.evaluation, evalResult.cached);

      // Step 3: Get provider for selected tier
      const provider = this.router.getProvider(decision.tier);

      this.consoleLogger.info(
        `[Helix] Stream ${id}: ${decision.tier.toUpperCase()} ` +
        `(score: ${decision.score}, task: ${decision.taskType})`
      );

      // Step 4: Forward stream request
      const streamRequest = {
        ...request,
        model: provider.model,
        stream: true,
      };

      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(streamRequest),
      });

      if (!response.ok) {
        throw new Error(`Provider error: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error("No response body");
      }

      const decoder = new TextDecoder();
      let buffer = "";
      let totalTokens = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            yield { id, object: "chat.completion.chunk", created: Date.now(), model: provider.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] };
            continue;
          }

          try {
            const chunk = JSON.parse(data) as StreamChunk;
            // Update model name in response
            chunk.model = `helix-router/${decision.tier}`;
            yield chunk;

            // Estimate tokens for logging
            if (chunk.choices?.[0]?.delta?.content) {
              totalTokens += Math.ceil(chunk.choices[0].delta.content.length / 4);
            }
          } catch {
            // Skip malformed chunks
          }
        }
      }

      // Log the completed stream
      const totalLatencyMs = Date.now() - startTime;
      const logEntry: RoutingLogEntry = {
        timestamp: new Date().toISOString(),
        requestId: id,
        score: decision.score,
        route: decision.tier,
        modelUsed: provider.model,
        taskType: decision.taskType,
        confidence: decision.confidence,
        tokensIn: Math.ceil(JSON.stringify(request.messages).length / 4),
        tokensOut: totalTokens,
        latencyMs: totalLatencyMs,
        evaluationLatencyMs,
        mainLatencyMs: totalLatencyMs - evaluationLatencyMs,
        cached: decision.cached,
        promptHash: evalResult.promptHash,
      };

      this.logger.logRouting(logEntry);
    } catch (error) {
      this.consoleLogger.error(`[Helix] Stream ${id} failed: ${error}`);
      throw error;
    }
  }

  /**
   * Get routing statistics
   */
  getStats() {
    return {
      routing: this.router.getStats(),
      logs: this.logger.getStats(),
    };
  }

  private generateId(): string {
    return `hr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}
