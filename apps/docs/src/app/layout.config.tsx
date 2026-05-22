import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { ChevronRight, Github } from "lucide-react";

import { LATEST_VERSION_PATH } from "@/config/constants";

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: (
      <div className="flex items-start gap-1.5">
        <ChevronRight className="text-primary" strokeWidth={3} />
        <span className="text-xl font-medium">OUITRANSFER.</span>
      </div>
    ),
  },
  links: [
    {
      text: "Docs",
      url: LATEST_VERSION_PATH,
      active: "nested-url",
    },
    {
      text: "Github",
      url: "https://github.com/burger-cie/ouitransfer",
      active: "nested-url",
      icon: (
        <>
          <Github fill="currentColor" />
        </>
      ),
    },
  ],
};
