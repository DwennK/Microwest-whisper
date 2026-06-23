import { describe, expect, it } from "vitest";
import { buildSrt, fileName, formatBytes, formatDuration, formatSrtTimestamp } from "./format";

describe("format helpers", () => {
  it("formats durations and byte sizes for the UI", () => {
    expect(formatDuration(null)).toBe("durée inconnue");
    expect(formatDuration(3661)).toBe("01:01:01");
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1536)).toBe("1.5 KiB");
  });

  it("extracts file names from unix and windows paths", () => {
    expect(fileName("/tmp/audio/interview.wav")).toBe("interview.wav");
    expect(fileName("C:\\audio\\meeting.mp3")).toBe("meeting.mp3");
  });

  it("builds valid SRT text from selected transcript segments", () => {
    expect(formatSrtTimestamp(62.345)).toBe("00:01:02,345");
    expect(
      buildSrt([
        { start: 0, end: 1.25, text: " Bonjour " },
        { start: 61.5, end: 62.345, text: "Suite" },
      ]),
    ).toBe("1\n00:00:00,000 --> 00:00:01,250\nBonjour\n\n2\n00:01:01,500 --> 00:01:02,345\nSuite");
  });
});
