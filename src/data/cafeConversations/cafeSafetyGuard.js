/**
 * Safety and Content Moderation Guard for Café Conversations
 * Prevents agents from answering or generating sensitive, sexually explicit,
 * pornographic, adult entertainment, violent, or inappropriate content.
 */

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

/**
 * Inspects external knowledge extracts (e.g. Wikipedia search summaries)
 * to ensure no sexually explicit or adult content is passed into the conversation.
 * @param {string} extract - The summary text from Wikipedia or KB.
 * @param {string} title - The title of the article.
 * @param {string} description - The description of the article.
 * @returns {boolean} True if the extract contains adult or sexual descriptions.
 */
export const isSensitiveKnowledgeExtract = (extract = "", title = "", description = "") => {
  const combined = `${title} ${description} ${extract}`;
  const { isSensitive } = isSensitiveOrSexualText(combined);
  if (isSensitive) return true;

  // Additional secondary boundary checks on encyclopedia descriptions
  const lower = combined.toLowerCase();
  const secondaryAdultMarkers = [
    "pornographic",
    "pornography",
    "erotic",
    "erotica",
    "adult entertainer",
    "adult film",
    "sex symbol",
    "sexual arousal",
    "sexually suggestive",
    "sexual acts",
    "nudity",
    "sexual intercourse",
    "prostitution",
  ];

  return secondaryAdultMarkers.some((marker) => lower.includes(marker));
};

/**
 * Generates an in-character refusal from a Café persona when a visitor asks
 * sensitive or sexually explicit questions.
 * @param {string} personaId - ID of the persona ('theo-mercer', 'elena-cross', 'ravi-sen', 'selene-hart').
 * @param {boolean} isFirstSpeaker - Whether this persona is the first responder to the query.
 * @param {"sexual" | "sensitive_harm" | null} category - Category of refusal.
 * @returns {string} In-character refusal text.
 */
export const getInCharacterSafetyRefusal = (personaId, isFirstSpeaker = true, category = "sexual") => {
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
