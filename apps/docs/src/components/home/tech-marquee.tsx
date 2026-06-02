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
        <div className="marquee-track flex w-max animate-marquee items-center gap-4">
          {[...STACK, ...STACK].map((tech, i) => (
            <span
              key={`${tech}-${i}`}
              className="flex shrink-0 items-center gap-2 rounded-full border border-fd-border bg-fd-background/60 px-5 py-2 font-mono text-sm text-fd-foreground"
            >
              <span className="size-1.5 rounded-full bg-brand" />
              {tech}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
