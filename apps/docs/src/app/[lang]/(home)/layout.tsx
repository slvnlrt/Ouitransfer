import { HomeLayout } from "fumadocs-ui/layouts/home";
import type { ReactNode } from "react";

import { baseOptions } from "@/app/layout.config";
import { Particles } from "@/components/magicui/particles";

export default async function Layout({
  params,
  children,
}: {
  params: Promise<{ lang: string }>;
  children: ReactNode;
}) {
  const { lang } = await params;
  return (
    <HomeLayout {...baseOptions(lang)}>
      <Particles className="absolute w-full" />
      {children}
    </HomeLayout>
  );
}
