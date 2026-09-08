import { Chip } from "../ui/Chip";
import {
  apiKeyEnvironmentLabel,
  apiKeyEnvironmentTone,
  normalizeApiKeyEnvironment,
} from "../../lib/environment";

export function EnvironmentChip({ environment }: { environment?: string | null }) {
  const env = normalizeApiKeyEnvironment(environment);
  return <Chip tone={apiKeyEnvironmentTone(env)}>{apiKeyEnvironmentLabel(env)}</Chip>;
}
