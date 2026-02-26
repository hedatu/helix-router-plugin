/**
 * Complexity Evaluator
 *
 * Uses LOW model to evaluate task complexity.
 * Returns structured JSON with scoring dimensions.
 */

import type {
  ChatMessage,
  ComplexityEvaluation,
  ProviderConfig,
  TaskType,
  ReasoningDepth,
  ConstraintLevel,
  AccuracyRequirement,
  TokenSize,
} from "./types.js";

// ============= System Prompt for Complexity Evaluation =============

const COMPLEXITY_SYSTEM_PROMPT = `You are a Cognitive Complexity Evaluator.

Your job is NOT to solve the task.
Your job is to evaluate how cognitively complex the user's request is.

You must return ONLY valid JSON.
Do not include explanations.
Do not answer the question.
Do not include markdown.
Do not include extra text.

Evaluate the task across these dimensions:

1. reasoning_depth:
   - low: single-step answer, direct response
   - medium: structured response, some reasoning
   - high: multi-step reasoning, complex constraints, architecture-level thinking

2. task_type:
   - classification
   - extraction
   - summarization
   - writing
   - coding
   - architecture_design
   - mathematical_reasoning
   - visualization
   - multi_step_planning
   - other

3. constraint_level:
   - low
   - medium
   - high

4. required_accuracy:
   - low
   - medium
   - high

5. estimated_token_size:
   - small (<500)
   - medium (500-2000)
   - large (2000-8000)
   - very_large (>8000)

Then compute a complexity_score from 0 to 100 using:

Base Score =
Reasoning Depth (0–30) +
Task Type Weight (0–30) +
Constraint Level (0–20) +
Accuracy Requirement (0–20)

Be slightly conservative.
Prefer medium complexity instead of high if uncertain.

Return format:

{
  "reasoning_depth": "...",
  "task_type": "...",
  "constraint_level": "...",
  "required_accuracy": "...",
  "estimated_token_size": "...",
  "complexity_score": number,
  "confidence": 0.0-1.0
}`;

// ============= Score Mappings =============

const REASONING_DEPTH_SCORES: Record<ReasoningDepth, number> = {
  low: 10,
  medium: 20,
  high: 30,
};

const TASK_TYPE_SCORES: Record<TaskType, number> = {
  classification: 5,
  extraction: 5,
  summarization: 10,
  writing: 15,
  coding: 20,
  visualization: 15,
  architecture_design: 30,
  mathematical_reasoning: 30,
  multi_step_planning: 25,
  other: 15,
};

const CONSTRAINT_LEVEL_SCORES: Record<ConstraintLevel, number> = {
  low: 5,
  medium: 10,
  high: 20,
};

const ACCURACY_SCORES: Record<AccuracyRequirement, number> = {
  low: 5,
  medium: 10,
  high: 20,
};

// ============= Complexity Evaluator Class =============

export class ComplexityEvaluator {
  private lowProvider: ProviderConfig;
  private cache: Map<string, { evaluation: ComplexityEvaluation; timestamp: number }> = new Map();
  private cacheTtlMs: number;
  private logger: { info: (msg: string) => void; error: (msg: string) => void };

  constructor(
    lowProvider: ProviderConfig,
    logger: { info: (msg: string) => void; error: (msg: string) => void },
    cacheTtlMs = 3600000 // 1 hour default
  ) {
    this.lowProvider = lowProvider;
    this.cacheTtlMs = cacheTtlMs;
    this.logger = logger;
  }

  /**
   * Generate a hash for the prompt to use as cache key
   */
  private hashPrompt(messages: ChatMessage[]): string {
    const content = messages
      .filter((m) => m.role === "user")
      .map((m) => (typeof m.content === "string" ? m.content : JSON.stringify(m.content)))
      .join("|");
    
    // Simple hash function
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
  }

  /**
   * Check cache for existing evaluation
   */
  private getCached(hash: string): ComplexityEvaluation | null {
    const cached = this.cache.get(hash);
    if (!cached) return null;

    const age = Date.now() - cached.timestamp;
    if (age > this.cacheTtlMs) {
      this.cache.delete(hash);
      return null;
    }

    return cached.evaluation;
  }

