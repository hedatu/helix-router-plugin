/**
 * Logger for Helix Router
 *
 * Logs routing decisions and statistics.
 */

import type { RouteTier, TaskType, RoutingLogEntry } from "./types.js";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

// Log file path
const LOG_DIR = join(homedir(), ".openclaw", "helix-router");
const LOG_FILE = join(LOG_DIR, "routing.log");
const STATS_FILE = join(LOG_DIR, "stats.json");

// In-memory stats for quick access
interface Stats {
  totalRequests: number;
  routeCounts: Record<RouteTier, number>;
  taskTypeCounts: Record<TaskType, number>;
  avgScore: number;
  avgLatencyMs: number;
  avgEvaluationMs: number;
  cacheHitRate: number;
  lastUpdated: string;
}

class StatsTracker {
  private stats: Stats = {
    totalRequests: 0,
    routeCounts: { pro: 0, mid: 0, low: 0 },
    taskTypeCounts: {} as Record<TaskType, number>,
    avgScore: 0,
    avgLatencyMs: 0,
    avgEvaluationMs: 0,
    cacheHitRate: 0,
    lastUpdated: new Date().toISOString(),
  };

  private totalScore = 0;
  private totalLatency = 0;
  private totalEvaluation = 0;
  private cacheHits = 0;

  record(entry: RoutingLogEntry): void {
    this.stats.totalRequests++;
    this.stats.routeCounts[entry.route]++;
    
    // Track task types
    if (!this.stats.taskTypeCounts[entry.taskType]) {
      this.stats.taskTypeCounts[entry.taskType] = 0;
    }
    this.stats.taskTypeCounts[entry.taskType]++;

    // Running averages
    this.totalScore += entry.score;
    this.totalLatency += entry.latencyMs;
    this.totalEvaluation += entry.evaluationLatencyMs;
    if (entry.cached) this.cacheHits++;

    this.stats.avgScore = Math.round(this.totalScore / this.stats.totalRequests);
    this.stats.avgLatencyMs = Math.round(this.totalLatency / this.stats.totalRequests);
    this.stats.avgEvaluationMs = Math.round(this.totalEvaluation / this.stats.totalRequests);
    this.stats.cacheHitRate = Math.round((this.cacheHits / this.stats.totalRequests) * 100);
    this.stats.lastUpdated = new Date().toISOString();
  }

  getStats(): Stats {
    return { ...this.stats };
  }

  reset(): void {
    this.stats = {
      totalRequests: 0,
      routeCounts: { pro: 0, mid: 0, low: 0 },
      taskTypeCounts: {} as Record<TaskType, number>,
      avgScore: 0,
      avgLatencyMs: 0,
      avgEvaluationMs: 0,
      cacheHitRate: 0,
      lastUpdated: new Date().toISOString(),
    };
    this.totalScore = 0;
    this.totalLatency = 0;
    this.totalEvaluation = 0;
    this.cacheHits = 0;
  }
}

const statsTracker = new StatsTracker();

export class HelixLogger {
  private enabled: boolean;
  private logger: { info: (msg: string) => void; error: (msg: string) => void };

  constructor(
    enabled = true,
    logger: { info: (msg: string) => void; error: (msg: string) => void }
  ) {
    this.enabled = enabled;
    this.logger = logger;

    // Ensure log directory exists
    if (!existsSync(LOG_DIR)) {
      mkdirSync(LOG_DIR, { recursive: true });
    }
  }

  /**
   * Log a routing decision
   */
  logRouting(entry: RoutingLogEntry): void {
    if (!this.enabled) return;

    try {
      // Write to log file
      const logLine = JSON.stringify(entry) + "\n";
      appendFileSync(LOG_FILE, logLine, "utf-8");

      // Update stats
      statsTracker.record(entry);

      // Console log
      this.logger.info(
        `[Helix] Route: ${entry.route.toUpperCase()} | ` +
        `Score: ${entry.score} | ` +
        `Task: ${entry.taskType} | ` +
        `Model: ${entry.modelUsed} | ` +
        `Latency: ${entry.latencyMs}ms | ` +
        `Cached: ${entry.cached}`
      );
    } catch (error) {
      this.logger.error(`[Helix] Logging failed: ${error}`);
    }
  }

  /**
   * Get current stats
   */
  getStats(): Stats {
    return statsTracker.getStats();
  }

  /**
   * Reset stats
   */
  resetStats(): void {
    statsTracker.reset();
    this.logger.info("[Helix] Stats reset");
  }

  /**
   * Format stats for display
   */
  formatStats(): string {
    const stats = this.getStats();
    const lines = [
      "╔═══════════════════════════════════════════════════════════════╗",
      "║                    Helix Router Statistics                    ║",
      "╠═══════════════════════════════════════════════════════════════╣",
      `║ Total Requests: ${stats.totalRequests.toString().padEnd(45)}║`,
      "╠═══════════════════════════════════════════════════════════════╣",
      "║ Routing Distribution:                                         ║",
      `║   PRO: ${stats.routeCounts.pro.toString().padEnd(55)}║`,
      `║   MID: ${stats.routeCounts.mid.toString().padEnd(55)}║`,
      `║   LOW: ${stats.routeCounts.low.toString().padEnd(55)}║`,
      "╠═══════════════════════════════════════════════════════════════╣",
      `║ Average Score: ${stats.avgScore.toString().padEnd(47)}║`,
      `║ Average Latency: ${stats.avgLatencyMs}ms`.padEnd(62) + "║",
      `║ Average Evaluation: ${stats.avgEvaluationMs}ms`.padEnd(58) + "║",
      `║ Cache Hit Rate: ${stats.cacheHitRate}%`.padEnd(59) + "║",
      "╚═══════════════════════════════════════════════════════════════╝",
    ];
    return lines.join("\n");
  }
}

export { LOG_FILE, STATS_FILE };
