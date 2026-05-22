import { DocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";

import { baseOptions } from "@/app/layout.config";
import { V1BetaModal } from "@/components/V1BetaModal";
import { source } from "@/lib/source";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={source.pageTree}
      {...baseOptions}
      githubUrl="https://github.com/burger-cie/ouitransfer"
      links={[]}
    >
      {children}
      <V1BetaModal />
    </DocsLayout>
  );
}
