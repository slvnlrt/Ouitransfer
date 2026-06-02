import {
  Bell,
  Inbox,
  KeyRound,
  Lock,
  type LucideIcon,
  Network,
  ScrollText,
  Server,
  Users,
} from "lucide-react";
import type { ReactNode } from "react";
import {
  AuditFeed,
  NotificationStack,
  QuotaBars,
  ReverseUpload,
  SyncFlow,
} from "@/components/home/feature-visuals";
import { Reveal } from "@/components/home/reveal";
import type { SiteContent } from "@/lib/content-i18n";
import { cn } from "@/lib/utils";

/** OIDC providers shipped out of the box (proper nouns, not translated). */
const SSO_PROVIDERS = ["Google", "GitHub", "Authentik", "Zitadel", "Auth0"];

function IconChip({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <div className="inline-flex size-11 items-center justify-center rounded-xl bg-brand/10 text-brand ring-1 ring-brand/20">
      <Icon className="size-5" />
    </div>
  );
}

function BentoCard({
  className,
  icon,
  title,
  description,
  children,
}: {
  className?: string;
  icon: LucideIcon;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div
      className={cn(
        "group relative flex h-full flex-col overflow-hidden rounded-2xl border border-fd-border bg-fd-card/40 p-6 transition-all duration-300 hover:border-brand/40 hover:shadow-lg hover:shadow-brand/5",
        className,
      )}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-24 h-40 bg-brand/10 opacity-0 blur-3xl transition-opacity duration-500 group-hover:opacity-100"
      />
      <div className="relative flex flex-1 flex-col">
        <IconChip icon={icon} />
        <h3 className="mt-4 text-lg font-semibold text-fd-foreground">{title}</h3>
        <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">{description}</p>
        {children}
      </div>
    </div>
  );
}

export function FeatureBento({ content }: { content: SiteContent["home"] }) {
  const f = content.features;

  return (
    <section className="mx-auto max-w-screen-xl px-4 py-20 sm:px-6 md:py-28 lg:px-8">
      <Reveal className="mx-auto max-w-2xl text-center">
        <p className="text-sm font-semibold uppercase tracking-widest text-brand">{f.eyebrow}</p>
        <h2 className="mt-3 text-balance text-3xl font-bold tracking-tight text-fd-foreground sm:text-4xl">
          {f.heading}
        </h2>
        <p className="mt-4 text-pretty text-lg text-fd-muted-foreground">{f.subtitle}</p>
      </Reveal>

      <div className="mt-14 grid gap-4 lg:grid-cols-6">
        {/* Shares — large, with capability tags */}
        <Reveal className="lg:col-span-4" delay={0}>
          <BentoCard icon={Lock} title={f.shares.title} description={f.shares.description}>
            <div className="mt-6 flex flex-wrap gap-2">
              {f.shares.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-lg border border-fd-border bg-fd-background/60 px-2.5 py-1 font-mono text-xs text-fd-muted-foreground"
                >
                  {tag}
                </span>
              ))}
            </div>
          </BentoCard>
        </Reveal>

        {/* Identity — SSO & 2FA, with provider pills */}
        <Reveal className="lg:col-span-2" delay={0.08}>
          <BentoCard icon={KeyRound} title={f.identity.title} description={f.identity.description}>
            <div className="mt-auto flex flex-wrap gap-1.5 pt-5">
              {SSO_PROVIDERS.map((p) => (
                <span
                  key={p}
                  className="rounded-md border border-fd-border bg-fd-background/60 px-2 py-0.5 text-[11px] text-fd-muted-foreground"
                >
                  {p}
                </span>
              ))}
              <span className="rounded-md border border-brand/30 bg-brand/10 px-2 py-0.5 text-[11px] font-medium text-brand">
                +more
              </span>
            </div>
          </BentoCard>
        </Reveal>

        {/* Directory sync */}
        <Reveal className="lg:col-span-2" delay={0}>
          <BentoCard icon={Network} title={f.directory.title} description={f.directory.description}>
            <SyncFlow />
          </BentoCard>
        </Reveal>

        {/* Groups & quotas */}
        <Reveal className="lg:col-span-2" delay={0.08}>
          <BentoCard icon={Users} title={f.teams.title} description={f.teams.description}>
            <QuotaBars />
          </BentoCard>
        </Reveal>

        {/* Audit trail */}
        <Reveal className="lg:col-span-2" delay={0.16}>
          <BentoCard icon={ScrollText} title={f.audit.title} description={f.audit.description}>
            <AuditFeed />
          </BentoCard>
        </Reveal>

        {/* Reverse shares */}
        <Reveal className="lg:col-span-3" delay={0}>
          <BentoCard
            icon={Inbox}
            title={f.reverseShare.title}
            description={f.reverseShare.description}
          >
            <ReverseUpload />
          </BentoCard>
        </Reveal>

        {/* Email notifications */}
        <Reveal className="lg:col-span-3" delay={0.08}>
          <BentoCard
            icon={Bell}
            title={f.notifications.title}
            description={f.notifications.description}
          >
            <NotificationStack />
          </BentoCard>
        </Reveal>

        {/* Self-hosted — wide, with docker snippet */}
        <Reveal className="lg:col-span-6" delay={0}>
          <BentoCard
            icon={Server}
            title={f.selfHosted.title}
            description={f.selfHosted.description}
          >
            <pre className="mt-5 w-fit rounded-lg border border-fd-border bg-fd-background/70 px-4 py-2.5 font-mono text-xs text-fd-foreground">
              <span className="select-none text-brand">$ </span>docker compose up -d
            </pre>
          </BentoCard>
        </Reveal>
      </div>
    </section>
  );
}
