// All copy comes from Vats_Siddarath_CV (3).pdf, in its seven parts: about me, education, the inventory
// of skills and the four jobs. The jobs run in order: Adani Green, SMU, then the startups (EZER,
// Citadel), so the walk round the planet is the road so far; each job's projects are in its details.

export type Project = {
  slug: string;
  /** The job it was done in (a Role's slug): it is told in that job's details. */
  job: string;
  title: string;
  /** Who it was for, in a word or two (shown on the card). */
  org: string;
  /** The project in one plain sentence, no jargon: all the card says. */
  blurb: string;
  /** The longer line for the details view. */
  kicker: string;
  period: string;
  status: "Live" | "Research" | "Shipped" | "In progress" | "Design stage";
  summary: string;
  points: string[];
  stack: string[];
  /** Colour of this project's card and quest marker (hex). */
  color: string;
  links: { label: string; href: string }[];
};

export type Role = {
  slug: string;
  role: string;
  org: string;
  place: string;
  period: string;
  /** The job in one plain sentence: all the card says (the points are in its details). */
  summary: string;
  points: string[];
};

export const person = {
  name: "Siddarath Vats",
  title: "AI Engineer",
  tagline: "I build agents, retrieval systems and machine learning that leave the notebook and do real work.",
  location: "Dallas, Texas",
  email: "siddarathvats.ele17@gmail.com",
  linkedin: "https://www.linkedin.com/in/siddarath-vats-51bb65155/",
  github: "https://github.com/siddarathVats",
};

export const origins = {
  intro:
    "Electrical engineer turned AI engineer. Two years in renewable energy in India, a master's in AI in Dallas, and now I build AI products for startups.",
  education: [
    {
      degree: "M.S. Computer Science (Artificial Intelligence)",
      school: "Southern Methodist University",
      place: "Dallas, Texas",
      period: "2023 – 2025",
    },
    {
      degree: "B.E. Electrical Engineering",
      school: "Adani University",
      place: "Gujarat, India",
      period: "Graduated 2021",
    },
  ],
};

export const skillGroups: { label: string; items: string[] }[] = [
  { label: "Languages", items: ["Python", "TypeScript", "SQL", "R"] },
  {
    label: "AI & LLM",
    items: ["LangGraph", "LangChain", "Agent Development Kit", "MCP", "Amazon Bedrock", "Hugging Face", "Ollama", "PyTorch", "TensorFlow", "Keras", "scikit-learn"],
  },
  { label: "Backend & Web", items: ["Node.js", "Express", "React", "Next.js", "REST APIs", "OIDC single sign-on"] },
  { label: "Databases", items: ["PostgreSQL + pgvector", "TimescaleDB", "BigQuery", "Redshift", "MySQL", "Cloud SQL"] },
  { label: "AWS", items: ["EC2", "ECS Fargate", "S3", "IAM", "SageMaker", "SES", "Rekognition", "Textract", "Athena"] },
  { label: "GCP & DevOps", items: ["Vertex AI", "BigQuery", "Cloud Scheduler", "Docker", "GitHub", "Linux GPU clusters (A100)"] },
  { label: "Data & Testing", items: ["PySpark", "Power BI", "Selenium", "Playwright"] },
];

