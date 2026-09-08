import { useCallback, useEffect, useState } from "react";

export function isMacPlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Mac|iPhone|iPad|iPod/.test(navigator.userAgent);
}

export function shortcutLabel(): string {
  return isMacPlatform() ? "⌘K" : "Ctrl+K";
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  const close = useCallback(() => setOpen(false), []);
  const show = useCallback(() => setOpen(true), []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.isComposing) return;
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((value) => !value);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { open, setOpen, toggle, close, show };
}
