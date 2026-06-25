import { localizedPath } from "@/app/layout.config";
import { FeatureBento } from "@/components/home/feature-bento";
import { FinalCta } from "@/components/home/final-cta";
import { Hero } from "@/components/home/hero";
import { Stats } from "@/components/home/stats";
import { TechMarquee } from "@/components/home/tech-marquee";
import { LATEST_VERSION } from "@/config/constants";
import { getSiteContent } from "@/lib/content-i18n";

function Footer() {
  return (
    <footer className="border-t border-fd-border">
      <div className="mx-auto flex max-w-screen-xl items-center justify-center px-4 py-8 text-sm text-fd-muted-foreground sm:px-6 lg:px-8">
        OUITRANSFER &copy; {new Date().getFullYear()}
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
    <>
      {/* Ultra-subtle film grain over the whole page */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-50 bg-noise opacity-[0.025] mix-blend-soft-light"
      />
      <main className="relative flex flex-col">
        <Hero content={home} docsLink={docsLink} version={LATEST_VERSION} />
        <Stats content={home} />
        <FeatureBento content={home} />
        <TechMarquee content={home} />
        <FinalCta content={home} docsLink={docsLink} />
        <Footer />
      </main>
    </>
  );
}
