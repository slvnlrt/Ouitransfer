import { Check } from "lucide-react";

import { localizedPath } from "@/app/layout.config";
import { FeatureBento } from "@/components/home/feature-bento";
import { FinalCta } from "@/components/home/final-cta";
import { Hero } from "@/components/home/hero";
import { Reveal } from "@/components/home/reveal";
import { TechMarquee } from "@/components/home/tech-marquee";
import { LATEST_VERSION } from "@/config/constants";
import { getSiteContent, type SiteContent } from "@/lib/content-i18n";

function HighlightsBand({ items }: { items: string[] }) {
  return (
    <Reveal className="mx-auto max-w-screen-xl px-4 pb-4 sm:px-6 lg:px-8">
      <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3">
        {items.map((item) => (
          <li key={item} className="flex items-center gap-2 text-sm text-fd-muted-foreground">
            <Check className="size-4 text-brand" />
            {item}
          </li>
        ))}
      </ul>
    </Reveal>
  );
}

function Footer({ content }: { content: SiteContent["home"] }) {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex max-w-screen-xl items-center justify-center gap-1.5 px-4 py-8 text-sm text-fd-muted-foreground sm:px-6 lg:px-8">
        <span>{content.footer.poweredBy}</span>
        <span className="font-medium text-brand">Burger&amp;Cie ©</span>
      </div>
    </footer>
  );
}

export default async function HomePage(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;
  const content = getSiteContent(lang);
  const home = content.home;
  const docsLink = localizedPath(`/docs/${LATEST_VERSION}`, lang);

  return (
    <main className="flex flex-col">
      <Hero content={home} docsLink={docsLink} version={LATEST_VERSION} />
      <HighlightsBand items={home.highlights} />
      <FeatureBento content={home} />
      <TechMarquee content={home} />
      <FinalCta content={home} docsLink={docsLink} />
      <Footer content={home} />
    </main>
  );
}
