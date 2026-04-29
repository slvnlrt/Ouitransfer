"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";

export function RouteAnnouncer() {
  const pathname = usePathname();
  const announcerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations("a11y");

  useEffect(() => {
    const timer = setTimeout(() => {
      if (announcerRef.current) {
        const title = document.title;
        announcerRef.current.textContent = t("routeChanged", { title });
      }
    }, 100);

    return () => {
      clearTimeout(timer);
    };
  }, [pathname, t]);

  return (
    <div
      ref={announcerRef}
      aria-live="assertive"
      aria-atomic="true"
      className="absolute w-px h-px p-0 -m-px overflow-hidden whitespace-nowrap border-0"
      style={{ clip: "rect(0,0,0,0)" }}
    />
  );
}
