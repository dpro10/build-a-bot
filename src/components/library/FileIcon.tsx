import { FileText, FileType2, Image as ImageIcon, Presentation, File as FileIconGeneric } from "lucide-react";
import { cn } from "@/lib/utils";

const KINDS: Record<string, { icon: typeof FileText; tone: string; label: string }> = {
  pdf: { icon: FileText, tone: "bg-[#FEE2E2] text-[#DC2626] dark:bg-[#7F1D1D]/50 dark:text-[#FCA5A5]", label: "PDF" },
  docx: { icon: FileType2, tone: "bg-[#DBEAFE] text-[#2563EB] dark:bg-[#1E3A8A]/50 dark:text-[#93C5FD]", label: "Word" },
  pptx: { icon: Presentation, tone: "bg-[#FFEDD5] text-[#EA580C] dark:bg-[#7C2D12]/50 dark:text-[#FDBA74]", label: "Slides" },
  image: { icon: ImageIcon, tone: "bg-[#DCFCE7] text-[#16A34A] dark:bg-[#14532D]/50 dark:text-[#86EFAC]", label: "Photo" },
  text: { icon: FileText, tone: "bg-muted text-muted-foreground", label: "Text" },
};

/** Guess a kind from a file name, before the server has read the file. */
export function kindFromName(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf") return "pdf";
  if (ext === "docx" || ext === "doc") return "docx";
  if (ext === "pptx" || ext === "ppt") return "pptx";
  if (["png", "jpg", "jpeg", "webp", "gif", "heic"].includes(ext)) return "image";
  return "text";
}

export function FileIcon({ kind, className, size = "md" }: { kind: string; className?: string; size?: "sm" | "md" | "lg" }) {
  const k = KINDS[kind] ?? { icon: FileIconGeneric, tone: "bg-muted text-muted-foreground", label: "File" };
  const Icon = k.icon;
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center",
        size === "sm" ? "size-7 rounded-lg [&_svg]:size-3.5" : size === "lg" ? "size-12 rounded-2xl [&_svg]:size-6" : "size-9 rounded-xl [&_svg]:size-[18px]",
        k.tone,
        className,
      )}
      aria-hidden
    >
      <Icon />
    </span>
  );
}

export function kindLabel(kind: string): string {
  return KINDS[kind]?.label ?? "File";
}
