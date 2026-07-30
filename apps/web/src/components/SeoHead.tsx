import { Helmet } from "react-helmet-async";
import {
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  DEFAULT_TITLE,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_WIDTH,
  SITE_NAME,
  absoluteUrl,
} from "../lib/seo";

type SeoHeadProps = {
  title?: string;
  description?: string;
  /** Path only, e.g. `/docs` or `/legal/terms`. Defaults to `/`. */
  path?: string;
  /** Absolute or site-relative OG/Twitter image. Defaults to `/brand/og-share.png`. */
  image?: string;
  noIndex?: boolean;
};

function resolveImageUrl(image: string): string {
  return image.startsWith("http://") || image.startsWith("https://")
    ? image
    : absoluteUrl(image);
}

export function SeoHead({
  title = DEFAULT_TITLE,
  description = DEFAULT_DESCRIPTION,
  path = "/",
  image = DEFAULT_OG_IMAGE,
  noIndex = false,
}: SeoHeadProps) {
  const canonical = absoluteUrl(path);
  const imageUrl = resolveImageUrl(image);

  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      {noIndex ? <meta name="robots" content="noindex, nofollow" /> : null}

      <meta property="og:type" content="website" />
      <meta property="og:site_name" content={SITE_NAME} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={imageUrl} />
      <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
      <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />

      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={imageUrl} />
      <meta property="og:locale" content="en_US" />
    </Helmet>
  );
}
