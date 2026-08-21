export const TRANSCRIPT_WORD_FLOW_CLASS_NAME =
  "font-content flex flex-wrap items-baseline gap-x-2 gap-y-2 text-[17px] font-medium leading-9 text-[#342752]";

export const EDITABLE_TIMED_WORD_CLASS_NAME =
  "font-content inline-block h-9 min-w-0 max-w-full rounded border-0 px-1 align-middle text-[17px] leading-9 tracking-[0.01em] outline-none transition-colors duration-150";

export function editableTimedWordWidthCh(value: string): number {
  const normalizedLength = Array.from(value.normalize("NFC")).length;
  return Math.max(2.25, Math.min(42, normalizedLength + 1.25));
}
