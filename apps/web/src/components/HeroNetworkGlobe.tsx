import type { DepinProvider } from "@lmxcloud/shared";
import { useEffect, useMemo, useState } from "react";
import { cn } from "../lib/cn";
import { CobeGlobe, type GlobeMarker } from "./ui/CobeGlobe";

const PROVIDER_GLOBE_LOCATIONS: Record<DepinProvider, [number, number]> = {
  ionet: [37.7749, -122.4194],
  akash: [51.5074, -0.1278],
  aethir: [25.2048, 55.2708],
  nosana: [52.3676, 4.9041],
};

/** Global compute nodes — unlabeled dots for distributed-network density. */
const NETWORK_EDGE_NODES: { id: string; location: [number, number]; size?: number }[] = [
  { id: "edge-tokyo", location: [35.6762, 139.6503] },
  { id: "edge-seoul", location: [37.5665, 126.978] },
  { id: "edge-singapore", location: [1.3521, 103.8198] },
  { id: "edge-mumbai", location: [19.076, 72.8777] },
  { id: "edge-jakarta", location: [-6.2088, 106.8456] },
  { id: "edge-sydney", location: [-33.8688, 151.2093] },
  { id: "edge-auckland", location: [-36.8485, 174.7633] },
  { id: "edge-dubai", location: [25.2048, 55.2708] },
  { id: "edge-istanbul", location: [41.0082, 28.9784] },
  { id: "edge-frankfurt", location: [50.1109, 8.6821] },
  { id: "edge-amsterdam", location: [52.3676, 4.9041] },
  { id: "edge-paris", location: [48.8566, 2.3522] },
  { id: "edge-stockholm", location: [59.3293, 18.0686] },
  { id: "edge-lagos", location: [6.5244, 3.3792] },
  { id: "edge-nairobi", location: [-1.2921, 36.8219] },
  { id: "edge-cairo", location: [30.0444, 31.2357] },
  { id: "edge-saopaulo", location: [-23.5505, -46.6333] },
  { id: "edge-buenosaires", location: [-34.6037, -58.3816] },
  { id: "edge-santiago", location: [-33.4489, -70.6693] },
  { id: "edge-toronto", location: [43.6532, -79.3832] },
  { id: "edge-chicago", location: [41.8781, -87.6298] },
  { id: "edge-miami", location: [25.7617, -80.1918] },
  { id: "edge-denver", location: [39.7392, -104.9903] },
  { id: "edge-mexicocity", location: [19.4326, -99.1332] },
  { id: "edge-seattle", location: [47.6062, -122.3321] },
  { id: "edge-reykjavik", location: [64.1466, -21.9426], size: 0.018 },
];

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false,
  );

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}

export interface HeroProviderNode {
  id: DepinProvider;
  label: string;
}

interface HeroNetworkGlobeProps {
  providerNodes: HeroProviderNode[];
  /** @deprecated Use layout="bottom" */
  viewportHalf?: boolean;
  layout?: "bottom" | "side";
}

export function HeroNetworkGlobe({
  providerNodes,
  viewportHalf = false,
  layout,
}: HeroNetworkGlobeProps) {
  const resolvedLayout = layout ?? (viewportHalf ? "bottom" : "inline");
  const reducedMotion = usePrefersReducedMotion();

  const markers = useMemo<GlobeMarker[]>(() => {
    const providerMarkers: GlobeMarker[] = providerNodes.map((node) => ({
      id: node.id,
      label: node.label,
      location: PROVIDER_GLOBE_LOCATIONS[node.id],
      size: 0.032,
    }));

    const edgeMarkers: GlobeMarker[] = NETWORK_EDGE_NODES.map((node) => ({
      id: node.id,
      label: "",
      location: node.location,
      size: node.size ?? (resolvedLayout === "side" ? 0.02 : 0.016),
    }));

    return [...providerMarkers, ...edgeMarkers];
  }, [providerNodes, resolvedLayout]);

  const globe = (
    <CobeGlobe
      markers={markers}
      arcs={[]}
      reducedMotion={reducedMotion}
      speed={0.002}
      markerSize={0.02}
      mapBrightness={resolvedLayout === "side" ? 14 : 5}
      dark={resolvedLayout === "side" ? 0.25 : 1}
      diffuse={resolvedLayout === "side" ? 1.8 : 1.2}
      baseColor={resolvedLayout === "side" ? [0.18, 0.2, 0.28] : undefined}
      glowColor={resolvedLayout === "side" ? [0.14, 0.16, 0.28] : undefined}
      markerColor={resolvedLayout === "side" ? [0.45, 0.52, 1] : undefined}
      theta={0.15}
      opacity={resolvedLayout === "side" ? 1 : 0.85}
    />
  );

  if (resolvedLayout === "side") {
    return (
      <div
        className="relative flex h-[calc(100dvh-4rem)] w-full min-w-[min(44vw,520px)] items-center justify-center px-2"
        aria-hidden
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(91,107,255,0.14),transparent_72%)]" />
        <div className="relative aspect-square size-[min(calc(100dvh-6rem),min(44vw,520px))]">
          {globe}
        </div>
      </div>
    );
  }

  if (resolvedLayout === "bottom") {
    return (
      <div
        className="relative mx-auto h-[34vh] min-h-[200px] w-full max-h-[360px] shrink-0 overflow-hidden"
        aria-hidden
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-background to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-surface to-transparent" />
        <div className="absolute bottom-0 left-1/2 aspect-[2/1] w-[min(88vw,760px)] -translate-x-1/2 overflow-hidden">
          <div className="absolute inset-x-0 top-0 aspect-square">{globe}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("relative mt-4 w-full sm:mt-6")} aria-hidden>
      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-12 bg-gradient-to-t from-background to-transparent sm:h-16" />
      <div className="relative mx-auto aspect-[2/1] w-full max-w-[min(100%,760px)] overflow-hidden px-[clamp(12px,3vw,32px)]">
        <div className="absolute inset-x-0 top-0 aspect-square">{globe}</div>
      </div>
    </div>
  );
}
