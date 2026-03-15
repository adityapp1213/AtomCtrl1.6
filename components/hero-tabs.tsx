'use client';

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

type TabId = "chat" | "search" | "shop" | "code";

const tabs: { id: TabId; label: string }[] = [
  { id: "chat", label: "Chat" },
  { id: "search", label: "Search" },
  { id: "shop", label: "Shop" },
  { id: "code", label: "Code" },
];

export function HeroTabs() {
  const [active, setActive] = useState<TabId>("chat");

  // Auto-rotate tabs in a quicker loop
  useEffect(() => {
    const order: TabId[] = ["chat", "search", "shop", "code"];
    const currentIndex = order.indexOf(active);
    const timer = setTimeout(() => {
      const next = order[(currentIndex + 1) % order.length];
      setActive(next);
    }, 3200);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <section className="mx-4 sm:mx-8 lg:mx-16 bg-white pt-2 pb-16 lg:pt-4 lg:pb-24 px-4 sm:px-8">
      <div className="container mx-auto flex flex-col gap-12">
        <AnimatePresence mode="wait">
          <motion.div
            key={active}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="grid gap-10 lg:grid-cols-[minmax(0,1.1fr)_auto_minmax(0,1.1fr)] items-start"
          >
            <div className="flex flex-col gap-4 px-4 sm:px-6 lg:pl-10 lg:pr-4">
              <div className="inline-flex items-center rounded-full bg-neutral-100 px-3 py-1 text-xs font-medium text-neutral-600 w-fit lg:mt-2">
                {active === "chat"
                  ? "Chat with Cloudy"
                  : active === "search"
                  ? "Search the web with Cloudy"
                  : active === "shop"
                  ? "Shop with Cloudy"
                  : "Code with Cloudy"}
              </div>
              <h1 className="text-3xl sm:text-4xl font-bold text-neutral-900">
                {active === "chat"
                  ? "Conversations that feel natural"
                  : active === "search"
                  ? "Web search made easy"
                  : active === "shop"
                  ? "Shop smarter"
                  : "Code made easy"}
              </h1>
              <p className="text-sm sm:text-base text-neutral-600 max-w-md">
                {active === "chat"
                  ? "Ask questions, explore ideas, or solve problems with an assistant that understands context and keeps everything organized in one place."
                  : active === "search"
                  ? "Cloudy finds answers, sources, and media across the web and streams them directly into your conversation so you never need to open endless tabs again."
                  : active === "shop"
                  ? "Tell Cloudy what you want and it finds products, compares prices, checks reviews, and brings the best options straight into your chat."
                  : "Cloudy helps you generate, debug, and improve code directly inside the chat. Describe what you want to build and get working solutions instantly."}
              </p>
              <div className="mt-5">
                <Button
                  size="default"
                  className="rounded-full px-8 py-2.5 bg-black hover:bg-black/90 text-white text-sm sm:text-base ml-1 sm:ml-2"
                >
                  Get started
                </Button>
              </div>
            </div>

            <div className="flex justify-center">
              <div className="w-full max-w-[360px]">
                <img
                  src={
                    active === "chat"
                      ? "/iPhone-13-PRO-atomctrlvo1.vercel.app%20(2).png"
                      : active === "search"
                      ? "/iPhone-13-PRO-atomctrlvo1.vercel.app%20(5).png"
                      : active === "shop"
                      ? "/iPhone-13-PRO-atomctrlvo1.vercel.app%20(4).png"
                      : "/iPhone-13-PRO-atomctrlvo1.vercel.app%20(6).png"
                  }
                  alt={
                    active === "chat"
                      ? "Atom Ctrl chat on iPhone"
                      : active === "search"
                      ? "Atom Ctrl search on iPhone"
                      : active === "shop"
                      ? "Atom Ctrl shopping on iPhone"
                      : "Atom Ctrl coding on iPhone"
                  }
                  className="w-full h-auto"
                />
              </div>
            </div>

            <div className="hidden lg:flex justify-center lg:justify-center mt-10 lg:mt-0 lg:self-end pl-4 sm:pl-6 lg:pl-8 pr-6 sm:pr-10 lg:pr-16 pb-[42px]">
              <div className="flex flex-col justify-between rounded-3xl bg-neutral-50 shadow-md border border-neutral-100 w-40 h-40 sm:w-44 sm:h-44 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-white text-xl shadow-sm">
                  {active === "chat"
                    ? "✅"
                    : active === "search"
                    ? "🌐"
                    : active === "shop"
                    ? "🛍️"
                    : "💻"}
                </div>
                <p className="text-[11px] sm:text-xs font-medium text-neutral-900 leading-snug">
                  {active === "chat"
                    ? "Keep your chats and answers in one place."
                    : active === "search"
                    ? "See results and sources right next to your chat."
                    : active === "shop"
                    ? "Spot the best options without hopping across tabs."
                    : "Glanceable code help while you stay in flow."}
                </p>
              </div>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>
    </section>
  );
}
