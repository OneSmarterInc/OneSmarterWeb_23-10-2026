import process from "node:process";

// This adapter is used only by the manual Café authoring tool.
export const readCafeOllamaConfig = (env = process.env) => {
  const baseUrl = new URL(env.CAFE_OLLAMA_BASE_URL || "http://127.0.0.1:11434");
  if (
    baseUrl.protocol !== "http:" ||
    !["127.0.0.1", "[::1]", "localhost"].includes(baseUrl.hostname) ||
    baseUrl.username || baseUrl.password || baseUrl.search || baseUrl.hash ||
    baseUrl.pathname !== "/"
  ) {
    throw new Error("Café Ollama endpoint must be a local loopback HTTP origin.");
  }
  const model = (env.CAFE_OLLAMA_MODEL || "qwen2.5:0.5b").trim();
  if (!model || model.toLowerCase().includes("cloud")) {
    throw new Error("Café requires a local Ollama model; cloud models are not allowed.");
  }
  const timeoutMs = Number(env.CAFE_GENERATION_TIMEOUT_MS || 120000);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 600000) {
    throw new Error("CAFE_GENERATION_TIMEOUT_MS must be an integer from 1 through 600000.");
  }
  return { baseUrl: baseUrl.origin, model, timeoutMs };
};

export const generateCafeWithOllama = async ({ prompt, schema, env = process.env }) => {
  const { baseUrl, model, timeoutMs } = readCafeOllamaConfig(env);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const request = async (route, body) => {
    let response;
    try {
      response = await fetch(`${baseUrl}${route}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        redirect: "error",
        signal: controller.signal,
        body: JSON.stringify(body),
      });
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error(`Café Ollama is unavailable at ${baseUrl}. Start local Ollama and retry.`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`Café Ollama ${route} failed with HTTP ${response.status}. Ensure the local model '${model}' is installed.`);
    }
    try {
      return await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      throw new Error("Café Ollama returned an invalid JSON response.", { cause: error });
    }
  };

  try {
    // Cloud-backed models can also be exposed by a local Ollama server.
    const details = await request("/api/show", { model });
    if (!details || typeof details !== "object" || Array.isArray(details) ||
      details.remote_model || details.remote_host || !details.model_info) {
      throw new Error("Café requires an installed local model; remote or unverified models are not allowed.");
    }
    const response = await request("/api/chat", {
      model,
      messages: [{ role: "user", content: prompt }],
      format: schema,
      stream: false,
      think: false,
      options: { num_predict: 4096 },
    });
    if (response?.done !== true || response.done_reason === "length") {
      throw new Error("Café Ollama returned an incomplete or truncated generation.");
    }
    if (typeof response.message?.content !== "string" || !response.message.content.trim()) {
      throw new Error("Café Ollama returned no text output.");
    }
    return { model, content: response.message.content };
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`Café Ollama generation timed out after ${timeoutMs} ms.`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
};
