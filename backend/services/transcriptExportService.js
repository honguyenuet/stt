function pad(value, length = 2) {
  return String(Math.max(0, Math.floor(value))).padStart(length, "0");
}

function formatCaptionTime(milliseconds, separator) {
  const total = Math.max(0, Math.round(Number(milliseconds) || 0));
  const hours = Math.floor(total / 3_600_000);
  const minutes = Math.floor((total % 3_600_000) / 60_000);
  const seconds = Math.floor((total % 60_000) / 1_000);
  const millis = total % 1_000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(millis, 3)}`;
}

function normalizeExportWords(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((word) => {
    const text = String(word?.text || "").trim();
    const start = Number(word?.start);
    const end = Number(word?.end);
    if (!text || !Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return [];
    return [{ text, start, end, speaker: word.speaker ?? null }];
  });
}

function buildCaptionSegments(words) {
  const segments = [];
  for (const word of words) {
    const current = segments[segments.length - 1];
    const gap = current ? word.start - current.end : 0;
    const sameSpeaker = current && String(current.speaker ?? "") === String(word.speaker ?? "");
    if (!current || !sameSpeaker || gap > 1_500 || current.words.length >= 14) {
      segments.push({ start: word.start, end: word.end, speaker: word.speaker, words: [word.text] });
    } else {
      current.end = word.end;
      current.words.push(word.text);
    }
  }
  return segments;
}

function createTranscriptExport({ format, text, words }) {
  const cleanFormat = ["txt", "srt", "vtt", "json"].includes(format) ? format : "txt";
  const cleanText = String(text || "");
  const normalizedWords = normalizeExportWords(words);
  if (cleanFormat === "json") {
    return {
      extension: "json",
      contentType: "application/json; charset=utf-8",
      content: JSON.stringify({ text: cleanText, words: normalizedWords }, null, 2),
    };
  }
  if (cleanFormat === "txt") {
    return { extension: "txt", contentType: "text/plain; charset=utf-8", content: cleanText };
  }
  const separator = cleanFormat === "srt" ? "," : ".";
  const segments = buildCaptionSegments(normalizedWords);
  const body = segments
    .map((segment, index) => {
      const speaker = segment.speaker === null || segment.speaker === undefined
        ? ""
        : `[Người nói ${segment.speaker}] `;
      return `${cleanFormat === "srt" ? `${index + 1}\n` : ""}${formatCaptionTime(segment.start, separator)} --> ${formatCaptionTime(segment.end, separator)}\n${speaker}${segment.words.join(" ")}`;
    })
    .join("\n\n");
  return {
    extension: cleanFormat,
    contentType:
      cleanFormat === "srt"
        ? "application/x-subrip; charset=utf-8"
        : "text/vtt; charset=utf-8",
    content: cleanFormat === "vtt" ? `WEBVTT\n\n${body}` : body,
  };
}

module.exports = { createTranscriptExport, formatCaptionTime, normalizeExportWords };
