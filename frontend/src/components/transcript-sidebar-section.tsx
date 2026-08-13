import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";

interface TranscriptSidebarSectionProps {
  icon: ReactNode;
  title: string;
  meta?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function TranscriptSidebarSection({
  icon,
  title,
  meta,
  defaultOpen = false,
  children,
}: TranscriptSidebarSectionProps) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-lg border border-[#e1dbea] bg-white"
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-[#21104a] outline-none transition hover:bg-[#fbfaf7] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ffcb05] [&::-webkit-details-marker]:hidden">
        <span className="shrink-0 text-[#8067aa]" aria-hidden="true">
          {icon}
        </span>
        <h2 className="min-w-0 flex-1 truncate text-sm font-black">{title}</h2>
        {meta && (
          <span className="shrink-0 rounded-full bg-[#f3f0f7] px-2 py-0.5 text-[11px] font-bold text-[#756894]">
            {meta}
          </span>
        )}
        <ChevronDown
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-[#8a7da1] transition-transform group-open:rotate-180"
        />
      </summary>
      <div className="border-t border-[#ece7f2] px-3 py-3">{children}</div>
    </details>
  );
}
