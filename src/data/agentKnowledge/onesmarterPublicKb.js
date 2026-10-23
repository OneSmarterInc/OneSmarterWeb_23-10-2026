import { siteDirectory } from "../siteDirectory.js";

const practiceHiringPage = siteDirectory.find(
  (page) => page.route === "/business-services/eor-hr",
);
const [practiceHiringSupport, agentAssistedHiringBoundary] =
  practiceHiringPage?.approvedContent || [];
const isoReadinessPage = siteDirectory.find(
  (page) => page.route === "/compliance-assurance/iso-27001-readiness",
);

export const onesmarterPublicKnowledgeBase = [
  {
    id: "company-overview",
    route: "/",
    title: "OneSmarter Overview",
    category: "Core",
    approvedSummary:
      "OneSmarter builds secure platforms, practical AI workflows, technology solutions, business services, and compliance readiness support for healthcare, financial, telecom, and growing organizations.",
    sourceFacts: [
      "OneSmarter is organized around Platforms, Technology Solutions, AI Agents, Business Services, Compliance & Cyber Assurance, and the Trust Center.",
      "OneSmarter emphasizes secure software, practical AI, responsible data handling, and trusted execution.",
      "Business inquiries should route to care@onesmarter.com.",
    ],
    allowedClaims: [
      "Secure platforms",
      "Practical AI workflows",
      "Business services",
      "Compliance readiness support",
      "Healthcare, financial, telecom, and growing organizations",
    ],
    disallowedClaims: [
      "OneSmarter guarantees compliance",
      "OneSmarter provides legal or medical advice",
      "OneSmarter is a staffing company",
    ],
    handoffGuidance:
      "Route pricing, procurement, partnership, contract, and client-specific questions to care@onesmarter.com.",
    relatedQuestions: [
      "What does OneSmarter do?",
      "Who does OneSmarter help?",
      "How should I contact OneSmarter?",
      "What can OneSmarter do for us?",
      "What can OneSmarter do?",
      "What can you do for us?",
      "How can OneSmarter help us?",
      "What services do you provide?",
      "What do you do?",
      "Tell me what OneSmarter does",
      "What are your capabilities?",
    ],
    sourceLabel: "siteDirectory.js and public LLM summaries",
  },
  {
    id: "mira-professional-role",
    route: "/ai-agents",
    title: "Mira Vale Professional Role",
    category: "AI Agents",
    approvedSummary:
      "Mira Vale is OneSmarter's public-content and general guide for approved information about the company, its platforms, services, compliance posture, and Trust Center.",
    sourceFacts: [
      "Mira helps visitors understand approved public OneSmarter information and find an appropriate next step.",
      "Mira can explain approved platform, technology-service, business-service, professional-agent, compliance, and Trust Center information.",
      "Mira does not access customer systems, perform customer actions, provide private customer information, or guarantee business or compliance outcomes.",
      "Mira routes business-specific, sensitive, procurement, pricing, and formal evidence requests to care@onesmarter.com.",
    ],
    allowedClaims: [
      "OneSmarter public-content guide",
      "General guide to approved OneSmarter information",
      "Helps visitors find an appropriate next step",
    ],
    disallowedClaims: [
      "Mira has access to customer systems or private customer information",
      "Mira performs actions in customer environments",
      "Mira guarantees business or compliance outcomes",
      "Mira has a professional biography beyond her approved guide role",
    ],
    handoffGuidance:
      "Route business-specific, sensitive, procurement, pricing, and formal evidence requests to care@onesmarter.com.",
    relatedQuestions: [
      "Who is Mira Vale?",
      "What can Mira help me with?",
      "What are Mira's professional boundaries?",
    ],
    sourceLabel: "AiAgentsPage.jsx and approved professional-agent role architecture",
  },
  {
    id: "secure-ticketing-case-management",
    route: "/platforms/hipaa-regulated-ticketing",
    title: "Secure Ticketing and Case Management",
    category: "Platforms",
    approvedSummary:
      "Secure Ticketing and Case Management is a platform built for HIPAA-regulated workflows, PHI-sensitive operations, role-based access, audit history, controlled communication, workflow tracking, and accountable issue resolution.",
    sourceFacts: [
      "The platform supports secure intake, role-based access, audit history, controlled communication, and workflow tracking.",
      "The page uses supporting language such as built for HIPAA-regulated workflows and designed for PHI-sensitive workflows.",
      "The platform should not be described as making a customer HIPAA compliant by itself.",
    ],
    allowedClaims: [
      "Built for HIPAA-regulated workflows",
      "Designed for PHI-sensitive workflows",
      "Supports compliance-aware ticketing and case management",
      "Supports role-based access and audit history",
    ],
    disallowedClaims: [
      "HIPAA Certified",
      "HIPAA Certification",
      "The platform guarantees HIPAA compliance",
      "The platform makes a customer HIPAA compliant by itself",
    ],
    handoffGuidance:
      "Route regulated-workflow, procurement, security-review, or implementation-specific questions to care@onesmarter.com.",
    relatedQuestions: [
      "What is Secure Ticketing and Case Management?",
      "Is the ticketing platform built for HIPAA-regulated workflows?",
      "Can I share PHI here?",
    ],
    sourceLabel: "siteDirectory.js: /platforms/hipaa-regulated-ticketing",
  },
  {
    id: "bill-audit-bill-pay",
    route: "/platforms/bill-audit-erp-bill-pay",
    title: "Bill Audit & Bill Pay",
    category: "Platforms",
    approvedSummary:
      "Bill Audit & Bill Pay helps organizations review vendor bills, analyze recurring expenses, identify discrepancies, coordinate approvals, support payment workflows, and manage telecom expense use cases.",
    sourceFacts: [
      "The platform supports vendor bill review, recurring expense analysis, discrepancy tracking, approval workflows, and payment workflows.",
      "Telecom Expense Management is treated as a use case under Bill Audit & Bill Pay, not as a standalone promoted platform.",
      "Telecom use cases include bill analysis, contract and rate comparison, historical usage review, and cost-control reporting.",
    ],
    allowedClaims: [
      "Vendor bill review",
      "Recurring expense analysis",
      "Discrepancy tracking",
      "Approval workflows",
      "Payment workflows",
      "Telecom expense management use cases",
    ],
    disallowedClaims: [
      "Telecom Expense Management is a standalone OneSmarter platform",
      "Bill Audit & Bill Pay guarantees savings",
      "OneSmarter acts as a bank or licensed payment processor unless separately confirmed",
    ],
    handoffGuidance:
      "Route pricing, payment-process, implementation, and contract-specific questions to care@onesmarter.com.",
    relatedQuestions: [
      "What is Bill Audit & Bill Pay?",
      "What is telecom expense management?",
      "Do you support vendor bill review?",
    ],
    sourceLabel: "siteDirectory.js: /platforms/bill-audit-erp-bill-pay",
  },
  {
    id: "technology-solutions-overview",
    route: "/technology-solutions",
    title: "Technology Solutions Overview",
    category: "Technology Solutions",
    approvedSummary:
      "OneSmarter provides technology services for healthcare operations, claims processing services, practical AI, IBM i / AS400, enterprise software, and software support consolidation.",
    sourceFacts: [
      "Technology Solutions includes Healthcare & TPA Technology, Claims Processing Services, AI Agentic Services, IBM i / AS400 Services, Enterprise Software Development, and Software Support Consolidation.",
      "Claims Processing Services are positioned as services, not as a commercially available claims product.",
      "Software support consolidation uses global delivery and support teams.",
    ],
    allowedClaims: [
      "Healthcare and TPA technology services",
      "Claims Processing Services",
      "AI Agentic Services",
      "IBM i / AS400 Services",
      "Enterprise software development",
      "Software support consolidation",
    ],
    disallowedClaims: [
      "Claims Processing System",
      "Claims Processing Platform",
      "Production-ready claims platform",
      "Available claims product",
    ],
    handoffGuidance:
      "Route technology discovery, project scope, modernization, or support consolidation questions to care@onesmarter.com.",
    relatedQuestions: [
      "What technology services do you offer?",
      "Do you support healthcare technology?",
      "Do you work with IBM i or AS400 systems?",
    ],
    sourceLabel: "siteDirectory.js: /technology-solutions",
  },
  {
    id: "claims-processing-services",
    route: "/technology-solutions/claims-processing-services",
    title: "Claims Processing Services",
    category: "Technology Solutions",
    approvedSummary:
      "Claims Processing Services are healthcare technology services for claims workflow modernization, claims technology support, member and provider portals, legacy data integration, reporting, and operational visibility.",
    sourceFacts: [
      "Claims Processing Services are service-oriented healthcare technology support.",
      "They are not positioned as a commercially available claims processing product.",
      "The offering supports healthcare and TPA workflow support and secure healthcare technology delivery.",
    ],
    allowedClaims: [
      "Claims workflow modernization",
      "Claims technology support",
      "Member and provider portals",
      "Legacy data integration",
      "Reporting and operational visibility",
      "Healthcare and TPA workflow support",
    ],
    disallowedClaims: [
      "Claims Processing System",
      "Claims Processing Platform",
      "OneSmarter acts as a payer",
      "OneSmarter acts as a licensed claims adjudicator",
      "OneSmarter sells a production-ready claims platform today",
    ],
    handoffGuidance:
      "Route healthcare operations, claims workflow, data, or regulated-service questions to care@onesmarter.com.",
    relatedQuestions: [
      "What are Claims Processing Services?",
      "Do you support healthcare claims workflows?",
      "Are you selling a claims platform?",
    ],
    sourceLabel: "siteDirectory.js: /technology-solutions/claims-processing-services",
  },
  {
    id: "ai-agentic-services",
    route: "/technology-solutions/ai-agentic-services",
    title: "AI Agentic Services",
    category: "Technology Solutions",
    approvedSummary:
      "AI Agentic Services are practical AI services for controlled automation, document workflows, decision support, human-in-the-loop review, enterprise integration, and repeatable business processes.",
    sourceFacts: [
      "The service emphasizes controlled automation and practical workflow design.",
      "Mira Vale is OneSmarter's public-content guide.",
      "Theo Mercer analyzes supplied website or page content and AI readability.",
      "Elena Cross reviews compliance, certification, and readiness language.",
      "Ravi Sen explains approved operations, workflow, ticketing, and routing capabilities without accessing customer systems.",
      "Selene Hart explains OneSmarter's AI-agent architecture and current orchestration boundaries.",
    ],
    allowedClaims: [
      "AI-assisted workflow design",
      "Document automation",
      "Human-in-the-loop review",
      "Enterprise integration",
      "Live professional agents with separate approved roles",
    ],
    disallowedClaims: [
      "Autonomous replacement of professional judgment",
      "Guaranteed AI accuracy",
      "Live agent-to-agent production workflow unless separately implemented",
    ],
    handoffGuidance:
      "Route AI workflow scoping, automation strategy, and implementation questions to care@onesmarter.com.",
    relatedQuestions: [
      "What are AI Agentic Services?",
      "Who is Mira Vale?",
      "Do you offer AI workflow support?",
    ],
    sourceLabel: "siteDirectory.js and V2 planning docs",
  },
  {
    id: "business-services-overview",
    route: "/business-services",
    title: "Business Services Overview",
    category: "Business Services",
    approvedSummary:
      "OneSmarter provides business services for finance, HR, payment, benefits, and back-office workflows, including accounting, bookkeeping, tax support, EOR and HR services, third-party payment services, and benefits back-office support.",
    sourceFacts: [
      "Business Services are separate from Technology Solutions.",
      "The business services structure should not position OneSmarter as a staffing agency.",
      "EOR and HR services include onboarding coordination, workforce documentation, HR administration, and payroll coordination.",
    ],
    allowedClaims: [
      "Accounting, Bookkeeping & Tax Support",
      "EOR & HR Services",
      "Third-Party Payment Services",
      "Benefits & Back Office Support",
      "Back-office workflow support",
    ],
    disallowedClaims: [
      "Staffing Services",
      "OneSmarter is a staffing company",
      "OneSmarter provides legal, CPA, or tax advice unless separately supported",
    ],
    handoffGuidance:
      "Route finance, HR, tax, EOR, payment, and benefits-specific questions to care@onesmarter.com.",
    relatedQuestions: [
      "What business services do you offer?",
      "Do you offer accounting support?",
      "Do you offer EOR and HR services?",
    ],
    sourceLabel: "siteDirectory.js: /business-services",
  },
  {
    id: "practice-hiring-support",
    route: practiceHiringPage?.route || "/business-services/eor-hr",
    title: "Practice Hiring Support",
    category: "Business Services",
    approvedSummary: practiceHiringSupport,
    sourceFacts: [practiceHiringSupport, agentAssistedHiringBoundary].filter(Boolean),
    allowedClaims: [
      "Specialty-specific job postings",
      "Candidate screening against stated requirements",
      "Credentialing tracked from offer through completion",
      "Agent-assisted hiring is in development",
      "No availability date is committed",
      "Early interest may be sent to care@onesmarter.com",
    ],
    disallowedClaims: [
      "Agent-assisted hiring is currently available",
      "Agent-assisted hiring is launched or production ready",
      "A committed availability date",
      "Do not describe agent-assisted hiring as currently available.",
    ],
    handoffGuidance:
      "Practices can express early interest in agent-assisted hiring via care@onesmarter.com.",
    relatedQuestions: [
      "Does OneSmarter help practices with hiring?",
      "Can you help write specialized job postings?",
      "Do you screen candidates?",
      "Do you help track credentialing?",
      "Is agent-assisted hiring available today?",
    ],
    sourceLabel: "siteDirectory.js: /business-services/eor-hr approvedContent",
  },  {
    id: "iso-27001-readiness-support",
    route: isoReadinessPage?.route || "/compliance-assurance/iso-27001-readiness",
    title: "ISO/IEC 27001 Readiness Support",
    category: "Compliance & Cyber Assurance",
    approvedSummary: isoReadinessPage?.shortSummary,
    sourceFacts: [
      isoReadinessPage?.shortSummary,
      ...(isoReadinessPage?.keyOfferings || []),
      "ISO/IEC 27001 readiness support is a client-facing service. Separately, One Smarter Inc. holds its own ISO/IEC 27001:2022 certification.",
    ].filter(Boolean),
    allowedClaims: [
      "ISO/IEC 27001 readiness support",
      "ISMS documentation",
      "Control mapping",
      "Evidence preparation",
      "Remediation coordination",
    ],
    disallowedClaims: [
      "Readiness support proves OneSmarter certification",
      "OneSmarter issues ISO certificates",
      "OneSmarter certifies customer systems",
      "ISO certification guarantees customer compliance",
      "OneSmarter's certification automatically certifies customers",
      "ISO readiness automatically results in certification",
    ],
    handoffGuidance:
      "Route certification evidence or business-specific readiness questions to care@onesmarter.com.",
    relatedQuestions: [
      "Do you provide ISO 27001 services?",
      "Is OneSmarter ISO/IEC 27001 certified?",
      "Does readiness support mean OneSmarter is certified?",
    ],
    sourceLabel: "siteDirectory.js: /compliance-assurance/iso-27001-readiness",
  },
  {
    id: "iso-27001-certified",
    route: "/trust-center/iso-27001",
    title: "ISO/IEC 27001 Certified",
    category: "Trust Center",
    approvedSummary:
      "One Smarter Inc. is ISO/IEC 27001:2022 certified for AWS cloud services development, HR and people management solutions development, and governance activities in the One Smarter application. This scope does not automatically cover other services, platforms, or customer systems.",
    sourceFacts: [
      "Certificate number: 210826050107.",
      "Certification body: ARS Assessment Private Limited.",
      "Accreditation: UAF accredited.",
      "Standard: ISO/IEC 27001:2022.",
      "Valid from 21 August 2026 through 20 August 2029.",
      "Verification is available at arscert.com and iafcertsearch.org.",
      "The certified scope is AWS cloud services development, HR and people management solutions development, and governance activities in the One Smarter application.",
      "The certified scope does not automatically cover claims processing, healthcare services, all platforms, all customer systems, or every service.",
      "ISO/IEC 27001 readiness support is a separate client-facing service for organizations preparing for their own certification journey.",
    ],
    allowedClaims: [
      "One Smarter Inc. is ISO/IEC 27001:2022 certified",
      "Certificate 210826050107",
      "ARS Assessment Private Limited, UAF accredited",
      "Valid 21 August 2026 through 20 August 2029",
      "Organizational information-security management credential",
      "The exact certified scope stated in sourceFacts",
    ],
    disallowedClaims: [
      "OneSmarter certifies customer systems",
      "OneSmarter issues ISO certificates",
      "ISO certification guarantees customer compliance",
      "OneSmarter's certification automatically certifies customers",
      "ISO readiness automatically results in certification",
    ],
    handoffGuidance: "For additional documentary evidence, contact care@onesmarter.com.",
    relatedQuestions: [
      "Is OneSmarter ISO/IEC 27001 certified?",
      "What is OneSmarter's ISO certification scope?",
      "Does your ISO certification cover claims processing?",
      "What is the difference between ISO readiness support and OneSmarter's certification?",
    ],
    sourceLabel: "Approved Mira ISO/IEC 27001 certification reconciliation",
  },
  {
    id: "compliance-cyber-assurance-overview",
    route: "/compliance-assurance",
    title: "Compliance & Cyber Assurance Overview",
    category: "Compliance & Cyber Assurance",
    approvedSummary:
      "Compliance & Cyber Assurance services help clients prepare for reviews, organize evidence, document controls, map frameworks, coordinate VAPT work, and support remediation.",
    sourceFacts: [
      "Compliance & Cyber Assurance describes client-facing services OneSmarter provides to clients.",
      "The category includes SOC readiness, HIPAA audit readiness, ISO/IEC 27001 readiness, PCI DSS readiness, framework mapping, VAPT and remediation, CMMI readiness, and compliance operations.",
      "OneSmarter should not be described as issuing SOC reports or ISO certificates.",
    ],
    allowedClaims: [
      "Readiness support",
      "Evidence preparation",
      "Control documentation",
      "Framework mapping",
      "VAPT coordination",
      "Remediation support",
    ],
    disallowedClaims: [
      "OneSmarter issues SOC reports",
      "OneSmarter issues ISO certificates",
      "OneSmarter guarantees compliance",
      "OneSmarter provides legal advice",
    ],
    handoffGuidance:
      "Route compliance scope, audit, evidence, security review, or business-specific readiness questions to care@onesmarter.com.",
    relatedQuestions: [
      "What is Compliance & Cyber Assurance?",
      "Can OneSmarter help with SOC readiness?",
      "Can OneSmarter help with HIPAA audit readiness?",
    ],
    sourceLabel: "siteDirectory.js: /compliance-assurance",
  },
  {
    id: "trust-center-overview",
    route: "/trust-center",
    title: "Trust Center Overview",
    category: "Trust Center",
    approvedSummary:
      "The Trust Center explains OneSmarter's own security, privacy, ISO/IEC 27001, SOC 2, HIPAA, secure development, and responsible data handling posture.",
    sourceFacts: [
      "Trust Center describes OneSmarter's own posture, not client-facing compliance services.",
      "Trust Center includes ISO/IEC 27001, SOC 2, HIPAA, Security Practices, and Privacy.",
      "The ISO/IEC 27001 Trust Center page is /trust-center/iso-27001.",
      "Formal evidence requests should route to care@onesmarter.com.",
    ],
    allowedClaims: [
      "SOC 2 Type II Attested",
      "HIPAA Security Rule Compliance Assessment Completed",
      "ISO/IEC 27001 Certified",
      "Security practices",
      "Privacy and responsible data handling",
    ],
    disallowedClaims: [
      "SOC 2 Certified",
      "HIPAA Certified",
      "Official HIPAA certification",
      "Guaranteed compliance",
    ],
    handoffGuidance:
      "Route vendor review, evidence, procurement, or security questionnaire requests to care@onesmarter.com.",
    relatedQuestions: [
      "What is the Trust Center?",
      "Where can I learn about OneSmarter security?",
      "Can I get security evidence?",
    ],
    sourceLabel: "siteDirectory.js: /trust-center",
  },
  {
    id: "soc2-attested",
    route: "/trust-center/soc2",
    title: "SOC 2 Type II Attested",
    category: "Trust Center",
    approvedSummary:
      "OneSmarter is SOC 2 Type II Attested as part of its ongoing security and operational controls program.",
    sourceFacts: [
      "Use the phrase SOC 2 Type II Attested.",
      "The Trust Center provides public context for OneSmarter's SOC 2 posture.",
      "Formal reports and evidence should be handled through a direct business process.",
    ],
    allowedClaims: [
      "SOC 2 Type II Attested",
      "Independent attestation",
      "Security controls",
      "Operational discipline",
      "Ongoing monitoring",
    ],
    disallowedClaims: [
      "SOC 2 Certified",
      "OneSmarter issues SOC reports",
      "Public visitors can receive formal evidence through the agent",
    ],
    handoffGuidance:
      "Route SOC report, security questionnaire, and procurement evidence requests to care@onesmarter.com.",
    relatedQuestions: [
      "Are you SOC 2 certified?",
      "What does SOC 2 Type II Attested mean here?",
      "Can you send your SOC 2 report?",
    ],
    sourceLabel: "siteDirectory.js: /trust-center/soc2",
  },
  {
    id: "hipaa-security-rule-assessment",
    route: "/trust-center/hipaa",
    title: "HIPAA Security Rule Compliance Assessment Completed",
    category: "Trust Center",
    approvedSummary:
      "OneSmarter has completed an independent HIPAA Security Rule compliance assessment covering applicable safeguards and practices.",
    sourceFacts: [
      "Use the phrase HIPAA Security Rule Compliance Assessment Completed.",
      "OneSmarter does not present this assessment as an official certification.",
      "Trust Center HIPAA content focuses on safeguards and practices.",
    ],
    allowedClaims: [
      "HIPAA Security Rule Compliance Assessment Completed",
      "Independent HIPAA Security Rule compliance assessment",
      "Administrative safeguards",
      "Technical safeguards",
      "Physical safeguards",
      "Ongoing risk awareness",
    ],
    disallowedClaims: [
      "HIPAA Certified",
      "HIPAA Certification",
      "Official HIPAA certification",
      "The assessment guarantees customer compliance",
    ],
    handoffGuidance:
      "Route HIPAA evidence, regulated workflow, BAA, or procurement-specific questions to care@onesmarter.com.",
    relatedQuestions: [
      "Are you HIPAA certified?",
      "What does HIPAA Security Rule Compliance Assessment Completed mean?",
      "Does OneSmarter handle PHI?",
    ],
    sourceLabel: "siteDirectory.js: /trust-center/hipaa",
  },
  {
    id: "security-practices",
    route: "/trust-center/security-practices",
    title: "Security Practices",
    category: "Trust Center",
    approvedSummary:
      "OneSmarter security practices cover secure software development, access control, least privilege, change management, risk review, and incident response readiness.",
    sourceFacts: [
      "Security Practices is part of the Trust Center.",
      "Public answers should stay high-level and factual.",
      "Detailed security evidence should be handled through a direct business process.",
    ],
    allowedClaims: [
      "Secure software development",
      "Access control",
      "Least privilege",
      "Change management",
      "Risk review",
      "Incident response readiness",
    ],
    disallowedClaims: [
      "Guaranteed secure",
      "No security risk",
      "Public disclosure of sensitive security details",
    ],
    handoffGuidance:
      "Route detailed security practice, architecture, evidence, and questionnaire requests to care@onesmarter.com.",
    relatedQuestions: [
      "What security practices does OneSmarter use?",
      "How do you handle access control?",
      "Can you answer a security questionnaire?",
    ],
    sourceLabel: "siteDirectory.js: /trust-center/security-practices",
  },
  {
    id: "privacy-terms-guidance",
    route: "/trust-center/privacy",
    title: "Privacy and Terms High-Level Guidance",
    category: "Trust Center",
    approvedSummary:
      "OneSmarter privacy practices emphasize client confidentiality, responsible data handling, limited access, privacy-aware operations, and careful handling of sensitive information. The Privacy Policy and Terms Of Use are legal pages that should be reviewed directly.",
    sourceFacts: [
      "Trust Center privacy content points to client confidentiality, responsible data handling, limited access, and privacy-aware operations.",
      "The Privacy Policy and Terms Of Use are legal pages.",
      "Mira should not interpret legal terms or provide legal advice.",
    ],
    allowedClaims: [
      "Responsible data handling",
      "Client confidentiality",
      "Limited access",
      "Privacy-aware operations",
      "Visitors should review the Privacy Policy and Terms Of Use directly",
    ],
    disallowedClaims: [
      "Legal interpretation of Privacy Policy or Terms Of Use",
      "Legal advice",
      "Privacy guarantees beyond approved public content",
    ],
    handoffGuidance:
      "Route privacy, legal, contract, or terms-specific questions to care@onesmarter.com and recommend reviewing the legal pages directly.",
    relatedQuestions: [
      "Where is your Privacy Policy?",
      "Where are your Terms Of Use?",
      "Can you explain your legal terms?",
    ],
    sourceLabel: "siteDirectory.js: /trust-center/privacy and legal pages",
  },
  {
    id: "contact-handoff",
    route: "/contact",
    title: "Contact and Business Inquiry Handoff",
    category: "Contact",
    approvedSummary:
      "For business inquiries, visitors should email OneSmarter at care@onesmarter.com.",
    sourceFacts: [
      "The public contact path is care@onesmarter.com.",
      "The standalone Contact route is retained for backward compatibility but is not promoted in navigation.",
      "Mira should route uncertain, business-specific, sensitive, procurement, or evidence requests to email.",
    ],
    allowedClaims: [
      "Email care@onesmarter.com",
      "Business-specific questions should go to the OneSmarter team",
      "Mira can help route visitors to the right next step",
    ],
    disallowedClaims: [
      "Collect PHI in chat",
      "Collect confidential documents in chat",
      "Promise a response time unless separately approved",
    ],
    handoffGuidance:
      "Use care@onesmarter.com for business inquiries, formal evidence requests, sensitive topics, procurement, pricing, or anything not covered by approved public content.",
    relatedQuestions: [
      "How do I contact OneSmarter?",
      "Can I talk to someone?",
      "Where should I send a business inquiry?",
    ],
    sourceLabel: "siteDirectory.js: /contact and public LLM summaries",
  },
];

export default onesmarterPublicKnowledgeBase;
