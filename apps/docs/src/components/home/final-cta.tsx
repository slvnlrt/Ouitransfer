import { ArrowRight, Github, Rocket } from "lucide-react";
import Link from "next/link";

import { Reveal } from "@/components/home/reveal";
import type { SiteContent } from "@/lib/content-i18n";

const GITHUB_URL = "https://github.com/slvnlrt/ouitransfer";

export function FinalCta({
  content,
  docsLink,
}: {
  content: SiteContent["home"];
  docsLink: string;
}) {
  const t = content.cta;

  return (
    <section className="mx-auto max-w-screen-xl px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <Reveal>
        <div className="relative overflow-hidden rounded-3xl border border-brand/20 bg-gradient-brand bg-[length:200%_200%] px-6 py-16 text-center animate-gradient sm:px-12">
          {/* Soft radial texture */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-20 [background-image:radial-gradient(circle_at_30%_20%,#fff_0,transparent_40%),radial-gradient(circle_at_70%_80%,#fff_0,transparent_35%)]"
          />
          {/* Fine grid */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.08] [background-image:linear-gradient(#fff_1px,transparent_1px),linear-gradient(90deg,#fff_1px,transparent_1px)] [background-size:40px_40px]"
          />
          {/* Periodic light sweep */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute inset-y-0 left-0 w-1/4 animate-sheen bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          </div>
          <div className="relative mx-auto max-w-2xl">
            <h2 className="text-balance text-3xl font-bold tracking-tight text-white sm:text-4xl">
              {t.title}
            </h2>
            <p className="mt-4 text-pretty text-lg text-white/85">{t.description}</p>
            <div className="mt-9 flex flex-col items-center justify-center gap-4 sm:flex-row">
              <Link
                href={docsLink}
                className="group inline-flex items-center gap-2 rounded-xl bg-white px-6 py-3 font-semibold text-brand shadow-lg transition-transform hover:-translate-y-0.5"
              >
                <Rocket className="size-5" />
                {t.primaryCta}
                <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
              </Link>
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 rounded-xl border border-white/40 bg-white/10 px-6 py-3 font-medium text-white backdrop-blur-sm transition-colors hover:bg-white/20"
              >
                <Github className="size-5" />
                {t.secondaryCta}
              </a>
            </div>
          </div>
        </div>
      </Reveal>
    </section>
  );
}
