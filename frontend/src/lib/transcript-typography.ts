export const TRANSCRIPT_WORD_FLOW_CLASS_NAME =
  "font-content flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-[15px] font-medium leading-7 text-[#342752]";

export const EDITABLE_TIMED_WORD_CLASS_NAME =
  "font-content inline-block h-7 min-w-0 max-w-full rounded border-0 px-0.5 align-middle text-[15px] leading-7 outline-none transition-colors duration-150";

export function editableTimedWordWidthCh(value: string): number {
  const normalizedLength = Array.from(value.normalize("NFC")).length;
  return Math.max(2, Math.min(34, normalizedLength + 0.75));
}
