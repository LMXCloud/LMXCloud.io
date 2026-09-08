import { GithubIcon, XIcon } from "./BrandIcons";
import { Button } from "./ui/Button";
import { GITHUB_REPO_URL, X_PROFILE_URL } from "../lib/social";

const LINKS = [
  { href: GITHUB_REPO_URL, label: "GitHub", icon: GithubIcon },
  { href: X_PROFILE_URL, label: "X", icon: XIcon },
] as const;

export function SocialLinks() {
  return (
    <div className="flex items-center gap-0.5">
      {LINKS.map((link) => (
        <Button
          key={link.href}
          href={link.href}
          variant="tertiary"
          size="sm"
          target="_blank"
          rel="noreferrer"
          aria-label={link.label}
          className="h-8 w-8 px-0"
        >
          <link.icon />
        </Button>
      ))}
    </div>
  );
}