export const projects: Project[] = [
  {
    slug: "solar-ml",
    job: "adani",
    title: "Teaching solar plants to self-report",
    org: "Adani Green Energy",
    blurb: "Models that spot solar plants producing less than they should.",
    kicker: "Adani Green · performance monitoring",
    period: "2021 – 2023",
    status: "Shipped",
    summary:
      "Deep-learning models on Google Cloud Vertex AI that watch solar plants and flag under-performance before it costs energy.",
    points: [
      "Improved the plants' performance ratio (PR) by about 2%.",
      "ETL pipelines from BigQuery, Redshift, S3 and Cloud Storage with CI/CD, feeding real-time DSM dashboards.",
      "Scaled predictive-maintenance pipelines across a ~9 GW renewable portfolio.",
    ],
    stack: ["Vertex AI", "Deep learning", "BigQuery", "Redshift", "S3", "CI/CD"],
    color: "#5cffb0",
    links: [],
  },
  {
    slug: "portfolio-intelligence",
    job: "adani",
    title: "Wind and solar, on one screen",
    org: "Adani Green Energy",
    blurb: "Forecasts and dashboards that cut grid penalty costs by about 10%.",
    kicker: "Adani Green · DSM & portfolio dashboards",
    period: "2021 – 2023",
    status: "Shipped",
    summary:
      "Predictive analytics for the Deviation Settlement Mechanism, and the Power BI dashboards the solar and wind teams ran on.",
    points: [
      "Cut DSM penalty costs by about 10% with predictive analytics.",
      "Led the solar and wind Power BI dashboards, used by about 5,000 employees.",
      "Won a silver coin and a spot award.",
    ],
    stack: ["Python", "SQL", "Power BI", "Predictive analytics"],
    color: "#ffb35c",
    links: [],
  },
  {
    slug: "sdoh-agents",
    job: "smu",
    title: "Reading between the clinical lines",
    org: "SMU research",
    blurb: "AI agents that read clinical notes for the life details behind a patient's health.",
    kicker: "SMU · multi-agent SDOH extraction",
    period: "2024 – 2025",
    status: "Research",
    summary:
      "A LangGraph multi-agent pipeline that pulls social determinants of health out of MIMIC-III clinical notes, so downstream medical models see the patient's life, not just their labs.",
    points: [
      "DeepSeek, Mistral-7B and LLaMA 3.3 working together as agents.",
      "The annotations improved BioClinicalBERT and Med-BERT across multiple patient cohorts.",
      "Inference run locally with Ollama on NVIDIA A100s in the SMU SuperPOD; annotations stored in TimescaleDB for temporal and cohort analysis.",
    ],
    stack: ["LangGraph", "Ollama", "LLaMA 3.3", "Mistral-7B", "DeepSeek", "TimescaleDB"],
    color: "#7fe9ff",
    links: [{ label: "MIMIC-III", href: "https://physionet.org/content/mimiciii/1.4/" }],
  },
  {
    slug: "ezer-matching",
    job: "ezer",
    title: "Alumni who find each other",
    org: "EZER",
    blurb: "Smart search that helps alumni find the right people to meet.",
    kicker: "EZER · semantic search & matching",
    period: "Nov 2025 – present",
    status: "Live",
    summary:
      "The Bedrock-based RAG layer behind EZER's semantic search and alumni matching, on AWS ECS Fargate, built with the founder through Phase 1 and Phase 2.",
    points: [
      "Moved vector search from OpenSearch Serverless to PostgreSQL with pgvector, cutting search-infrastructure cost by about 80%.",
      "Upgraded the platform's LLM to Claude Sonnet 4.x.",
      "Secured AWS SES production access with SPF / DKIM / DMARC, and led a 90-bug fix sprint for Phase 2.",
    ],
    stack: ["Amazon Bedrock", "RAG", "pgvector", "PostgreSQL", "ECS Fargate", "AWS SES"],
    color: "#b28cff",
    links: [{ label: "app.ezer.network", href: "https://app.ezer.network/" }],
  },
  {
    slug: "citadel-platform",
    job: "citadel",
    title: "Front desks for guarded sites",
    org: "Citadel",
    blurb: "A secure visitor check-in system for high-security sites, live on AWS.",
    kicker: "Citadel · visitor management",
    period: "Aug 2026 – present",
    status: "Live",
    summary:
      "A government-grade visitor-management platform for ITAR-controlled sites, taken from a mock prototype to production on AWS.",
    points: [
      "TypeScript, React, Express and PostgreSQL, with 33 migrations and 25+ reversible deploys.",
      "Owned the AWS infrastructure end to end: EC2 with TLS, least-privilege IAM, S3, Rekognition, Textract, Bedrock, and SES production access (200k emails a day).",
      "The compliance features buyers ask about: OFAC sanctions screening, ITAR export-control gates, a hash-chained audit log, per-site Allow / Deny policies and OIDC single sign-on.",
    ],
    stack: ["TypeScript", "React", "Express", "PostgreSQL", "AWS", "OIDC"],
    color: "#7aa2ff",
    links: [{ label: "citadelvisitor.com", href: "https://citadelvisitor.com/" }],
  },
  {
    slug: "citadel-agent",
    job: "citadel",
    title: "An agent that asks before it acts",
    org: "Citadel",
    blurb: "An AI assistant that does tasks in the app, and asks before it acts.",
    kicker: "Citadel · AI agent on Bedrock",
    period: "2026",
    status: "Shipped",
    summary:
      "An AI agent on Amazon Bedrock that works the Citadel app for you: the app's API exposed as MCP tools, acting as the signed-in user behind a Confirm step.",
    points: [
      "The app's own API as MCP tools, so the agent can do what the user can, and nothing more.",
      "Every action waits on the user's Confirm.",
      "Prompt caching cut the cost per task by 67%.",
    ],
    stack: ["Amazon Bedrock", "MCP", "Agents", "Prompt caching", "TypeScript"],
    color: "#ff7ad9",
    links: [],
  },
];

export const experience: Role[] = [
  {
    slug: "adani",
    role: "Junior Data Scientist",
    org: "Adani Green Energy Ltd",
    place: "Ahmedabad, India",
    period: "Jun 2021 – Aug 2023",
    summary: "Built the models and dashboards behind a 9 GW wind and solar portfolio.",
    points: [
      "Deep-learning models on Vertex AI for solar plant monitoring: ~2% performance-ratio gain.",
      "Predictive analytics that cut penalty costs by ~10%.",
      "Solar and wind Power BI dashboards for ~5,000 employees across a ~9 GW portfolio.",
    ],
  },
  {
    slug: "smu",
    role: "Research Assistant",
    org: "SMU, Lyle School of Engineering",
    place: "Dallas, Texas",
    period: "Jul 2024 – Jul 2025",
    summary: "Researched AI agents that read clinical notes.",
    points: [
      "A LangGraph multi-agent pipeline extracting social determinants of health from MIMIC-III notes.",
      "Local inference with Ollama on NVIDIA A100s in the SMU SuperPOD HPC cluster.",
      "TimescaleDB for temporal and cohort analysis.",
    ],
  },
  {
    slug: "ezer",
    role: "AI Platform Engineer",
    org: "EZER, alumni networking platform",
    place: "Remote",
    period: "Nov 2025 – present",
    summary: "Building the AI search and matching for an alumni network.",
    points: [
      "Built the Bedrock RAG layer behind semantic search and alumni matching on ECS Fargate.",
      "Moved vector search to pgvector: ~80% lower search-infrastructure cost.",
      "SES production access and a 90-bug fix sprint for Phase 2.",
    ],
  },
  {
    slug: "citadel",
    role: "Forward Deployed Engineer",
    org: "Citadel Visitor Management",
    place: "Remote",
    period: "Aug 2026 – present",
    summary: "Took a visitor-management platform from prototype to production.",
    points: [
      "Took the platform from a mock prototype to production on AWS.",
      "Owned the AWS infrastructure and the compliance features: OFAC, ITAR, audit log, SSO.",
      "Shipped a Bedrock agent over MCP tools; prompt caching cut the cost per task by 67%.",
    ],
  },
];
