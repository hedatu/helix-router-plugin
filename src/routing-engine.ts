/**
 * Routing Decision Engine
 *
 * Makes routing decisions based on complexity evaluation.
 * Implements conservative MID-biased routing.
 */

import type {
  ComplexityEvaluation,
  RouteTier,
  RoutingDecision,
  RoutingThresholds,
  TaskType,
  ProvidersConfig,
  ProviderConfig,
} from "./types.js";

// Default thresholds
const DEFAULT_THRESHOLDS: RoutingThresholds = {
  proThreshold: 75,
  midThreshold: 35,
};

// Task types that should prefer MID
const MID_PREFERRED_TASKS: TaskType[] = [
  "visualization",
  "writing",
  "summarization",
];

// Task types that should use PRO for high scores
const PRO_PREFERRED_TASKS: TaskType[] = [
  "architecture_design",
  "mathematical_reasoning",
  "multi_step_planning",
];

export class RoutingEngine {
  private thresholds: RoutingThresholds;
  private providers: ProvidersConfig;
  private logger: { info: (msg: string) => void };

  constructor(
    providers: ProvidersConfig,
    thresholds: Partial<RoutingThresholds> = {},
    logger: { info: (msg: string) => void }
  ) {
    this.providers = providers;
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };
    this.logger = logger;
  }

  /**
   * Make routing decision based on complexity evaluation
   */
  decide(evaluation: ComplexityEvaluation, cached: boolean): RoutingDecision {
    const { complexity_score, task_type, confidence, estimated_token_size } = evaluation;

    // Start with base decision from score
    let tier: RouteTier;
    let reasoning: string;

    // Rule 1: Very large tokens always go to PRO
    if (estimated_token_size === "very_large") {
      tier = "pro";
      reasoning = "Very large token size forces PRO";
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Rule 2: Low confidence defaults to MID (safe choice)
    if (confidence < 0.6) {
      tier = "mid";
      reasoning = `Low confidence (${confidence.toFixed(2)}) defaults to MID`;
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Rule 3: Check for extreme score with low confidence
    if (complexity_score > 90 && confidence < 0.7) {
      tier = "mid";
      reasoning = `High score (${complexity_score}) but low confidence (${confidence.toFixed(2)}) -> MID`;
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Rule 4: MID-preferred task types
    if (MID_PREFERRED_TASKS.includes(task_type) && complexity_score < 70) {
      tier = "mid";
      reasoning = `${task_type} task prefers MID (score: ${complexity_score})`;
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Rule 5: Coding tasks < 70 stay in MID
    if (task_type === "coding" && complexity_score < 70) {
      tier = "mid";
      reasoning = `Coding task with score ${complexity_score} stays in MID`;
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Rule 6: PRO-preferred task types with high scores
    if (PRO_PREFERRED_TASKS.includes(task_type) && complexity_score >= 65) {
      tier = "pro";
      reasoning = `${task_type} with score ${complexity_score} -> PRO`;
      this.logger.info(`[Helix] ${reasoning}`);
      return this.buildDecision(tier, evaluation, reasoning, cached);
    }

    // Default score-based routing
    if (complexity_score >= this.thresholds.proThreshold) {
      tier = "pro";
      reasoning = `Score ${complexity_score} >= ${this.thresholds.proThreshold} -> PRO`;
    } else if (complexity_score >= this.thresholds.midThreshold) {
      tier = "mid";
      reasoning = `Score ${complexity_score} >= ${this.thresholds.midThreshold} -> MID`;
    } else {
      tier = "low";
      reasoning = `Score ${complexity_score} < ${this.thresholds.midThreshold} -> LOW`;
    }

    return this.buildDecision(tier, evaluation, reasoning, cached);
  }

  /**
   * Build the routing decision object
   */
  private buildDecision(
    tier: RouteTier,
    evaluation: ComplexityEvaluation,
    reasoning: string,
    cached: boolean
  ): RoutingDecision {
    return {
      tier,
      score: evaluation.complexity_score,
      taskType: evaluation.task_type,
      confidence: evaluation.confidence,
      reasoning,
      cached,
    };
  }

  /**
   * Get provider config for a tier
   */
  getProvider(tier: RouteTier): ProviderConfig {
    return this.providers[tier];
  }

  /**
   * Get model ID for a tier
   */
  getModelId(tier: RouteTier): string {
    return this.providers[tier].model;
  }

  /**
   * Get statistics about recent routing decisions (for metrics)
   */
  getStats(): { thresholds: RoutingThresholds; providers: string[] } {
    return {
      thresholds: this.thresholds,
      providers: [
        `PRO: ${this.providers.pro.model}`,
        `MID: ${this.providers.mid.model}`,
        `LOW: ${this.providers.low.model}`,
      ],
    };
  }
}
