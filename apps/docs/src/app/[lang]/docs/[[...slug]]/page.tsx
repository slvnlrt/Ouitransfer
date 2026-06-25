import Link from "fumadocs-core/link";
import type { LoaderConfig, LoaderOutput } from "fumadocs-core/source";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { redirect } from "next/navigation";
import type { ComponentProps, FC } from "react";

import { localizedPath } from "@/app/layout.config";
import { LATEST_VERSION } from "@/config/constants";
import { i18n } from "@/lib/i18n";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { Footer } from "../components/footer";
import { Sponsor } from "../components/sponsor";

type PageParams = { lang: string; slug?: string[] };

/**
 * Link component that prefixes absolute in-site doc links (`/docs/...`) with the
 * active locale so navigation from a translated page stays in that language.
 * Relative links are already locale-resolved by `createRelativeLink`.
 */
function createLocaleLink(lang: string): FC<ComponentProps<"a">> {
  return function LocaleLink({ href, ...props }) {
    const localized =
      href && lang !== i18n.defaultLanguage && href.startsWith("/docs/") ? `/${lang}${href}` : href;
    return <Link href={localized} {...props} />;
  };
}

export default async function Page(props: { params: Promise<PageParams> }) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) redirect(localizedPath(`/docs/${LATEST_VERSION}`, lang));

  const MDXContent = page.data.body;

  return (
    <DocsPage
      toc={page.data.toc}
      full={page.data.full}
      footer={{ enabled: true, component: <Footer /> }}
      tableOfContent={{
        style: "clerk",
        footer: <Sponsor />,
      }}
    >
      <DocsTitle>{page.data.title}</DocsTitle>
      <div className="border w-full"></div>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDXContent
          components={getMDXComponents({
            a: createRelativeLink(
              source as unknown as LoaderOutput<LoaderConfig>,
              page,
              createLocaleLink(lang),
            ),
          })}
        />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: { params: Promise<PageParams> }) {
  const { lang, slug } = await props.params;
  const page = source.getPage(slug, lang);
  if (!page) redirect(localizedPath(`/docs/${LATEST_VERSION}`, lang));

  return {
    title: `${page.data.title} | OUITRANSFER Docs`,
    description: page.data.description,
  };
}
