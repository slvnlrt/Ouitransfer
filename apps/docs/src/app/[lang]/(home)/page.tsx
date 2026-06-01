import {
  BatteryChargingIcon,
  BookOpenText,
  CloudIcon,
  DatabaseIcon,
  GithubIcon,
  KeyboardIcon,
  LayoutIcon,
  LockIcon,
  type LucideIcon,
  MousePointer,
  RocketIcon,
  SearchIcon,
  TimerIcon,
  UploadIcon,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { localizedPath } from "@/app/layout.config";
import { AnimatedGridPattern } from "@/components/magicui/animated-grid-pattern";
import { PulsatingButton } from "@/components/magicui/pulsating-button";
import { RippleButton } from "@/components/magicui/ripple-button";
import { TypingAnimation } from "@/components/magicui/typing-animation";
import { WordRotate } from "@/components/magicui/word-rotate";
import { ThreeDMarquee } from "@/components/ui/3d-marquee";
import { TextHoverEffect } from "@/components/ui/text-hover-effect";
import { LATEST_VERSION } from "@/config/constants";
import { getSiteContent, type SiteContent } from "@/lib/content-i18n";

// TODO: replace with current screenshots once they are taken
const images: string[] = [];

function Hero({ content, docsLink }: { content: SiteContent; docsLink: string }) {
  const t = content.home.hero;
  return (
    <section className="relative z-[2] flex flex-col border-x border-t px-6 pt-12 pb-10 md:px-12 md:pt-16 max-md:text-center overflow-hidden">
      <div className="relative flex flex-col">
        {/* Background text fills the content area */}
        <div className="absolute top-0 bottom-0 left-[-2%] right-[-2%] hidden lg:block z-0">
          <TextHoverEffect text="OUITRANSFER" />
        </div>
        <div className="relative z-10 flex flex-col pointer-events-none">
          <h1 className="mb-8 text-6xl font-bold">
            OUITRANSFER{" "}
            <span className="text-[13px] font-light text-muted-foreground/50 font-mono">
              {LATEST_VERSION}
            </span>
          </h1>
          <h1 className="hidden text-4xl font-medium max-w-[600px] md:block mb-4">{t.tagline}</h1>
          <p className="mb-8 text-fd-muted-foreground md:max-w-[80%] md:text-xl">{t.description}</p>
          <div className="inline-flex items-center gap-6 max-md:mx-auto mb-4 pointer-events-auto">
            <PulsatingButton>
              <div className="flex gap-2 items-center">
                <BookOpenText size={18} />
                <Link href={docsLink}>{t.documentation}</Link>
              </div>
            </PulsatingButton>
            <RippleButton>
              <a
                href="https://github.com/slvnlrt/ouitransfer"
                target="_blank"
                rel="noreferrer noopener"
                className="flex gap-2 items-center"
              >
                <GithubIcon size={18} />
                {t.github}
              </a>
            </RippleButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function LogoShowcase() {
  if (images.length === 0) return null;
  return (
    <div className="z-[2] border-x bg-background">
      <ThreeDMarquee images={images} className="rounded-none" />
    </div>
  );
}

function Feedback({ content }: { content: SiteContent }) {
  const t = content.home.feedback;
  return (
    <section className="relative flex flex-col items-center overflow-hidden border-x border-t px-6 py-8 md:py-16">
      <p className="text-xl font-medium flex items-center justify-center gap-2">
        {t.title}
        <WordRotate duration={4000} words={t.words} className="min-w-[100px] inline-block" />
      </p>
    </section>
  );
}

function Highlight({
  icon: Icon,
  heading,
  children,
}: {
  icon: LucideIcon;
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="border-l border-t px-6 py-12">
      <div className="mb-4 flex items-center gap-2 text-fd-muted-foreground">
        <Icon className="size-6" />
        <h2 className="text-sm font-medium">{heading}</h2>
      </div>
      <span className="font-medium">{children}</span>
    </div>
  );
}

function Features({ content }: { content: SiteContent }) {
  const core = content.home.coreFeatures;
  const callout = content.home.callout;
  const key = content.home.keyFeatures;
  return (
    <>
      {/* Core Features */}
      <section className="grid grid-cols-1 border-t border-x md:grid-cols-2">
        <div className="flex flex-col gap-4 border-r p-8 md:p-12">
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-3 text-muted-foreground border border-foreground w-fit p-3 rounded-lg">
              <UploadIcon className="size-6 text-foreground" />
            </div>
            <h3 className="text-2xl font-semibold">{core.uploadTitle}</h3>
          </div>
          <p className="text-muted-foreground">{core.uploadDescription}</p>
        </div>
        <div className="flex flex-col gap-4 border-r p-8 md:p-12">
          <div className="flex gap-4 items-center">
            <div className="flex items-center gap-3 text-muted-foreground border border-foreground w-fit p-3 rounded-lg">
              <LockIcon className="size-6 text-foreground" />
            </div>
            <h3 className="text-2xl font-semibold">{core.secureTitle}</h3>
          </div>
          <p className="text-muted-foreground">{core.secureDescription}</p>
        </div>
      </section>

      {/* Hero Section with Animation */}
      <section
        className="relative overflow-hidden border-x border-t px-8 py-16 sm:py-24"
        style={{
          backgroundImage:
            "radial-gradient(circle at center, var(--color-fd-secondary), var(--color-fd-background) 40%)",
        }}
      >
        <div className="text-center">
          <p className="mb-4 w-fit bg-fd-primary px-3 py-1 text-sm font-bold font-mono text-fd-primary-foreground mx-auto">
            {callout.badge}
          </p>
          <h2 className="text-center text-2xl font-semibold sm:text-3xl mb-4">{callout.title}</h2>
          <TypingAnimation className="text-center text-xl text-muted-foreground">
            {callout.subtitle}
          </TypingAnimation>
        </div>
        <AnimatedGridPattern className="opacity-5" />
      </section>

      {/* Technical Features Grid */}
      <section className="grid grid-cols-1 border-r md:grid-cols-2 lg:grid-cols-3">
        <div className="col-span-full flex items-start justify-center border-l border-t p-8 pb-2 text-center">
          <h2 className="bg-fd-primary px-1 text-2xl font-semibold text-fd-primary-foreground">
            {key.heading}
          </h2>
          <MousePointer className="-ml-1 mt-8" />
        </div>

        <Highlight icon={TimerIcon} heading={key.fastTitle}>
          {key.fastDescription}
        </Highlight>

        <Highlight icon={CloudIcon} heading={key.storageTitle}>
          {key.storageDescription}
        </Highlight>

        <Highlight icon={KeyboardIcon} heading={key.apiTitle}>
          {key.apiDescription}
        </Highlight>

        <Highlight icon={SearchIcon} heading={key.searchTitle}>
          {key.searchDescription}
        </Highlight>

        <Highlight icon={LayoutIcon} heading={key.uiTitle}>
          {key.uiDescription}
        </Highlight>

        <Highlight icon={DatabaseIcon} heading={key.databaseTitle}>
          {key.databaseDescription}
        </Highlight>
      </section>
    </>
  );
}

function GetStarted({ content, docsLink }: { content: SiteContent; docsLink: string }) {
  const t = content.home.getStarted;
  return (
    <section className="flex w-full flex-1">
      <div className="w-full flex flex-col gap-8 overflow-hidden border px-8 py-14">
        <div className="text-center mb-6">
          <h2 className="text-4xl font-extrabold font-mono uppercase mb-3">{t.title}</h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">{t.description}</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 mt-8">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-3 text-muted-foreground border border-foreground w-fit p-4 rounded-full">
                <TimerIcon className="size-8 text-foreground" />
              </div>
            </div>
            <h3 className="text-xl font-semibold">{t.quickSetupTitle}</h3>
            <p className="text-muted-foreground">{t.quickSetupDescription}</p>
          </div>

          <div className="text-center space-y-4">
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-3 text-muted-foreground border border-foreground w-fit p-4 rounded-full">
                <BatteryChargingIcon className="size-8 text-foreground" />
              </div>
            </div>
            <h3 className="text-xl font-semibold">{t.fullControlTitle}</h3>
            <p className="text-muted-foreground">{t.fullControlDescription}</p>
          </div>

          <div className="text-center space-y-4">
            <div className="flex items-center justify-center">
              <div className="flex items-center gap-3 text-muted-foreground border border-foreground w-fit p-4 rounded-full">
                <RocketIcon className="size-8 text-foreground" />
              </div>
            </div>
            <h3 className="text-xl font-semibold">{t.productionTitle}</h3>
            <p className="text-muted-foreground">{t.productionDescription}</p>
          </div>
        </div>

        <div className="border-t pt-8 mt-12">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <PulsatingButton>
              <div className="flex gap-2 items-center">
                <BookOpenText size={18} />
                <Link href={docsLink}>{t.readDocs}</Link>
              </div>
            </PulsatingButton>
            <RippleButton>
              <a
                href="https://github.com/slvnlrt/ouitransfer"
                target="_blank"
                rel="noreferrer noopener"
                className="flex gap-2 items-center"
              >
                <GithubIcon size={18} />
                {t.viewGithub}
              </a>
            </RippleButton>
          </div>
        </div>
      </div>
    </section>
  );
}

function FullWidthFooter({ content }: { content: SiteContent }) {
  return (
    <footer className="w-full flex items-center justify-center p-6 border-t font-light container max-w-7xl">
      <div className="flex items-center gap-1 text-sm max-w-7xl">
        <span>{content.home.footer.poweredBy}</span>
        <span className="flex items-center text-green-500 font-light">Burger&amp;Cie ©</span>
      </div>
    </footer>
  );
}

export default async function HomePage(props: { params: Promise<{ lang: string }> }) {
  const { lang } = await props.params;
  const content = getSiteContent(lang);
  const docsLink = localizedPath(`/docs/${LATEST_VERSION}`, lang);

  return (
    <>
      <main className="relative z-[2] w-full px-4 py-6 sm:px-6 lg:px-8">
        <div className="relative mx-auto max-w-screen-xl bg-background">
          <Hero content={content} docsLink={docsLink} />
          <LogoShowcase />
          <Feedback content={content} />
          <Features content={content} />
          <GetStarted content={content} docsLink={docsLink} />
        </div>
      </main>
      <FullWidthFooter content={content} />
    </>
  );
}
