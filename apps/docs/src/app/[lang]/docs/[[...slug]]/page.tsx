import type { LoaderConfig, LoaderOutput } from "fumadocs-core/source";
import { createRelativeLink } from "fumadocs-ui/mdx";
import { DocsBody, DocsDescription, DocsPage, DocsTitle } from "fumadocs-ui/page";
import { redirect } from "next/navigation";

import { localizedPath } from "@/app/layout.config";
import { LATEST_VERSION } from "@/config/constants";
import { source } from "@/lib/source";
import { getMDXComponents } from "@/mdx-components";
import { Footer } from "../components/footer";
import { Sponsor } from "../components/sponsor";

type PageParams = { lang: string; slug?: string[] };

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
            a: createRelativeLink(source as unknown as LoaderOutput<LoaderConfig>, page),
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
