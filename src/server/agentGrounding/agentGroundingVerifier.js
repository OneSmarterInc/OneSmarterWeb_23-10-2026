const STOP_WORDS = new Set([
  "a", "an", "and", "approved", "are", "as", "at", "be", "been", "being", "by", "can", "could",
  "do", "does", "for", "from", "has", "have", "in", "is", "it", "its", "may", "of",
  "on", "or", "our", "status", "that", "the", "their", "these", "this", "to", "was", "we",
  "were", "will", "with", "would", "you", "your", "actually", "before",
]);
const BOUNDARY_LANGUAGE = /\b(?:not|no approved|cannot|can't|does not|doesn't|do not|don't|is not|isn't|unable|unknown|instead|rather than|without guaranteeing|cannot confirm|cannot verify)\b/i;
const CONVERSATIONAL = /^(?:yes|no|correct|thanks?|please|i can help|i can explain|would you like|what would you like)\b/i;
const HANDOFF_GUIDANCE = /\b(?:contact|email|reach out to)\b.{0,100}\bcare@onesmarter\.com\b/i;
const GENERIC_FRAMING = /\b(?:address|serve|support) different (?:operational |business )?(?:needs|purposes|use cases)\b/i;
const SAFE_ENTITIES = new Set([
  "onesmarter", "one smarter", "mira", "elena", "ravi", "selene", "theo",
  "all", "autonomous", "bill", "built", "customers", "every", "for", "implementation",
  "each", "in", "includes", "it", "key", "one", "put", "secure", "supports",
  "the", "there", "these", "this", "together", "your",
]);
const HIGH_RISK_FACT_TERMS = new Set([
  "autonomously", "delegate", "guarantee", "integrate", "launch", "price", "cost", "host", "schedule", "connect", "sync",
]);

const splitStatements = (value) => String(value).split(/(?<=[.!?])\s+/).filter(Boolean);

const evidenceText = (entries = []) => entries.flatMap((entry) => [
  entry?.title,
  entry?.approvedSummary,
  ...(entry?.sourceFacts || []),
  ...(entry?.allowedClaims || []),
  entry?.handoffGuidance,
]).filter(Boolean).flatMap(splitStatements)
  .filter((value) => !BOUNDARY_LANGUAGE.test(value)).join(" ");

const negativeEvidence = (entries = []) => entries.flatMap((entry) => [
  ...(entry?.sourceFacts || []).flatMap(splitStatements)
    .filter((fact) => BOUNDARY_LANGUAGE.test(fact)),
  ...(entry?.requiredQualifications || []).flatMap(splitStatements),
  ...(entry?.disallowedClaims || []).flatMap(splitStatements),
  ...(entry?.unsupportedExtensions || []).flatMap(splitStatements),
]).filter(Boolean);

const normalize = (value = "") => String(value).toLowerCase()
  .replace(/[‐‑‒–—]/g, "-")
  .replace(/[^a-z0-9/@.-]+/g, " ")
  .replace(/\s+/g, " ").trim();

const stem = (token) => token
  .replace(/(ments?|ations?|ingly|edly|ing|ed|ies|s)$/i, (suffix) => suffix.startsWith("ie") ? "y" : "")
  .replace(/(.)\1$/, "$1")
  .replace(/^certif(?:i|ic)$/, "certify");

const substantiveTokens = (value) => normalize(value).split(" ")
  .map((token) => token.replace(/^[./-]+|[./-]+$/g, ""))
  .filter((token) => !STOP_WORDS.has(token))
  .map(stem)
  .filter((token) => token.length >= 3);

export const namedEntities = (sentence) => {
  const words = [...String(sentence).matchAll(/\b(?:[A-Z]{2,}(?:\/[A-Z]+)?|[A-Za-z]*[a-z][A-Z][A-Za-z]*|[A-Z][a-z]{2,}|\d[\d.-]{2,})\b/g)]
    .map((match) => normalize(match[0]));
  return [...new Set(words.filter((word) => !SAFE_ENTITIES.has(word) && !STOP_WORDS.has(word)))];
};

const factualSentences = (answer) => String(answer).split(/(?<=[.!?])\s+|\n+/)
  .map((sentence) => sentence.trim())
  .filter(Boolean)
  .filter((sentence) => !sentence.endsWith(":"))
  .filter((sentence) => !sentence.endsWith("?"))
  .filter((sentence) => /[.!]$/.test(sentence) || /\b(?:is|are|has|have|provides?|supports?|includes?|covers?|uses?|runs?|costs?|launches?|integrates?|connects?|guarantees?)\b/i.test(sentence))
  .filter((sentence) => !BOUNDARY_LANGUAGE.test(sentence))
  .filter((sentence) => !CONVERSATIONAL.test(sentence))
  .filter((sentence) => !HANDOFF_GUIDANCE.test(sentence))
  .filter((sentence) => !GENERIC_FRAMING.test(sentence));

export const verifyAgentAnswerGrounding = ({ answer = "", approvedEntries = [] } = {}) => {
  const evidence = evidenceText(approvedEntries);
  const normalizedEvidence = normalize(evidence);
  const evidenceTokens = new Set(substantiveTokens(evidence));
  const negativeTokenSets = negativeEvidence(approvedEntries).map((fact) => [...new Set(substantiveTokens(fact))]);
  const violations = [];
  const unsupportedAssertions = [];
  const assertions = factualSentences(answer);

  if (assertions.length && !approvedEntries.length) violations.push("factual_answer_without_approved_evidence");
  for (const assertion of assertions) {
    const unsupportedEntities = namedEntities(assertion)
      .filter((entity) => !normalizedEvidence.includes(entity));
    if (unsupportedEntities.length) {
      violations.push("unsupported_named_entity");
      unsupportedAssertions.push(assertion);
      continue;
    }
    const tokens = [...new Set(substantiveTokens(assertion))];
    if (tokens.length < 2) continue;
    const matched = tokens.filter((token) => evidenceTokens.has(token)).length;
    const coverage = matched / tokens.length;
    const contradictsBoundary = coverage < 0.5 && negativeTokenSets.some((negativeTokens) => {
      const overlap = tokens.filter((token) => negativeTokens.includes(token)).length;
      return overlap >= 3 && overlap / Math.min(tokens.length, negativeTokens.length) >= 0.5;
    });
    const normalizedAssertion = normalize(assertion);
    const novelHighRiskTerm = [...HIGH_RISK_FACT_TERMS]
      .some((term) => normalizedAssertion.includes(term) && !normalizedEvidence.includes(term));
    if (contradictsBoundary || novelHighRiskTerm || matched < 2 || coverage < 0.3) {
      violations.push("unsupported_factual_assertion");
      unsupportedAssertions.push(assertion);
    }
  }

  return {
    grounded: violations.length === 0,
    violations: [...new Set(violations)],
    diagnosticCode: violations.length ? "answer_not_grounded_in_retrieved_evidence" : "grounding_verified",
    assertionCount: assertions.length,
    unsupportedAssertions,
  };
};

export default verifyAgentAnswerGrounding;
