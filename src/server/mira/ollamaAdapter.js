import process from "node:process";

const miraStructuredOutputSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "answer",
    "handoffNeeded",
    "handoffReason",
    "suggestedFollowUps",
    "groundingStatus",
    "outputSafetyStatus",
  ],
  properties: {
    answer: { type: "string" },
    handoffNeeded: { type: "boolean" },
    handoffReason: { type: ["string", "null"] },
    suggestedFollowUps: {
      type: "array",
      items: { type: "string" },
    },
    groundingStatus: {
      type: "string",
      enum: ["grounded", "insufficient_context", "refused"],
    },
    outputSafetyStatus: {
      type: "string",
      enum: ["passed", "corrected", "refused"],
    },
  },
};

const buildProviderInput = ({ promptPayload }) =>
  [
    promptPayload.context,
    promptPayload.avoidClaims,
    "",
    "User and presentation context:",
    promptPayload.user,
    "",
    "Please provide a helpful, natural, complete answer (2-4 sentences) based strictly on the approved context.",
    "Detected risk flags:",
    JSON.stringify(promptPayload.riskFlags || []),
  ].join("\n");

export const runOllamaMiraAdapter = async ({
  message,
  conversationId,
  promptPayload,
  config,
}) => {
  const startedAt = Date.now();
  const baseUrl = config.baseUrl || process.env.MIRA_OLLAMA_BASE_URL || "http://127.0.0.1:11434";
  const model = config.model || "qwen2.5:0.5b";
  const timeoutMs = config.timeoutMs || 30000;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: promptPayload.system },
          { role: "user", content: buildProviderInput({ promptPayload }) },
        ],
        format: miraStructuredOutputSchema,
        stream: false,
        options: {
          temperature: config.temperature || 0.2,
          num_predict: config.maxTokens || 1024,
        },
      }),
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        provider: "ollama",
        mode: "staging_llm",
        implemented: true,
        modelOutput: null,
        error: "provider_error",
        metadata: {
          latencyMs,
          httpStatus: response.status,
          providerStatus: "error",
          fallbackReason: `provider_http_${response.status}`,
        },
      };
    }

    const data = await response.json();
    let modelOutput = null;
    let parseError = "";
    try {
      if (typeof data.message?.content === "string") {
        let text = data.message.content.trim();
        if (text.startsWith("```")) {
          text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        }
        const firstBrace = text.indexOf("{");
        const lastBrace = text.lastIndexOf("}");
        if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
          text = text.slice(firstBrace, lastBrace + 1);
        }
        modelOutput = JSON.parse(text);
      } else {
        modelOutput = data.message?.content;
      }
    } catch {
      parseError = "malformed_model_json";
    }

    return {
      provider: "ollama",
      mode: "staging_llm",
      implemented: true,
      modelOutput,
      error: parseError,
      metadata: {
        latencyMs,
        httpStatus: response.status,
        providerStatus: parseError ? "malformed" : "ok",
        fallbackReason: parseError,
        messageLength: typeof message === "string" ? message.length : 0,
        conversationId: typeof conversationId === "string" ? conversationId : "",
        configuredProvider: "ollama",
        configuredModel: model,
      },
    };
  } catch (error) {
    const isTimeout = error?.name === "AbortError";
    return {
      provider: "ollama",
      mode: "staging_llm",
      implemented: true,
      modelOutput: null,
      error: isTimeout ? "provider_timeout" : "provider_exception",
      metadata: {
        latencyMs: Date.now() - startedAt,
        httpStatus: null,
        providerStatus: isTimeout ? "timeout" : "exception",
        fallbackReason: isTimeout ? "provider_timeout" : "provider_exception",
      },
    };
  } finally {
    clearTimeout(timeout);
  }
};

export default runOllamaMiraAdapter;
