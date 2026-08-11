import { Hono } from "hono";
import { extractText, getDocumentProxy, getMeta } from "unpdf";

export type ExtractResponse = {
  text: string;
  pageCount: number;
  title: string | null;
  headings: string[];
};

function looksLikePdf(bytes: Uint8Array, filename: string): boolean {
  if (filename.toLowerCase().endsWith(".pdf")) return true;
  if (bytes.length < 5) return false;
  const header = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
  return header === "%PDF-";
}

/** Best-effort heading heuristic from plain extracted text. */
function extractHeadings(text: string, limit = 40): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const headings: string[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    if (line.length < 3 || line.length > 120) continue;
    if (/[.!?]$/.test(line) && line.length > 60) continue;

    const words = line.split(/\s+/);
    const isAllCaps =
      line === line.toUpperCase() && /[A-Z]/.test(line) && words.length <= 12;
    const isTitleCase =
      words.length >= 2 &&
      words.length <= 14 &&
      words.every((w) => /^[A-Z0-9]/.test(w) || /^[a-z]{1,3}$/.test(w));
    const numbered = /^(?:\d+[\.\)]\s+|[IVXLC]+\.\s+|Chapter\s+\d+)/i.test(line);

    if (!(isAllCaps || isTitleCase || numbered)) continue;

    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    headings.push(line);
    if (headings.length >= limit) break;
  }

  return headings;
}

async function extractFromPdf(bytes: Uint8Array): Promise<ExtractResponse> {
  const pdf = await getDocumentProxy(bytes);
  const meta = await getMeta(pdf).catch(() => null);
  const rawTitle = meta?.info?.Title;
  const title =
    typeof rawTitle === "string" && rawTitle.trim() ? rawTitle.trim() : null;

  const { totalPages, text } = await extractText(pdf, { mergePages: true });

  return {
    text: text.trim(),
    pageCount: totalPages,
    title,
    headings: extractHeadings(text),
  };
}

/**
 * Tool routes are relative to the mount prefix (e.g. /pdf-extract).
 * Settlement/pricing gate goes on this app (per-tool), not on the root server —
 * each tool may be priced differently.
 */
export const app = new Hono();

// app.use("/extract", settlementGate(...))  // per-tool gate lands here before deploy

app.get("/health", (c) => c.json({ ok: true }));

app.post("/extract", async (c) => {
  let form: FormData;
  try {
    form = await c.req.formData();
  } catch {
    return c.json({ error: "Expected multipart/form-data body" }, 400);
  }

  const file = form.get("file");
  if (!file || !(file instanceof File)) {
    return c.json({ error: 'Missing multipart field "file"' }, 400);
  }

  const buffer = new Uint8Array(await file.arrayBuffer());
  if (buffer.byteLength === 0) {
    return c.json({ error: "Uploaded file is empty" }, 400);
  }

  if (!looksLikePdf(buffer, file.name || "")) {
    return c.json({ error: "File does not appear to be a PDF" }, 415);
  }

  try {
    const result = await extractFromPdf(buffer);
    return c.json(result satisfies ExtractResponse);
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF extraction failed";
    return c.json({ error: message }, 422);
  }
});
