export type ConsolidationNote = {
  key: string;
  frontmatter: Record<string, unknown>;
  body: string;
};

export type ConsolidationCluster = {
  notes: ConsolidationNote[];
};

export type ConsolidationInput = {
  namespace: string;
  clusters: ConsolidationCluster[];
};

export type ConsolidationOutput = {
  body: string;
};

export interface ConsolidationProvider {
  readonly modelId: string;
  consolidate(input: ConsolidationInput): Promise<ConsolidationOutput>;
}
