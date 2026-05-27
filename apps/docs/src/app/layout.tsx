import { Banner } from "fumadocs-ui/components/banner";

import "./global.css";

import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { BannerModalTrigger } from "@/components/BannerModalTrigger";
import { V1BetaModal } from "@/components/V1BetaModal";
import { LATEST_VERSION } from "@/config/constants";

const inter = Inter({
  subsets: ["latin"],
});

export const metadata = {
  title: "OUITRANSFER | Official Website",
  description: "OUITRANSFER is a fast, simple and powerful document sharing platform.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.className} suppressHydrationWarning>
      <body className="flex flex-col min-h-screen">
        <Banner variant="rainbow" id="banner-v1-beta" className="!items-start pt-2">
          <BannerModalTrigger>
            <s>Winter</s> OUITRANSFER {LATEST_VERSION} is coming !
          </BannerModalTrigger>
        </Banner>
        <RootProvider>
          {children}
          <V1BetaModal />
        </RootProvider>
      </body>
    </html>
  );
}
