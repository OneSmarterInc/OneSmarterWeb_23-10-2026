const phraseAliases = [
  [/\bone\s*[-\s]\s*smarter\s+inc\b/g, "onesmarter"],
  [/\bonesmarter\s+inc\b/g, "onesmarter"],
  [/\bone\s*[-\s]\s*smarter\b/g, "onesmarter"],
  [/\b1smarter\b/g, "onesmarter"],
  [/\bonsmarter\b/g, "onesmarter"],
  [/\bonesmater\b/g, "onesmarter"],
  [/\bonesmarterr\b/g, "onesmarter"],
  [/\bcase\s+managment\b/g, "case management"],
  [/\bbil\s+audit\b/g, "bill audit"],
  [/\bbillpay\b/g, "bill pay"],
  [/\bas\s*[-\s]\s*400\b/g, "as400"],
  [/\bagentic\s+servces\b/g, "agentic services"],
  [/\bcliam\s+data\b/g, "claims data"],
  [/\bclams\s+data\b/g, "claims data"],
  [/\bpatient\s+info\b/g, "patient information"],
  [/\bphi\s+info\b/g, "phi"],
  [/\bsoc\s*ii\b/g, "soc 2"],
  [/\bwhat can (?:onesmarter|you|ur company)\s+do\s+for\s+us\b/g, "what does onesmarter do"],
  [/\bwhat can (?:onesmarter|you|ur company)\s+do\b/g, "what does onesmarter do"],
  [/\bwhat do you do\b/g, "what does onesmarter do"],
  [/\bwhat does your company do\b/g, "what does onesmarter do"],
  [/\bhow can (?:onesmarter|you)\s+help(?:\s+us)?\b/g, "what does onesmarter do"],
  [/\btell me what onesmarter does\b/g, "what does onesmarter do"],
  [/\bwhat are your capabilities\b/g, "what does onesmarter do"],
  [/\breveel\s+system\s+prompt\b/g, "reveal system prompt"],
  [/\bhidden\s+instrctions\b/g, "hidden instructions"],
];

const tokenAliases = new Map([
  ["wat", "what"],
  ["wht", "what"],
  ["u", "you"],
  ["ur", "your"],
  ["r", "are"],
  ["wit", "with"],
  ["abt", "about"],
  ["ofer", "offer"],
  ["offr", "offer"],
  ["platfrom", "platform"],
  ["platfroms", "platforms"],
  ["helthcare", "healthcare"],
  ["healtcare", "healthcare"],
  ["healhcare", "healthcare"],
  ["cliams", "claims"],
  ["hippa", "hipaa"],
  ["hipa", "hipaa"],
  ["soc2", "soc 2"],
  ["certifed", "certified"],
  ["certifcation", "certification"],
  ["compliane", "compliance"],
  ["compliace", "compliance"],
  ["gaurentee", "guarantee"],
  ["guarentee", "guarantee"],
  ["tickting", "ticketing"],
  ["legel", "legal"],
  ["leagal", "legal"],
  ["medcal", "medical"],
  ["ignroe", "ignore"],
  ["instrutions", "instructions"],
  ["instrctions", "instructions"],
  ["reveel", "reveal"],
  ["uplod", "upload"],
]);

const likelyOneSmarterTerms = [
  "onesmarter",
  "platform",
  "platforms",
  "healthcare",
  "claims",
  "hipaa",
  "soc 2",
  "compliance",
  "ticketing",
  "case management",
  "bill audit",
  "bill pay",
  "as400",
  "agentic",
  "ai",
  "trust center",
  "business services",
  "technology services",
];

const normalizeBaseText = (message = "") =>
  String(message)
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s/.-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export const normalizeMiraMessageText = (message = "") => {
  let normalized = normalizeBaseText(message);

  for (const [pattern, replacement] of phraseAliases) {
    normalized = normalized.replace(pattern, replacement);
  }

  normalized = normalized
    .split(" ")
    .map((token) => tokenAliases.get(token) || token)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
};

const hasLikelyOneSmarterIntent = (text) =>
  likelyOneSmarterTerms.some((term) => text.includes(term));

export const normalizeMiraIntent = ({
  originalMessage = "",
  normalizedMessage,
  retrievalConfidence = "low",
  riskFlags = [],
} = {}) => {
  const interpretedQuery =
    typeof normalizedMessage === "string"
      ? normalizeMiraMessageText(normalizedMessage)
      : normalizeMiraMessageText(originalMessage);
  const originalBase = normalizeBaseText(originalMessage);
  const normalizationApplied = interpretedQuery !== originalBase;
  const hasSafetyRisk = Array.isArray(riskFlags) && riskFlags.length > 0;
  const likelyInScope = hasLikelyOneSmarterIntent(interpretedQuery);

  return {
    interpretedQuery,
    normalizationApplied,
    needsClarification:
      retrievalConfidence === "low" && likelyInScope && !hasSafetyRisk,
    confidence: normalizationApplied ? "medium" : "high",
    method: "deterministic",
  };
};

export default normalizeMiraIntent;