  /**
   * Store evaluation in cache
   */
  private setCache(hash: string, evaluation: ComplexityEvaluation): void {
    this.cache.set(hash, {
      evaluation,
      timestamp: Date.now(),
    });

    // Cleanup old entries (keep max 1000)
    if (this.cache.size > 1000) {
      const entries = Array.from(this.cache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toDelete = entries.slice(0, entries.length - 1000);
      for (const [key] of toDelete) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Validate and normalize the evaluation result
   */
  private validateEvaluation(raw: unknown): ComplexityEvaluation | null {
    try {
      const obj = raw as Record<string, unknown>;
      
      // Validate required fields
      const required = [
        "reasoning_depth",
        "task_type",
        "constraint_level",
        "required_accuracy",
        "estimated_token_size",
        "complexity_score",
        "confidence",
      ];

      for (const field of required) {
        if (!(field in obj)) {
          this.logger.error(`Missing field in evaluation: ${field}`);
          return null;
        }
      }

      // Validate enum values
      const validReasoning: ReasoningDepth[] = ["low", "medium", "high"];
      const validTasks: TaskType[] = [
        "classification", "extraction", "summarization", "writing",
        "coding", "architecture_design", "mathematical_reasoning",
        "visualization", "multi_step_planning", "other"
      ];
      const validConstraint: ConstraintLevel[] = ["low", "medium", "high"];
      const validAccuracy: AccuracyRequirement[] = ["low", "medium", "high"];
      const validTokenSize: TokenSize[] = ["small", "medium", "large", "very_large"];

      const evaluation: ComplexityEvaluation = {
        reasoning_depth: validReasoning.includes(obj.reasoning_depth as ReasoningDepth)
          ? (obj.reasoning_depth as ReasoningDepth)
          : "medium",
        task_type: validTasks.includes(obj.task_type as TaskType)
          ? (obj.task_type as TaskType)
          : "other",
        constraint_level: validConstraint.includes(obj.constraint_level as ConstraintLevel)
          ? (obj.constraint_level as ConstraintLevel)
          : "medium",
        required_accuracy: validAccuracy.includes(obj.required_accuracy as AccuracyRequirement)
          ? (obj.required_accuracy as AccuracyRequirement)
          : "medium",
        estimated_token_size: validTokenSize.includes(obj.estimated_token_size as TokenSize)
          ? (obj.estimated_token_size as TokenSize)
          : "medium",
        complexity_score: Math.min(100, Math.max(0, Number(obj.complexity_score) || 50)),
        confidence: Math.min(1, Math.max(0, Number(obj.confidence) || 0.5)),
      };

      return evaluation;
    } catch (e) {
      this.logger.error(`Validation error: ${e}`);
      return null;
    }
  }

  /**
   * Recalculate score from dimensions (for validation)
   */
  private recalculateScore(evaluation: ComplexityEvaluation): number {
    const reasoningScore = REASONING_DEPTH_SCORES[evaluation.reasoning_depth];
    const taskScore = TASK_TYPE_SCORES[evaluation.task_type];
    const constraintScore = CONSTRAINT_LEVEL_SCORES[evaluation.constraint_level];
    const accuracyScore = ACCURACY_SCORES[evaluation.required_accuracy];

    return Math.min(100, reasoningScore + taskScore + constraintScore + accuracyScore);
  }

  /**
   * Evaluate complexity using LOW model
   */
  async evaluate(messages: ChatMessage[]): Promise<{
    evaluation: ComplexityEvaluation;
    latencyMs: number;
    cached: boolean;
    promptHash: string;
  }> {
    const promptHash = this.hashPrompt(messages);
    
    // Check cache
    const cached = this.getCached(promptHash);
    if (cached) {
      this.logger.info(`[Helix] Complexity cache hit: score=${cached.complexity_score}`);
      return {
        evaluation: cached,
        latencyMs: 0,
        cached: true,
        promptHash,
      };
    }

    // Build evaluation prompt
    const lastUserMessage = messages
      .filter((m) => m.role === "user")
      .pop();
    
    const contextMessages = messages.slice(0, -1);
    
    let userPrompt: string;
    if (contextMessages.length > 0) {
      const contextStr = contextMessages
        .map((m) => `${m.role}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
        .join("\n");
      userPrompt = `Evaluate the cognitive complexity of the following conversation:

Conversation:
${contextStr}

Latest User Request:
${typeof lastUserMessage?.content === "string" ? lastUserMessage.content : JSON.stringify(lastUserMessage?.content)}`;
    } else {
      userPrompt = `Evaluate the cognitive complexity of the following user request:

${typeof lastUserMessage?.content === "string" ? lastUserMessage.content : JSON.stringify(lastUserMessage?.content)}`;
    }

    const startTime = Date.now();

    try {
      // Call LOW model
      const response = await fetch(`${this.lowProvider.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${this.lowProvider.apiKey}`,
        },
        body: JSON.stringify({
          model: this.lowProvider.model,
          messages: [
            { role: "system", content: COMPLEXITY_SYSTEM_PROMPT },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1, // Low temperature for consistent scoring
          max_tokens: 200,
        }),
      });

      const latencyMs = Date.now() - startTime;

      if (!response.ok) {
        throw new Error(`LOW model request failed: ${response.status}`);
      }

      const data = await response.json() as { choices: Array<{ message: { content: string } }> };
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error("Empty response from LOW model");
      }

      // Parse JSON from response (handle potential markdown code blocks)
      let jsonStr = content.trim();
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }

      const rawEval = JSON.parse(jsonStr);
      const evaluation = this.validateEvaluation(rawEval);

      if (!evaluation) {
        // Return default MID evaluation on validation failure
        this.logger.error("[Helix] Evaluation validation failed, defaulting to MID");
        return {
          evaluation: this.getDefaultEvaluation(),
          latencyMs,
          cached: false,
          promptHash,
        };
      }

      // Recalculate score for consistency
      evaluation.complexity_score = this.recalculateScore(evaluation);

      // Cache the result
      this.setCache(promptHash, evaluation);

      this.logger.info(
        `[Helix] Complexity evaluation: score=${evaluation.complexity_score} ` +
        `task=${evaluation.task_type} confidence=${evaluation.confidence.toFixed(2)}`
      );

      return {
        evaluation,
        latencyMs,
        cached: false,
        promptHash,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      this.logger.error(`[Helix] Complexity evaluation failed: ${error}`);
      
      // Return default MID evaluation on failure
      return {
        evaluation: this.getDefaultEvaluation(),
        latencyMs,
        cached: false,
        promptHash,
      };
    }
  }

  /**
   * Default evaluation (conservative MID)
   */
  private getDefaultEvaluation(): ComplexityEvaluation {
    return {
      reasoning_depth: "medium",
      task_type: "other",
      constraint_level: "medium",
      required_accuracy: "medium",
      estimated_token_size: "medium",
      complexity_score: 50,
      confidence: 0.6,
    };
  }
}
