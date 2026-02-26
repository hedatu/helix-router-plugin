/**
 * Helix Router Server
 *
 * HTTP server that exposes Helix Router as an OpenAI-compatible API.
 * Run this as a separate process or as part of OpenClaw gateway.
 */

import { createServer, IncomingMessage, ServerResponse, Server } from "node:http";
import type { ChatCompletionRequest } from "./types.js";
import { HelixProxy, ProxyConfig } from "./proxy.js";

const DEFAULT_PORT = 8403;

export interface ServerOptions {
  port?: number;
  config: ProxyConfig;
  logger: {
    info: (msg: string) => void;
    error: (msg: string) => void;
    warn: (msg: string) => void;
  };
}

export class HelixServer {
  private server: Server | null = null;
  private proxy: HelixProxy;
  private port: number;
  private logger: ServerOptions["logger"];

  constructor(options: ServerOptions) {
    this.port = options.port ?? DEFAULT_PORT;
    this.logger = options.logger;
    this.proxy = new HelixProxy(options.config, options.logger);
  }

  /**
   * Start the HTTP server
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this.handleRequest(req, res));

      this.server.on("error", (err) => {
        this.logger.error(`[Helix Server] Error: ${err}`);
        reject(err);
      });

      this.server.listen(this.port, () => {
        this.logger.info(`[Helix Server] Listening on http://127.0.0.1:${this.port}`);
        this.logger.info(`[Helix Server] Endpoint: http://127.0.0.1:${this.port}/v1/chat/completions`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.logger.info("[Helix Server] Stopped");
          resolve();
        }
      });
    });
  }

  /**
   * Get the port the server is listening on
   */
  getPort(): number {
    return this.port;
  }

  /**
   * Get the base URL for the server
   */
  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // CORS headers
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      // Health check
      if (url === "/health" || url === "/v1/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          status: "ok",
          service: "helix-router",
          version: "1.0.0",
        }));
        return;
      }

      // Stats endpoint
      if (url === "/stats" || url === "/v1/stats") {
        const stats = this.proxy.getStats();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(stats, null, 2));
        return;
      }

      // Models endpoint
      if (url === "/v1/models" && method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          object: "list",
          data: [
            { id: "helix-router/auto", object: "model", owned_by: "helix" },
            { id: "helix-router/pro", object: "model", owned_by: "helix" },
            { id: "helix-router/mid", object: "model", owned_by: "helix" },
            { id: "helix-router/low", object: "model", owned_by: "helix" },
          ],
        }));
        return;
      }

      // Chat completions endpoint
      if (url === "/v1/chat/completions" && method === "POST") {
        await this.handleChatCompletion(req, res);
        return;
      }

      // 404 for unknown endpoints
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
    } catch (error) {
      this.logger.error(`[Helix Server] Request error: ${error}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }

  /**
   * Handle chat completion request
   */
  private async handleChatCompletion(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Read request body
    const body = await this.readBody(req);
    let request: ChatCompletionRequest;

    try {
      request = JSON.parse(body) as ChatCompletionRequest;
    } catch {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid JSON" }));
      return;
    }

    const requestId = `hr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Check if streaming
      if (request.stream) {
        await this.handleStreamCompletion(request, res, requestId);
      } else {
        await this.handleNonStreamCompletion(request, res, requestId);
      }
    } catch (error) {
      this.logger.error(`[Helix Server] Chat completion error: ${error}`);
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        error: {
          message: error instanceof Error ? error.message : "Internal error",
          type: "internal_error",
        },
      }));
    }
  }

  /**
   * Handle non-streaming completion
   */
  private async handleNonStreamCompletion(
    request: ChatCompletionRequest,
    res: ServerResponse,
    requestId: string
  ): Promise<void> {
    const response = await this.proxy.handleRequest(request, requestId);
    const data = await response.json();

    // Update model name in response
    if (data.model) {
      data.model = `helix-router/auto`;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(data));
  }

  /**
   * Handle streaming completion
   */
  private async handleStreamCompletion(
    request: ChatCompletionRequest,
    res: ServerResponse,
    requestId: string
  ): Promise<void> {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    });

    try {
      for await (const chunk of this.proxy.handleStreamRequest(request, requestId)) {
        res.write(`data: ${JSON.stringify(chunk)}\n\n`);
      }
      res.write("data: [DONE]\n\n");
    } catch (error) {
      const errorChunk = {
        id: requestId,
        object: "error",
        error: { message: error instanceof Error ? error.message : "Stream error" },
      };
      res.write(`data: ${JSON.stringify(errorChunk)}\n\n`);
    }

    res.end();
  }

  /**
   * Read request body as string
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }
}

/**
 * Start server from command line
 */
export async function startServer(options?: { port?: number }): Promise<HelixServer> {
  const port = options?.port ?? parseInt(process.env.HELIX_PORT ?? "") || DEFAULT_PORT;

  const logger = {
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    warn: (msg: string) => console.warn(`[WARN] ${msg}`),
  };

  // Load config from environment or defaults
  const config: ProxyConfig = {
    providers: {
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
    },
    routing: {
      proThreshold: parseInt(process.env.HELIX_PRO_THRESHOLD ?? "75"),
      midThreshold: parseInt(process.env.HELIX_MID_THRESHOLD ?? "35"),
    },
  };

  const server = new HelixServer({ port, config, logger });
  await server.start();

  return server;
}

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  startServer()
    .then(() => {
      console.log("Helix Router server started. Press Ctrl+C to stop.");
    })
    .catch((err) => {
      console.error("Failed to start server:", err);
      process.exit(1);
    });
}
