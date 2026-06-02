import type { CSSProperties } from "react";

import type { SiteContent } from "@/lib/content-i18n";

const STACK = [
  "Next.js",
  "React 19",
  "Fastify",
  "Prisma",
  "SQLite",
  "Tailwind CSS",
  "TypeScript",
  "Docker",
  "S3",
];

/**
 * Number of times the stack is repeated across the track. The animation scrolls
 * by exactly one copy (`-100% / MARQUEE_COPIES`), so `MARQUEE_COPIES - 1` copies
 * remain on-screen at the translation extreme. With 4 copies that is 3 stacks
 * (~3500px), enough to fill ultra-wide viewports without leaving a visible gap
 * after the last pill before the loop restarts.
 */
const MARQUEE_COPIES = 4;

/**
 * Edge-to-edge, infinitely scrolling strip of the technologies the platform
 * is built on. Pure CSS animation; pauses on hover and reduced motion.
 */
export function TechMarquee({ content }: { content: SiteContent["home"] }) {
  return (
    <section className="border-y border-fd-border bg-fd-card/30 py-12">
      <p className="mb-8 text-center text-sm font-medium uppercase tracking-widest text-fd-muted-foreground">
        {content.stack.heading}
      </p>
      <div className="relative overflow-hidden [mask-image:linear-gradient(to_right,transparent,#000_12%,#000_88%,transparent)]">
        <div
          className="marquee-track flex w-max animate-marquee items-center"
          style={{ "--marquee-copies": MARQUEE_COPIES } as CSSProperties}
        >
          {Array.from({ length: MARQUEE_COPIES }).flatMap((_, copy) =>
            STACK.map((tech, i) => (
              <span
                key={`${tech}-${copy}-${i}`}
                aria-hidden={copy > 0}
                className="mx-2 flex shrink-0 items-center gap-2 rounded-full border border-fd-border bg-fd-background/60 px-5 py-2 font-mono text-sm text-fd-foreground"
              >
                <span className="size-1.5 rounded-full bg-brand" />
                {tech}
              </span>
            )),
          )}
        </div>
      </div>
    </section>
  );
}
