export const LEGAL_EFFECTIVE_DATE = "July 8, 2026";
export const SUPPORT_EMAIL = "support@lmxcloud.io";

export const GITHUB_REPO_URL = "https://github.com/LMXCloud/LMXCloud.io";
export const GITHUB_LEGAL_DIR_URL = `${GITHUB_REPO_URL}/blob/main/legal`;
export const GITHUB_SECURITY_URL = `${GITHUB_REPO_URL}/blob/main/SECURITY.md`;
export const GITHUB_SECURITY_ADVISORIES_URL = `${GITHUB_REPO_URL}/security/advisories/new`;

export const PROVIDER_POLICY_URLS = {
  ionetPrivacy: "https://io.net/privacy",
  ionetLoggingFaq:
    "https://io.net/p/faq-does-io-net-provide-audit-trails-and-logging-for-gpu-workloads",
  ionetConfidentialInference:
    "https://io.net/docs/guides/confidential-inference/overview",
  akashmlPrivacy: "https://akashml.com/privacy",
  aethirPrivacy: "https://docs.aethir.com/terms-of-service/privacy-policy",
} as const;

export type LegalDocId =
  | "terms"
  | "privacy"
  | "acceptable-use"
  | "security"
  | "contact";

export const LEGAL_DOCS: {
  id: LegalDocId;
  title: string;
  description: string;
}[] = [
  {
    id: "terms",
    title: "Terms of Service",
    description: "Beta terms for using LMX Cloud.",
  },
  {
    id: "privacy",
    title: "Privacy Policy",
    description: "What we collect and how we use it.",
  },
  {
    id: "acceptable-use",
    title: "Acceptable Use",
    description: "Rules for lawful, fair API use.",
  },
  {
    id: "security",
    title: "Security",
    description: "How production API and MCP traffic is protected today.",
  },
  {
    id: "contact",
    title: "Contact & support",
    description: "Feedback, abuse reports, and privacy requests.",
  },
];
