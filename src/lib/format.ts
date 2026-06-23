import type { TranscriptSegment } from "../types";

export function fileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function formatDuration(value: number | null) {
  if (!value) return "durée inconnue";
  const total = Math.round(value);
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSegmentTimestamp(value: number) {
  const total = Math.max(0, Math.floor(value));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatSrtTimestamp(value: number) {
  const milliseconds = Math.max(0, Math.round(value * 1000));
  const hours = Math.floor(milliseconds / 3_600_000);
  const minutes = Math.floor((milliseconds % 3_600_000) / 60_000);
  const seconds = Math.floor((milliseconds % 60_000) / 1000);
  const millis = milliseconds % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(segments: TranscriptSegment[]) {
  return segments
    .map((segment, index) => `${index + 1}\n${formatSrtTimestamp(segment.start)} --> ${formatSrtTimestamp(segment.end)}\n${segment.text.trim()}`)
    .join("\n\n");
}

export function formatBytes(value: number) {
  if (!value) return "0 B";
  const units = ["B", "KiB", "MiB", "GiB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}
