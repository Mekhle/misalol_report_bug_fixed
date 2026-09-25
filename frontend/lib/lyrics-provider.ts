import { JSON_SCHEMA, load } from "js-yaml";
export interface TimedLyric { t: number; end?: number; text: string }
const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
/** Lyricsfile 1.0, whole-line timing only. Offset semantics are not standardized. */
export function recordingLyrics(input: unknown) {
  const source = record(input);
  const result = { id: Number(source.id), duration: Number(source.duration), instrumental: source.instrumental === true, plainLyrics: typeof source.plainLyrics === "string" ? source.plainLyrics : "", syncedLyrics: typeof source.syncedLyrics === "string" ? source.syncedLyrics : "", rows: undefined as TimedLyric[] | undefined, timingWarning: "" };
  if (typeof source.lyricsfile !== "string" || !source.lyricsfile.trim()) return result;
  try {
    if (source.lyricsfile.length > 250000) throw new Error("Lyricsfile too large");
    const options = { schema: JSON_SCHEMA, maxDepth: 24, maxTotalMergeKeys: 0 };
    const document = record(load(source.lyricsfile, options));
    if (document.version !== "1.0") throw new Error("Unsupported Lyricsfile version");
    const metadata = record(document.metadata);
    if (Number(metadata.offset_ms || 0) !== 0) throw new Error("Unspecified Lyricsfile offset");
    if (metadata.instrumental === true) result.instrumental = true;
    if (typeof document.plain === "string") result.plainLyrics = document.plain;
    if (Array.isArray(document.lines) && document.lines.length) {
      result.rows = document.lines.slice(0, 1000).map(value => {
        const line = record(value), start = Number(line.start_ms), end = line.end_ms == null ? undefined : Number(line.end_ms);
        if (typeof line.text !== "string" || !Number.isInteger(start) || start < 0 || (end !== undefined && (!Number.isInteger(end) || end < start))) throw new Error("Invalid line timing");
        return { t: start / 1000, ...(end === undefined ? {} : { end: end / 1000 }), text: line.text.slice(0, 4000) };
      }).sort((a, b) => a.t - b.t);
    }
  } catch {
    // Do not silently discard explicit timing details and claim the fallback is accurate.
    result.rows = undefined; result.syncedLyrics = "";
    result.timingWarning = "This lyric timing format is unsupported. Showing plain lyrics.";
  }
  return result;
}
