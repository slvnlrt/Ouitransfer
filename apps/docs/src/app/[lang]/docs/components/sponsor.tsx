import { Coffee } from "lucide-react";

export function Sponsor() {
  return (
    <footer>
      <a
        href="https://ko-fi.com/slvnlrt"
        target="_blank"
        rel="noopener noreferrer"
        className="m-2 mt-5 flex items-center justify-center gap-2 p-3 rounded-lg border-2 border-[#FF6433]/30 bg-[#FF6433]/10 text-[#FF6433] hover:bg-[#FF6433]/20 transition-colors"
      >
        <Coffee size={18} />
        <span className="text-xs font-medium">Support on Ko-fi</span>
      </a>
    </footer>
  );
}
