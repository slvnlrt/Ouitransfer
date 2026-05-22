import { Banner } from "fumadocs-ui/components/banner";

import "./global.css";

import Link from "fumadocs-core/link";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Inter } from "next/font/google";
import type { ReactNode } from "react";

import { LATEST_VERSION, LATEST_VERSION_PATH } from "@/config/constants";

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
        <Banner variant="rainbow" id="banner-v1-beta">
          <Link href={LATEST_VERSION_PATH}>
            <s>Winter</s> OUITRANSFER {LATEST_VERSION} is coming !
          </Link>
        </Banner>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
