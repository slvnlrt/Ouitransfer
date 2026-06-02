"use client";

import { useAppInfo } from "@/contexts/app-info-context";

export function Favicon() {
  const { appLogo } = useAppInfo();

  return (
    <>
      <link rel="icon" type="image/svg+xml" href={appLogo || "/icon.svg"} />
      <link rel="shortcut icon" type="image/svg+xml" href={appLogo || "/icon.svg"} />
    </>
  );
}
