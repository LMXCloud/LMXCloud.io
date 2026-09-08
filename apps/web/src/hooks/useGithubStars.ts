import { useEffect, useState } from "react";
import { GITHUB_API_REPO } from "../lib/social";

export function useGithubStars(repo = GITHUB_API_REPO): number | null {
  const [stars, setStars] = useState<number | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch(`https://api.github.com/repos/${repo}`, {
      headers: { Accept: "application/vnd.github+json" },
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) throw new Error("GitHub stars unavailable");
        return response.json() as Promise<{ stargazers_count?: unknown }>;
      })
      .then((data) => {
        if (typeof data.stargazers_count === "number") {
          setStars(data.stargazers_count);
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
      });

    return () => controller.abort();
  }, [repo]);

  return stars;
}
