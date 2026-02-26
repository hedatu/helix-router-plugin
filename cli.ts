#!/usr/bin/env node

/**
 * Helix Router CLI
 *
 * Usage:
 *   helix-router start [--port 8403]
 *   helix-router stats
 *   helix-router config
 */

import { startServer, HelixServer } from "./src/server.js";
import { homedir } from "node:os";
import { join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const CONFIG_FILE = join(homedir(), ".openclaw", "helix-router", "config.json");

function printHelp(): void {
  console.log(`
Helix Router - Smart Two-Stage LLM Router

Usage:
  helix-router <command> [options]

Commands:
  start     Start the router server
  stats     Show routing statistics
  config    Show current configuration
  help      Show this help message

Options for 'start':
  --port <n>     Server port (default: 8403)
  --config <f>   Path to config file

Environment Variables:
  HELIX_PRO_URL      PRO provider base URL
  HELIX_PRO_KEY      PRO provider API key
  HELIX_PRO_MODEL    PRO provider model ID
  HELIX_MID_URL      MID provider base URL
  HELIX_MID_KEY      MID provider API key
  HELIX_MID_MODEL    MID provider model ID
  HELIX_LOW_URL      LOW provider base URL
  HELIX_LOW_KEY      LOW provider API key
  HELIX_LOW_MODEL    LOW provider model ID
  HELIX_PORT         Server port

Examples:
  helix-router start
  helix-router start --port 8404
  HELIX_MID_MODEL=gpt-4o helix-router start
`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0] ?? "help";

  switch (command) {
    case "start": {
      const portIndex = args.indexOf("--port");
      const port = portIndex > -1 ? parseInt(args[portIndex + 1]) : undefined;

      console.log("╔═══════════════════════════════════════════════════════════════╗");
      console.log("║                    Helix Router v1.0.0                        ║");
      console.log("║         Smart Two-Stage LLM Router for OpenClaw              ║");
      console.log("╚═══════════════════════════════════════════════════════════════╝");
      console.log("");

      const server = await startServer({ port });
      console.log("");
      console.log("Routes:");
      console.log("  • /v1/chat/completions  - Main chat endpoint");
      console.log("  • /v1/models           - List available models");
      console.log("  • /health              - Health check");
      console.log("  • /stats               - Routing statistics");
      console.log("");

      // Handle shutdown
      process.on("SIGINT", async () => {
        console.log("\nShutting down...");
        await server.stop();
        process.exit(0);
      });

      break;
    }

    case "stats": {
      // TODO: Connect to running server and fetch stats
      console.log("Stats command requires a running server.");
      console.log("Start the server with: helix-router start");
      console.log("Then access stats at: http://localhost:8403/stats");
      break;
    }

    case "config": {
      if (existsSync(CONFIG_FILE)) {
        console.log(`Configuration file: ${CONFIG_FILE}`);
        console.log(readFileSync(CONFIG_FILE, "utf-8"));
      } else {
        console.log("No configuration file found.");
        console.log("");
        console.log("Default configuration:");
        console.log(JSON.stringify({
          providers: {
            pro: {
              baseUrl: "http://192.168.1.60:8310/v1",
              model: "kiro-proxy/pro",
            },
            mid: {
              baseUrl: "http://192.168.1.60:8310/v1",
              model: "kiro-proxy/mid",
            },
            low: {
              baseUrl: "http://192.168.1.60:8310/v1",
              model: "kiro-proxy/low",
            },
          },
          routing: {
            proThreshold: 75,
            midThreshold: 35,
          },
        }, null, 2));
      }
      break;
    }

    case "help":
    case "--help":
    case "-h":
    default:
      printHelp();
      break;
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
