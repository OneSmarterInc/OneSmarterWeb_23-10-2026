/**
 * Safety and Content Moderation Guard for Café Conversations
 * Prevents agents from answering or generating sensitive, sexually explicit,
 * pornographic, adult entertainment, violent, or inappropriate content.
 */

import { namedEntities } from "../../server/agentGrounding/agentGroundingVerifier.js";

// Normalized typo / leetspeak substitutions
const normalizeSafetyText = (input) => {
  if (typeof input !== "string") return "";
  let text = input.toLowerCase().trim();

  // Common leetspeak substitutions
  text = text.replace(/0/g, "o");
  text = text.replace(/1/g, "i");
  text = text.replace(/3/g, "e");
  text = text.replace(/4/g, "a");
  text = text.replace(/5/g, "s");
  text = text.replace(/@/g, "a");
  text = text.replace(/\$/g, "s");
  text = text.replace(/[*_~`]/g, "");

  // Common phonetics / typos
  text = text.replace(/\bleoni\b/g, "leone");
  text = text.replace(/\bprn\b|\bp0rn\b/g, "porn");
  text = text.replace(/\bsexx+\b/g, "sex");

  return text;
};

// Sexually explicit, adult entertainment, and pornographic patterns
const SEXUAL_AND_ADULT_PATTERNS = [
  // Core pornography & explicit media
  /\b(?:porn|porno|pornography|pornographic|erotic|erotica|erotism|nsfw|xxx|hentai)\b/i,
  /\b(?:adult\s+film|adult\s+video|adult\s+actress|adult\s+actor|adult\s+star|adult\s+industry|adult\s+entertainer)\b/i,
  /\b(?:pornstar|porn\s*star|camgirl|webcam\s+model|strip\s*club|stripper|striptease)\b/i,
  /\b(?:onlyfans|playboy|penthouse|brazzers|pornhub|xvideos|xhamster|redtube)\b/i,
  
  // Well-known adult entertainment actors/figures often queried informally
  /\b(?:sunny\s+leone|sunny\s+leoni|mia\s+khalifa|johnny\s+sins|danny\s+d|sasha\s+grey|stormy\s+daniels|riley\s+reid)\b/i,

  // Sexual acts, anatomy & intimate content
  /\b(?:sex|sexual|sexually|sexy|sexuality)\b/i,
  /\b(?:intercourse|masturbat(?:e|ion|ing)?|orgasm|ejaculat(?:e|ion|ing)?)\b/i,
  /\b(?:blowjob|handjob|fellatio|cunnilingus|penetrat(?:e|ion)|dildo|vibrator)\b/i,
  /\b(?:penis|vagina|clitoris|genitals?|testicles?|phallus)\b/i,
  /\b(?:boobs?|tits?|breasts?)\b/i,
  /\b(?:naked|nudity|nudes?|undress|unclothed)\b/i,
  /\b(?:escort\s+service|prostitut(?:e|ion)|brothel|sex\s*worker|sex\s*trade)\b/i,
  /\b(?:erotic\s+thriller|sex\s*symbol|sexual\s*arousal|sexually\s*suggestive)\b/i,

  // Direct romantic / sexual propositions to agents
  /\b(?:sleep\s+with\s+me|fuck\s+me|kiss\s+me|are\s+you\s+sexy|sexy\s+agent|be\s+my\s+(?:girlfriend|lover|sugar\s*baby))\b/i,
  /\b(?:show\s+(?:me\s+)?your\s+body|touch\s+yourself|take\s+off\s+your\s+clothes)\b/i,
];

// Violence, self-harm, weapons, and illicit/illegal patterns
const SENSITIVE_HARM_AND_ILLEGAL_PATTERNS = [
  // Self-harm & suicide
  /\b(?:suicide|kill\s+myself|hang\s+myself|cut\s+myself|end\s+my\s+life|self[- ]harm)\b/i,
  
  // Violence & weapons
  /\b(?:how\s+to\s+kill|murder\s+someone|assassinat(?:e|ion)|hire\s+a\s+hitman)\b/i,
  /\b(?:make\s+a\s+bomb|build\s+an\s+explosive|pipe\s*bomb|ied\s+blueprint)\b/i,
  /\b(?:mass\s+shooting|school\s+shooting)\b/i,

  // Illicit drugs & manufacturing
  /\b(?:cook\s+meth|synthesize\s+fentanyl|buy\s+cocaine|make\s+heroin)\b/i,
];

/**
 * Checks whether an input string contains sensitive, sexually explicit, or inappropriate content.
 * @param {string} text - User message, query subject, or proposed seed topic.
 * @returns {{ isSensitive: boolean, category: "sexual" | "sensitive_harm" | null }}
 */
export const isSensitiveOrSexualText = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    return { isSensitive: false, category: null };
  }

  const normalized = normalizeSafetyText(text);

  // 1. Check sexual / adult content
  for (const pattern of SEXUAL_AND_ADULT_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(text)) {
      return { isSensitive: true, category: "sexual" };
    }
  }

  // 2. Check extreme harm / illegal content
  for (const pattern of SENSITIVE_HARM_AND_ILLEGAL_PATTERNS) {
    if (pattern.test(normalized) || pattern.test(text)) {
      return { isSensitive: true, category: "sensitive_harm" };
    }
  }

  return { isSensitive: false, category: null };
};

// Work-related content patterns (OneSmarter, services, platforms, trust vocabulary, compliance, audits)
const WORK_CONTENT_PATTERNS = [
  /\b(?:onesmarter|one\s*smarter)\b/i,
  /\b(?:as400|as\s*400|ibm\s*i)\b/i,
  /\b(?:bill\s*audit|erp\s*bill\s*pay|telecom\s*expense)\b/i,
  /\b(?:hipaa|soc\s*1|soc\s*2|iso\s*27001|iso\s*\/?\s*iec\s*27001|pci\s*dss|cmmi|vapt|gdpr|hitrust|nist)\b/i,
  /\b(?:claims\s*processing|healthcare\s*claims|tpa\s+support|ticketing\s*platform|case\s*management)\b/i,
  /\b(?:audit\s*readiness|compliance\s*assessment|soc\s*report|iso\s*certificate|attestation)\b/i,
  /\b(?:(?:our|your|the|what|which)\s*platforms?|platforms?\s+(?:do\s+you|offer|support|provide|built))\b/i,
  /\b(?:(?:our|your|company)\s*services?|services?\s+(?:do\s+you|offer|provide))\b/i,
  /\b(?:our\s*clients?|our\s*customers?|client\s*work|work\s*content)\b/i,
];

// Politics and religion patterns
const POLITICS_AND_RELIGION_PATTERNS = [
  /\b(?:democrat|republican|tory|labour\s*party|gop|biden|trump|obama|modi|sunak|starmer|kamala\s*harris|politician|politicians|political\s*party|election|elections|presidency|prime\s*minister|parliament|congressman|senator|legislation|geopolitics|voting\s*for)\b/i,
  /\b(?:christianity|islam|hinduism|judaism|buddhism|sikhism|quran|koran|bible|torah|gospel|scriptures?|theology|salvation|resurrection|sin\s*and\s*repentance|allah|yahweh|prophet\s*muhammad|jesus\s*christ)\b/i,
];

const ALLOWED_NAMED_ENTITIES = new Set([
  // Persona names & IDs
  "theo", "mercer", "elena", "cross", "ravi", "sen", "selene", "hart", "mira", "vale",
  // Days of the week
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  // Months of the year
  "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december",
  // OneSmarter / Cafe allowlist
  "onesmarter", "one", "smarter", "cafe", "the",
  // Question words, sentence starters & greetings
  "what", "how", "when", "where", "why", "who", "which", "whose",
  "good", "morning", "afternoon", "evening", "night", "hello", "hi", "hey", "welcome", "thanks", "thank",
  "can", "could", "would", "should", "will", "shall", "may", "might", "must",
  "have", "has", "had", "having", "tell", "ask", "let", "lets", "please", "sure", "well", "yes", "yeah", "nope",
  "is", "are", "am", "was", "were", "do", "does", "did",
  // Common conversational / everyday nouns & adjectives that may be capitalized
  "coffee", "tea", "espresso", "latte", "cappuccino", "pastry", "bakery", "cake",
  "london", "paris", "tokyo", "english", "french", "american", "italian", "british", "indian", "japanese",
  "weather", "cricket", "cinema", "football", "library", "autumn", "summer", "winter", "spring",
  "book", "books", "note", "letter", "shop", "bench", "fountain", "garden", "radio", "train", "station",
]);

/**
 * Checks whether text mentions real named people outside the allowlist
 * using the namedEntities extractor from agentGroundingVerifier.
 */
export const checkNamedPeopleSafety = (text) => {
  if (typeof text !== "string" || !text.trim()) return { isFlagged: false, name: null };
  const entities = namedEntities(text);

  for (const entity of entities) {
    // If an entity is a sequence of words or single word, check each token
    const tokens = entity.toLowerCase().split(/[\s/-]+/);
    const isAllowed = tokens.every((tok) => !tok || ALLOWED_NAMED_ENTITIES.has(tok));
    if (!isAllowed) {
      return { isFlagged: true, name: entity };
    }
  }

  return { isFlagged: false, name: null };
};

/**
 * Master safety evaluation for Café visitor inputs, seed topics, and generated text.
 * Covers: sexual, sensitive harm, work content (OneSmarter/services), politics & religion, named people.
 */
export const checkCafeSafety = (text) => {
  if (typeof text !== "string" || !text.trim()) {
    return { isSafe: true, category: null, reason: null };
  }

  // 1. Sexual & adult content
  const sexualCheck = isSensitiveOrSexualText(text);
  if (sexualCheck.isSensitive) {
    return { isSafe: false, category: sexualCheck.category, reason: "sensitive_content" };
  }

  // 2. Work-related subjects (OneSmarter, services, platforms, compliance) -> handoff to Mira
  for (const pattern of WORK_CONTENT_PATTERNS) {
    if (pattern.test(text)) {
      return { isSafe: false, category: "work_content", reason: "work_content_handoff" };
    }
  }

  // 3. Politics and religion
  for (const pattern of POLITICS_AND_RELIGION_PATTERNS) {
    if (pattern.test(text)) {
      return { isSafe: false, category: "politics_religion", reason: "politics_or_religion" };
    }
  }

  // 4. Real named people
  const personCheck = checkNamedPeopleSafety(text);
  if (personCheck.isFlagged) {
    return { isSafe: false, category: "named_people", reason: "named_real_people" };
  }

  return { isSafe: true, category: null, reason: null };
};

/**
 * Inspects external knowledge extracts to ensure no adult or inappropriate content passes through.
 */
export const isSensitiveKnowledgeExtract = (extract = "", title = "", description = "") => {
  const combined = `${title} ${description} ${extract}`;
  const { isSensitive } = isSensitiveOrSexualText(combined);
  if (isSensitive) return true;

  const lower = combined.toLowerCase();
  const secondaryAdultMarkers = [
    "pornographic", "pornography", "erotic", "erotica", "adult entertainer",
    "adult film", "sex symbol", "sexual arousal", "sexually suggestive",
    "sexual acts", "nudity", "sexual intercourse", "prostitution",
  ];

  return secondaryAdultMarkers.some((marker) => lower.includes(marker));
};

/**
 * Generates an in-character refusal from a Café persona when a visitor asks
 * sensitive, work-related, political/religious, or real-person questions.
 */
export const getInCharacterSafetyRefusal = (personaId, isFirstSpeaker = true, category = "sexual") => {
  if (category === "work_content") {
    switch (personaId) {
      case "theo-mercer":
        return isFirstSpeaker
          ? "We do not discuss OneSmarter platforms or business services off-duty. Mira Vale is our official guide—she can answer your questions about OneSmarter's platforms, services, and trust posture."
          : "Work and platform questions belong with Mira Vale. She is available in the guide panel above.";
      case "elena-cross":
        return isFirstSpeaker
          ? "Oh, we leave work at the door here! If you want to know about OneSmarter's services or platforms, Mira is the one to ask. She's right upstairs at the guide desk."
          : "We don't talk shop at this table. Mira is right above and has all the official details on OneSmarter.";
      case "ravi-sen":
        return isFirstSpeaker
          ? "We have a strict rule against talking shop over coffee. For anything related to OneSmarter platforms, services, or compliance, Mira Vale is the right person to speak with."
          : "Company work is strictly off-limits at this table. Mira can give you the complete picture of OneSmarter.";
      case "selene-hart":
      default:
        return isFirstSpeaker
          ? "We keep our café table completely away from company work and platforms. Mira Vale can assist you with all questions about OneSmarter's services and security."
          : "Work topics are kept outside the Café. Please ask Mira Vale in the guide section above for OneSmarter details.";
    }
  }

  if (category === "politics_religion") {
    switch (personaId) {
      case "theo-mercer":
        return isFirstSpeaker
          ? "We avoid politics and religious debates at this table. Let's focus our discussion on ordinary, everyday observations."
          : "We do not discuss politics or religion here. Let's return to everyday matters.";
      case "elena-cross":
        return isFirstSpeaker
          ? "Politics and religion are off the menu at this table! There are far more eccentric and enjoyable topics to explore over coffee."
          : "Definitely not touching politics or religion! Tell us something strange or interesting instead.";
      case "ravi-sen":
        return isFirstSpeaker
          ? "I make it a rule never to mix coffee with politics or religion. Let's redirect to a much more agreeable subject."
          : "We keep politics and religion out of the conversation. There are better things to debate.";
      case "selene-hart":
      default:
        return isFirstSpeaker
          ? "We prefer to leave politics and religion outside the Café. What everyday question or reflection would you like to explore instead?"
          : "Our table remains apart from political and religious matters. Let's focus on everyday thoughts.";
    }
  }

  if (category === "named_people") {
    switch (personaId) {
      case "theo-mercer":
        return isFirstSpeaker
          ? "We do not discuss or evaluate real individuals at this table. Let's focus on ideas, wording, and everyday scenarios."
          : "Evaluating real people is not something we do here. Let's keep to general observations.";
      case "elena-cross":
        return isFirstSpeaker
          ? "We don't gossip about or judge real people here! Let's stick to our small, strange everyday topics instead."
          : "No talking about real people at this table. Let's find an everyday topic instead.";
      case "ravi-sen":
        return isFirstSpeaker
          ? "We keep real people out of our café debates. It's much fairer and more interesting to explore ideas without personal commentary."
          : "Personal judgments about real individuals aren't for this table. Let's discuss a broader topic.";
      case "selene-hart":
      default:
        return isFirstSpeaker
          ? "We refrain from discussing or evaluating real individuals at this table. Let's focus our curiosity on everyday questions."
          : "Our table avoids judging or discussing specific real individuals. Let's reflect on an everyday question.";
    }
  }

  if (category === "sensitive_harm") {
    switch (personaId) {
      case "theo-mercer":
        return isFirstSpeaker
          ? "We do not discuss self-harm, violence, or dangerous activities at this table. Let's focus on constructive, everyday topics."
          : "Safety and constructive discussion are essential. We cannot assist with or explore harmful topics.";
      case "elena-cross":
        return isFirstSpeaker
          ? "That's not something we can touch here. If you or someone you know is going through a tough time, please reach out to trusted professional support."
          : "We keep things safe and positive at this table. Let's redirect our conversation.";
      case "ravi-sen":
        return isFirstSpeaker
          ? "I have to draw a clear line there. We don't discuss harmful, violent, or dangerous subjects at our table."
          : "We strictly avoid discussing anything that could cause harm. Let's turn to a better subject.";
      case "selene-hart":
      default:
        return isFirstSpeaker
          ? "Your wellbeing matters, and our table is not the right place for questions involving harm or danger. Please connect with dedicated support services if you need help."
          : "We keep our conversations safe and respectful here. Let's shift our focus to something positive.";
    }
  }

  // Default: Sexual / adult / sensitive refusal
  switch (personaId) {
    case "theo-mercer":
      return isFirstSpeaker
        ? "That is not an appropriate topic for our table. We keep our discussions focused on constructive, everyday subjects."
        : "I will not discuss adult or sensitive topics here. Let's return to our original discussion.";
    case "elena-cross":
      return isFirstSpeaker
        ? "Let's definitely change the subject. We don't delve into adult or sensitive topics here at the Café."
        : "Not something we discuss at this table! There are plenty of better things to talk about.";
    case "ravi-sen":
      return isFirstSpeaker
        ? "I'm going to pass on that topic. Let's keep the conversation respectful and suitable for a professional public space."
        : "We steer clear of adult or sensitive subjects here. Let's redirect to something more constructive.";
    case "selene-hart":
    default:
      return isFirstSpeaker
        ? "We prefer not to explore adult or sensitive topics here. Let's keep our conversation thoughtful and suitable for everyone."
        : "Our table isn't the place for adult or sensitive questions. What constructive topic would you like to explore instead?";
  }
};
