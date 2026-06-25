"use client";

import { LoadingScreen } from "@/components/layout/loading-screen";
import { HomeContent } from "./components/home-content";
import { Navbar } from "./components/navbar";
import { useHome } from "./hooks/use-home";

export default function HomePage() {
  const { isLoading, shouldShowHomePage } = useHome();

  if (isLoading || !shouldShowHomePage) {
    return <LoadingScreen />;
  }

  return (
    <div className="relative flex flex-col min-h-screen">
      <Navbar />
      <HomeContent />
    </div>
  );
}
