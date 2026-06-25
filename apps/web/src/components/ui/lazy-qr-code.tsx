"use client";

import dynamic from "next/dynamic";

export const LazyQRCode = dynamic(
  () => import("react-qr-code").then((mod) => ({ default: mod.default })),
  {
    ssr: false,
    loading: () => (
      <div className="animate-pulse bg-muted" style={{ width: 200, height: 200 }} />
    ),
  },
);
