/**
 * Helix Router - Smart Two-Stage LLM Router for OpenClaw
 * 
 * Pure JavaScript implementation for immediate use.
 * 
 * Usage:
 *   node helix-router.js
 * 
 * Environment Variables:
 *   HELIX_PORT          Server port (default: 8403)
 *   HELIX_PRO_URL       PRO provider URL
 *   HELIX_PRO_KEY       PRO API key
 *   HELIX_PRO_MODEL     PRO model ID
 *   HELIX_MID_URL       MID provider URL
 *   HELIX_MID_KEY       MID API key
 *   HELIX_MID_MODEL     MID model ID
 *   HELIX_LOW_URL       LOW provider URL
 *   HELIX_LOW_KEY       LOW API key
 *   HELIX_LOW_MODEL     LOW model ID
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ============= Configuration =============

const DEFAULT_CONFIG = {
  providers: {
    pro: {
      baseUrl: process.env.HELIX_PRO_URL || 'http://192.168.1.60:8310/v1',
      apiKey: process.env.HELIX_PRO_KEY || '',
      model: process.env.HELIX_PRO_MODEL || 'kiro-proxy/pro',
    },
    mid: {
      baseUrl: process.env.HELIX_MID_URL || 'http://192.168.1.60:8310/v1',
      apiKey: process.env.HELIX_MID_KEY || '',
      model: process.env.HELIX_MID_MODEL || 'kiro-proxy/mid',
    },
    low: {
      baseUrl: process.env.HELIX_LOW_URL || 'http://192.168.1.60:8310/v1',
      apiKey: process.env.HELIX_LOW_KEY || '',
      model: process.env.HELIX_LOW_MODEL || 'kiro-proxy/low',
    },
  },
  routing: {
    proThreshold: parseInt(process.env.HELIX_PRO_THRESHOLD || '75'),
    midThreshold: parseInt(process.env.HELIX_MID_THRESHOLD || '35'),
  },
};

const PORT = parseInt(process.env.HELIX_PORT || '8403');

// ============= Complexity System Prompt =============

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
   - classification, extraction, summarization, writing, coding,
   - architecture_design, mathematical_reasoning, visualization,
   - multi_step_planning, other

3. constraint_level: low, medium, high

4. required_accuracy: low, medium, high

5. estimated_token_size: small, medium, large, very_large

Then compute a complexity_score from 0 to 100.

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

const REASONING_SCORES = { low: 10, medium: 20, high: 30 };
const TASK_TYPE_SCORES = {
  classification: 5, extraction: 5, summarization: 10, writing: 15,
  coding: 20, visualization: 15, architecture_design: 30,
  mathematical_reasoning: 30, multi_step_planning: 25, other: 15
};
const CONSTRAINT_SCORES = { low: 5, medium: 10, high: 20 };
const ACCURACY_SCORES = { low: 5, medium: 10, high: 20 };

// ============= Stats =============

const stats = {
  totalRequests: 0,
  routeCounts: { pro: 0, mid: 0, low: 0 },
  avgScore: 0,
  totalScore: 0,
  avgLatency: 0,
  totalLatency: 0,
};

// ============= Logging =============

const logDir = path.join(os.homedir(), '.openclaw', 'helix-router');
const logFile = path.join(logDir, 'routing.log');

function ensureLogDir() {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
}

function log(msg) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${msg}`);
}

function logRouting(entry) {
  ensureLogDir();
  fs.appendFileSync(logFile, JSON.stringify(entry) + '\n', 'utf-8');
  
  stats.totalRequests++;
  stats.routeCounts[entry.route]++;
  stats.totalScore += entry.score;
  stats.totalLatency += entry.latencyMs;
  stats.avgScore = Math.round(stats.totalScore / stats.totalRequests);
  stats.avgLatency = Math.round(stats.totalLatency / stats.totalRequests);
}

// ============= Complexity Evaluator =============

const complexityCache = new Map();
const CACHE_TTL = 3600000; // 1 hour

function hashPrompt(messages) {
  const content = messages
    .filter(m => m.role === 'user')
    .map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content))
    .join('|');
  
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    hash = ((hash << 5) - hash) + content.charCodeAt(i);
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

function validateEvaluation(raw) {
  try {
    const validReasoning = ['low', 'medium', 'high'];
    const validTasks = ['classification', 'extraction', 'summarization', 'writing',
      'coding', 'architecture_design', 'mathematical_reasoning',
      'visualization', 'multi_step_planning', 'other'];
    
    const evaluation = {
      reasoning_depth: validReasoning.includes(raw.reasoning_depth) ? raw.reasoning_depth : 'medium',
      task_type: validTasks.includes(raw.task_type) ? raw.task_type : 'other',
      constraint_level: ['low', 'medium', 'high'].includes(raw.constraint_level) ? raw.constraint_level : 'medium',
      required_accuracy: ['low', 'medium', 'high'].includes(raw.required_accuracy) ? raw.required_accuracy : 'medium',
      estimated_token_size: ['small', 'medium', 'large', 'very_large'].includes(raw.estimated_token_size) ? raw.estimated_token_size : 'medium',
      complexity_score: Math.min(100, Math.max(0, Number(raw.complexity_score) || 50)),
      confidence: Math.min(1, Math.max(0, Number(raw.confidence) || 0.5)),
    };
    
    // Recalculate score
    const reasoningScore = REASONING_SCORES[evaluation.reasoning_depth];
    const taskScore = TASK_TYPE_SCORES[evaluation.task_type] || 15;
    const constraintScore = CONSTRAINT_SCORES[evaluation.constraint_level];
    const accuracyScore = ACCURACY_SCORES[evaluation.required_accuracy];
    
    evaluation.complexity_score = Math.min(100, reasoningScore + taskScore + constraintScore + accuracyScore);
    
    return evaluation;
  } catch (e) {
    return null;
  }
}

async function evaluateComplexity(messages, config) {
  const promptHash = hashPrompt(messages);
  
  // Check cache
  const cached = complexityCache.get(promptHash);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    log(`[Helix] Complexity cache hit: score=${cached.evaluation.complexity_score}`);
    return { evaluation: cached.evaluation, latencyMs: 0, cached: true, promptHash };
  }
  
  // Build prompt
  const lastUserMessage = messages.filter(m => m.role === 'user').pop();
  const contextMessages = messages.slice(0, -1);
  
  let userPrompt;
  if (contextMessages.length > 0) {
    const contextStr = contextMessages
      .map(m => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
      .join('\n');
    userPrompt = `Evaluate the cognitive complexity of the following conversation:\n\nConversation:\n${contextStr}\n\nLatest User Request:\n${typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage?.content)}`;
  } else {
    userPrompt = `Evaluate the cognitive complexity of the following user request:\n\n${typeof lastUserMessage?.content === 'string' ? lastUserMessage.content : JSON.stringify(lastUserMessage?.content)}`;
  }
  
  const startTime = Date.now();
  
  try {
    const response = await fetch(`${config.providers.low.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.providers.low.apiKey}`,
      },
      body: JSON.stringify({
        model: config.providers.low.model,
        messages: [
          { role: 'system', content: COMPLEXITY_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 200,
      }),
    });
    
    const latencyMs = Date.now() - startTime;
    
    if (!response.ok) {
      throw new Error(`LOW model request failed: ${response.status}`);
    }
    
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    
    if (!content) {
      throw new Error('Empty response from LOW model');
    }
    
    // Parse JSON
    let jsonStr = content.trim();
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }
    
    const rawEval = JSON.parse(jsonStr);
    const evaluation = validateEvaluation(rawEval);
    
    if (!evaluation) {
      log(`[Helix] Evaluation validation failed, defaulting to MID`);
      return { evaluation: getDefaultEvaluation(), latencyMs, cached: false, promptHash };
    }
    
    // Cache result
    complexityCache.set(promptHash, { evaluation, timestamp: Date.now() });
    
    // Cleanup old cache entries
    if (complexityCache.size > 1000) {
      const entries = Array.from(complexityCache.entries());
      entries.sort((a, b) => a[1].timestamp - b[1].timestamp);
      entries.slice(0, entries.length - 1000).forEach(([key]) => complexityCache.delete(key));
    }
    
    log(`[Helix] Complexity evaluation: score=${evaluation.complexity_score} task=${evaluation.task_type} confidence=${evaluation.confidence.toFixed(2)}`);
    
    return { evaluation, latencyMs, cached: false, promptHash };
  } catch (error) {
    log(`[Helix] Complexity evaluation failed: ${error.message}`);
    return { evaluation: getDefaultEvaluation(), latencyMs: Date.now() - startTime, cached: false, promptHash };
  }
}

function getDefaultEvaluation() {
  return {
    reasoning_depth: 'medium',
    task_type: 'other',
    constraint_level: 'medium',
    required_accuracy: 'medium',
    estimated_token_size: 'medium',
    complexity_score: 50,
    confidence: 0.6,
  };
}

// ============= Routing Decision =============

function makeRoutingDecision(evaluation, cached) {
  const { complexity_score, task_type, confidence, estimated_token_size } = evaluation;
  
  let tier, reasoning;
  
  // Rule 1: Very large tokens always go to PRO
  if (estimated_token_size === 'very_large') {
    return { tier: 'pro', score: complexity_score, taskType: task_type, confidence, reasoning: 'Very large token size forces PRO', cached };
  }
  
  // Rule 2: Low confidence defaults to MID
  if (confidence < 0.6) {
    return { tier: 'mid', score: complexity_score, taskType: task_type, confidence, reasoning: `Low confidence (${confidence.toFixed(2)}) defaults to MID`, cached };
  }
  
  // Rule 3: High score with low confidence -> MID
  if (complexity_score > 90 && confidence < 0.7) {
    return { tier: 'mid', score: complexity_score, taskType: task_type, confidence, reasoning: `High score but low confidence -> MID`, cached };
  }
  
  // Rule 4: MID-preferred tasks
  const midPreferred = ['visualization', 'writing', 'summarization'];
  if (midPreferred.includes(task_type) && complexity_score < 70) {
    return { tier: 'mid', score: complexity_score, taskType: task_type, confidence, reasoning: `${task_type} prefers MID`, cached };
  }
  
  // Rule 5: Coding < 70 stays in MID
  if (task_type === 'coding' && complexity_score < 70) {
    return { tier: 'mid', score: complexity_score, taskType: task_type, confidence, reasoning: 'Coding stays in MID', cached };
  }
  
  // Default score-based routing
  if (complexity_score >= DEFAULT_CONFIG.routing.proThreshold) {
    tier = 'pro';
    reasoning = `Score ${complexity_score} >= ${DEFAULT_CONFIG.routing.proThreshold} -> PRO`;
  } else if (complexity_score >= DEFAULT_CONFIG.routing.midThreshold) {
    tier = 'mid';
    reasoning = `Score ${complexity_score} >= ${DEFAULT_CONFIG.routing.midThreshold} -> MID`;
  } else {
    tier = 'low';
    reasoning = `Score ${complexity_score} < ${DEFAULT_CONFIG.routing.midThreshold} -> LOW`;
  }
  
  return { tier, score: complexity_score, taskType: task_type, confidence, reasoning, cached };
}

// ============= Request Forwarding =============

async function forwardRequest(request, provider, tier) {
  const forwardedRequest = {
    ...request,
    model: provider.model,
  };
  
  // Map explicit tier requests
  if (request.model === 'helix-router/pro' || request.model === 'pro') {
    forwardedRequest.model = DEFAULT_CONFIG.providers.pro.model;
  } else if (request.model === 'helix-router/mid' || request.model === 'mid') {
    forwardedRequest.model = DEFAULT_CONFIG.providers.mid.model;
  } else if (request.model === 'helix-router/low' || request.model === 'low') {
    forwardedRequest.model = DEFAULT_CONFIG.providers.low.model;
  }
  
  const response = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${provider.apiKey}`,
    },
    body: JSON.stringify(forwardedRequest),
  });
  
  return response;
}

// ============= HTTP Server =============

async function handleChatCompletion(req, res) {
  const body = await readBody(req);
  let request;
  
  try {
    request = JSON.parse(body);
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Invalid JSON' }));
    return;
  }
  
  const requestId = `hr_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  const startTime = Date.now();
  
  try {
    // Step 1: Evaluate complexity
    const evalResult = await evaluateComplexity(request.messages, DEFAULT_CONFIG);
    const evaluationLatencyMs = evalResult.latencyMs;
    
    // Step 2: Make routing decision
    const decision = makeRoutingDecision(evalResult.evaluation, evalResult.cached);
    
    // Step 3: Get provider
    const provider = DEFAULT_CONFIG.providers[decision.tier];
    
    log(`[Helix] Request ${requestId}: ${decision.tier.toUpperCase()} (score: ${decision.score}, task: ${decision.taskType}) ${decision.cached ? '(cached)' : ''}`);
    
    // Step 4: Forward request
    if (request.stream) {
      // Handle streaming
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      });
      
      const streamRequest = { ...request, model: provider.model, stream: true };
      const response = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${provider.apiKey}`,
        },
        body: JSON.stringify(streamRequest),
      });
      
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let totalTokens = 0;
      
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        res.write(chunk);
        
        // Estimate tokens
        if (chunk.includes('"content"')) {
          totalTokens += Math.ceil(chunk.length / 4);
        }
      }
      
      res.write('data: [DONE]\n\n');
      res.end();
      
      // Log
      const totalLatencyMs = Date.now() - startTime;
      logRouting({
        timestamp: new Date().toISOString(),
        requestId,
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
      });
    } else {
      // Handle non-streaming
      const response = await forwardRequest(request, provider, decision.tier);
      const data = await response.json();
      
      // Update model name
      data.model = `helix-router/${decision.tier}`;
      
      const totalLatencyMs = Date.now() - startTime;
      
      // Log
      logRouting({
        timestamp: new Date().toISOString(),
        requestId,
        score: decision.score,
        route: decision.tier,
        modelUsed: provider.model,
        taskType: decision.taskType,
        confidence: decision.confidence,
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
        latencyMs: totalLatencyMs,
        evaluationLatencyMs,
        mainLatencyMs: totalLatencyMs - evaluationLatencyMs,
        cached: decision.cached,
        promptHash: evalResult.promptHash,
      });
      
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    }
  } catch (error) {
    log(`[Helix] Request ${requestId} failed: ${error.message}`);
    
    // Fallback to MID
    log(`[Helix] Falling back to MID tier`);
    const provider = DEFAULT_CONFIG.providers.mid;
    const response = await forwardRequest(request, provider, 'mid');
    const data = await response.json();
    
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString()));
    req.on('error', reject);
  });
}

// ============= Main Server =============

const server = http.createServer(async (req, res) => {
  const url = req.url;
  const method = req.method;
  
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  
  try {
    if (url === '/health' || url === '/v1/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', service: 'helix-router', version: '1.0.0' }));
      return;
    }
    
    if (url === '/stats' || url === '/v1/stats') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        ...stats,
        cacheSize: complexityCache.size,
        config: {
          pro: DEFAULT_CONFIG.providers.pro.model,
          mid: DEFAULT_CONFIG.providers.mid.model,
          low: DEFAULT_CONFIG.providers.low.model,
        },
      }, null, 2));
      return;
    }
    
    if (url === '/v1/models' && method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        object: 'list',
        data: [
          { id: 'helix-router/auto', object: 'model', owned_by: 'helix' },
          { id: 'helix-router/pro', object: 'model', owned_by: 'helix' },
          { id: 'helix-router/mid', object: 'model', owned_by: 'helix' },
          { id: 'helix-router/low', object: 'model', owned_by: 'helix' },
        ],
      }));
      return;
    }
    
    if (url === '/v1/chat/completions' && method === 'POST') {
      await handleChatCompletion(req, res);
      return;
    }
    
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  } catch (error) {
    log(`Server error: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Internal server error' }));
  }
});

// Start server
server.listen(PORT, () => {
  console.log('╔═══════════════════════════════════════════════════════════════╗');
  console.log('║                    Helix Router v1.0.0                        ║');
  console.log('║         Smart Two-Stage LLM Router for OpenClaw              ║');
  console.log('╚═══════════════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`Server listening on http://127.0.0.1:${PORT}`);
  console.log('');
  console.log('Routes:');
  console.log(`  • http://127.0.0.1:${PORT}/v1/chat/completions  - Main chat endpoint`);
  console.log(`  • http://127.0.0.1:${PORT}/v1/models           - List available models`);
  console.log(`  • http://127.0.0.1:${PORT}/health              - Health check`);
  console.log(`  • http://127.0.0.1:${PORT}/stats               - Routing statistics`);
  console.log('');
  console.log('Providers:');
  console.log(`  • PRO: ${DEFAULT_CONFIG.providers.pro.model}`);
  console.log(`  • MID: ${DEFAULT_CONFIG.providers.mid.model}`);
  console.log(`  • LOW: ${DEFAULT_CONFIG.providers.low.model}`);
  console.log('');
  console.log('Thresholds:');
  console.log(`  • PRO: score >= ${DEFAULT_CONFIG.routing.proThreshold}`);
  console.log(`  • MID: score >= ${DEFAULT_CONFIG.routing.midThreshold}`);
  console.log(`  • LOW: score < ${DEFAULT_CONFIG.routing.midThreshold}`);
  console.log('');
  console.log('Press Ctrl+C to stop.');
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.close(() => {
    console.log('Server stopped.');
    process.exit(0);
  });
});
