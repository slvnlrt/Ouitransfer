"use client";

import { Coffee, Github, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useState } from "react";

/**
 * Custom sidebar footer for the docs layout.
 *
 * The default fumadocs footer renders the icon links on the start side and the
 * theme switch pushed to the end with `ms-auto`, which leaves an awkward empty
 * gap when there are only a couple of icons. We disable the default icon bar
 * (`on: "nav"` on the links) and theme switch (`themeSwitch.enabled = false`)
 * and render this instead: a single full-width bar split into equal segments so
 * it visually matches the language selector above it.
 */
export function SidebarFooter() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";

  const itemClassName =
    "flex flex-1 items-center justify-center rounded-md p-2 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground";

  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-fd-secondary/50 p-1">
      <a
        href="https://github.com/slvnlrt/ouitransfer"
        target="_blank"
        rel="noreferrer noopener"
        aria-label="GitHub"
        className={itemClassName}
      >
        <Github className="size-4" />
      </a>
      <a
        href="https://ko-fi.com/slvnlrt"
        target="_blank"
        rel="noreferrer noopener"
        aria-label="Ko-fi"
        className={itemClassName}
      >
        <Coffee className="size-4" />
      </a>
      <button
        type="button"
        onClick={() => setTheme(isDark ? "light" : "dark")}
        aria-label="Toggle theme"
        className={itemClassName}
      >
        {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    </div>
  );
}
