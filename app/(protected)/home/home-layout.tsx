 "use client";

import { useEffect, useState } from "react";
import { AppSidebar } from "@/components/ui/sidebar";
import { TextShimmer } from "@/components/ui/text-shimmer";
import { HomeCloud } from "@/components/ui/home-cloud";
import { HomeSearchInput } from "./home-search-input";

type HomeLayoutProps = {
  message: string;
};

type SiteMode = "desktop" | "mobile";

export function HomeLayout({ message }: HomeLayoutProps) {
  const [mode, setMode] = useState<SiteMode>("desktop");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const updateMode = () => {
      const width = window.innerWidth;
      const height = window.innerHeight || 1;
      const aspectRatio = width / height;
      setMode(aspectRatio > 1 ? "desktop" : "mobile");
    };
    updateMode();
    setReady(true);
    window.addEventListener("resize", updateMode);
    return () => window.removeEventListener("resize", updateMode);
  }, []);

  if (!ready) {
    return null;
  }

  if (mode === "mobile") {
    return (
      <main className="min-h-screen w-full bg-white flex flex-col overflow-hidden relative">
        <h1
          className="pointer-events-none select-none absolute top-6 left-8 text-2xl font-serif italic tracking-tight text-neutral-800"
        >
          Ctrl 1.6 Beta
        </h1>
        <div className="z-40">
          <AppSidebar />
        </div>
        <section className="flex-1 flex flex-col h-full min-w-0 pt-16 md:pt-0">
          <div className="flex-1 flex flex-col items-center justify-center pt-6 pb-8">
            <div className="w-full max-w-xl px-4 text-center">
              <TextShimmer
                duration={1.2}
                className="mb-4 text-xl font-semibold [--base-color:theme(colors.blue.600)] [--base-gradient-color:theme(colors.blue.200)] dark:[--base-color:theme(colors.blue.700)] dark:[--base-gradient-color:theme(colors.blue.400)]"
              >
                {message}
              </TextShimmer>
              <div className="flex justify-center mb-4">
                <HomeCloud />
              </div>
            </div>
          </div>
          <div className="w-full px-4 pb-12 pt-4 flex justify-center shrink-0">
            <div className="w-full max-w-xl">
              <HomeSearchInput variant="mobile" />
            </div>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="h-screen w-full bg-white flex overflow-hidden">
      <div className="h-full shrink-0">
        <AppSidebar />
      </div>
      <section className="relative flex-1 flex flex-col h-full min-w-0 pt-4 md:pt-6">
        <h1
          className="pointer-events-none select-none absolute top-4 left-8 text-2xl md:text-3xl font-serif italic tracking-tight text-neutral-800"
        >
          Ctrl 1.6 Beta
        </h1>
        <div className="flex-1 flex flex-col items-center justify-center pt-12">
          <div className="w-full max-w-3xl px-4 text-center">
            <TextShimmer
              duration={1.2}
              className="mb-4 text-2xl font-semibold [--base-color:theme(colors.blue.600)] [--base-gradient-color:theme(colors.blue.200)] dark:[--base-color:theme(colors.blue.700)] dark:[--base-gradient-color:theme(colors.blue.400)]"
            >
              {message}
            </TextShimmer>
            <div className="flex justify-center mb-4">
              <HomeCloud />
            </div>
          </div>
        </div>
        <div className="w-full px-4 pb-96 flex justify-center shrink-0">
          <div className="w-full max-w-3xl">
            <HomeSearchInput />
          </div>
        </div>
      </section>
    </main>
  );
}
