import process from "node:process";

const ALLOWED_MODES = new Set(["off", "mock", "staging_llm"]);
const ALLOWED_PROVIDERS = new Set(["openai", "ollama"]);
const ALLOWED_REASONING_EFFORTS = new Set(["minimal", "low", "medium", "high"]);
const DEFAULT_MODE = "mock";
const DEFAULT_REASONING_EFFORT = "minimal";

const readNumber = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const readBoolean = (value, fallback) => {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  return fallback;
};

const readString = (value, fallback = "") =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

export const readMiraRuntimeConfig = (env = process.env) => {
  const requestedMode = readString(env.MIRA_LLM_MODE, DEFAULT_MODE).toLowerCase();
  const mode = ALLOWED_MODES.has(requestedMode) ? requestedMode : DEFAULT_MODE;
  const requestedProvider = readString(env.MIRA_LLM_PROVIDER, "");
  const provider = requestedProvider.toLowerCase();
  const defaultModel = provider === "ollama" ? "qwen2.5:0.5b" : "";
  const model = readString(env.MIRA_LLM_MODEL, defaultModel);
  const apiKey = readString(env.MIRA_LLM_API_KEY, "");
  const apiKeyConfigured = Boolean(apiKey);
  const providerWasValid = !provider || ALLOWED_PROVIDERS.has(provider);
  const llmModeEnabled = mode === "staging_llm";
  const providerConfigComplete = Boolean(
    llmModeEnabled &&
      providerWasValid &&
      ((provider === "openai" && model && apiKeyConfigured) ||
        (provider === "ollama" && model)),
  );
  const requestedReasoningEffort = readString(
    env.MIRA_LLM_REASONING_EFFORT,
    DEFAULT_REASONING_EFFORT,
  ).toLowerCase();
  const reasoningEffort = ALLOWED_REASONING_EFFORTS.has(requestedReasoningEffort)
    ? requestedReasoningEffort
    : DEFAULT_REASONING_EFFORT;

  const config = {
    mode,
    requestedMode,
    modeWasValid: mode === requestedMode,
    provider,
    requestedProvider,
    providerWasValid,
    model,
    apiKeyConfigured,
    providerConfigComplete,
    liveConfigurationValid:
      llmModeEnabled && mode === requestedMode && providerConfigComplete,
    timeoutMs: readNumber(env.MIRA_LLM_TIMEOUT_MS, 8000),
    maxTokens: readNumber(env.MIRA_LLM_MAX_TOKENS, 600),
    temperature: readNumber(env.MIRA_LLM_TEMPERATURE, 0.2),
    reasoningEffort,
    requestedReasoningEffort,
    reasoningEffortWasValid: reasoningEffort === requestedReasoningEffort,
    postValidationEnabled: readBoolean(env.MIRA_LLM_ENABLE_POST_VALIDATION, true),
  };

  Object.defineProperty(config, "apiKey", {
    value: apiKey,
    enumerable: false,
    configurable: false,
    writable: false,
  });

  return config;
};

export default readMiraRuntimeConfig;
