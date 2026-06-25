"use client";

import { use, useEffect, useId, useState } from "react";
import { useTheme } from "next-themes";

export function Mermaid({ chart }: { chart: string }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;
  return <MermaidContent chart={chart} />;
}

const cache = new Map<string, Promise<unknown>>();

function cachePromise<T>(key: string, setPromise: () => Promise<T>): Promise<T> {
  const cached = cache.get(key);
  if (cached) return cached as Promise<T>;
  const promise = setPromise();
  cache.set(key, promise);
  return promise;
}

function MermaidContent({ chart }: { chart: string }) {
  const id = useId();
  const { resolvedTheme } = useTheme();
  const { default: mermaid } = use(
    cachePromise("mermaid", () => import("mermaid")),
  ) as { default: typeof import("mermaid").default };

  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "loose",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    theme: resolvedTheme === "dark" ? "dark" : "default",
    flowchart: {
      curve: "basis",
      padding: 10,
      htmlLabels: true,
      nodeSpacing: 30,
      rankSpacing: 35,
    },
    themeVariables:
      resolvedTheme === "dark"
        ? {
            fontSize: "13px",
            clusterBkg: "#1e1b4b",
            clusterBorder: "#6366f1",
            edgeLabelBackground: "#0f172a",
            lineColor: "#818cf8",
          }
        : {
            fontSize: "13px",
            clusterBkg: "#eef2ff",
            clusterBorder: "#818cf8",
            edgeLabelBackground: "#f8fafc",
            lineColor: "#6366f1",
          },
  });

  const { svg, bindFunctions } = use(
    cachePromise(`${chart}-${resolvedTheme}`, () =>
      mermaid.render(id, chart.replaceAll("\\n", "\n")),
    ),
  ) as { svg: string; bindFunctions?: (el: Element) => void };

  return (
    <div
      className="my-6 overflow-x-auto"
      ref={(container) => {
        if (container) bindFunctions?.(container);
      }}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: controlled Mermaid SVG output
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
