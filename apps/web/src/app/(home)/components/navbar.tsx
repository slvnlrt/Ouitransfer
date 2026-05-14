"use client";

import Image from "next/image";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/general/language-switcher";
import { ModeToggle } from "@/components/general/mode-toggle";
import { useAppInfo } from "@/contexts/app-info-context";

export function Navbar() {
  const { appName, appLogo } = useAppInfo();

  return (
    <header className="sticky top-0 z-40 w-full border-b border-border/50 bg-background/70 backdrop-blur-sm px-6">
      <div className="container flex h-16 max-w-screen-xl items-center mx-auto">
        <div className="flex flex-1 items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            {appLogo && (
              <Image
                alt="App Logo"
                className="object-contain rounded"
                src={appLogo}
                width={32}
                height={32}
                unoptimized
              />
            )}
            <p className="font-bold text-2xl">{appName}</p>
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <ModeToggle />
          </div>
        </div>
      </div>
    </header>
  );
}
