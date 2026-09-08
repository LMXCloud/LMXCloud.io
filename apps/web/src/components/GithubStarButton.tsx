import { GithubIcon } from "./BrandIcons";
import { Button } from "./ui/Button";
import { useGithubStars } from "../hooks/useGithubStars";
import { GITHUB_REPO_URL } from "../lib/social";

export function GithubStarButton() {
  const stars = useGithubStars();
  const label =
    stars != null ? `Star on GitHub (${stars.toLocaleString()} stars)` : "Star on GitHub";

  return (
    <Button
      href={GITHUB_REPO_URL}
      variant="tertiary"
      size="sm"
      target="_blank"
      rel="noreferrer"
      aria-label={label}
      className="px-2 sm:px-3.5"
    >
      <GithubIcon />
      <span className="hidden sm:inline">Star</span>
      {stars != null ? (
        <span className="text-mono-sm text-on-surface-faint">{stars.toLocaleString()}</span>
      ) : null}
    </Button>
  );
}
