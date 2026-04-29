"use client";

import dynamic from "next/dynamic";

export const LazyReactCrop = dynamic(
  () => import("react-image-crop").then((mod) => ({ default: mod.default })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse bg-muted h-64 rounded-md" />,
  },
);
