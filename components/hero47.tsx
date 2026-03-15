'use client';

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { TextShimmer } from "@/components/ui/text-shimmer";

interface Hero47Props {
  heading?: string;
  subheading?: string;
  description?: string;
  image?: {
    src: string;
    alt: string;
  };
  buttons?: {
    primary?: {
      text: string;
      url: string;
    };
    secondary?: {
      text: string;
      url: string;
    };
  };
  className?: string;
}

const Hero47 = ({
  heading = "AI assistant",
  subheading = "that does stuff.",
  description = "A voice-first search assistant that finds what you need and brings it right into the chat.",
  buttons = {
    primary: {
      text: "Get Started",
      url: "#",
    },
    secondary: {
      text: "Read the docs",
      url: "#",
    },
  },
  image = {
    src: "https://deifkwefumgah.cloudfront.net/shadcnblocks/block/placeholder-dark-7-tall.svg",
    alt: "Placeholder",
  },
  className,
}: Hero47Props) => {

  return (
    <section
      className={cn(
        "mx-4 sm:mx-8 lg:mx-16 bg-white rounded-t-[2.5rem] px-4 sm:px-8 pt-16 pb-20 lg:pt-20 lg:pb-28",
        className
      )}
    >
      <div className="container flex flex-col items-center gap-10 lg:my-0">
        <div className="flex flex-col gap-7 w-full px-4 sm:px-6 lg:px-0 lg:w-2/3">
          <h2 className="text-4xl font-semibold tracking-tight md:text-5xl lg:text-6xl">
            <span className="text-muted-foreground">AI assistant that </span>
            <span className="text-muted-foreground">does </span>
            <TextShimmer
              duration={1.2}
              className="inline-block [--base-color:theme(colors.blue.600)] [--base-gradient-color:theme(colors.blue.200)] dark:[--base-color:theme(colors.blue.700)] dark:[--base-gradient-color:theme(colors.blue.400)]"
            >
              stuff!
            </TextShimmer>
          </h2>
          <p className="text-base text-muted-foreground md:text-lg lg:text-xl">
            {description}
          </p>
          <div className="flex flex-wrap items-start gap-5 lg:gap-7">
            <Button asChild>
              <a href={buttons.primary?.url}>
                <div className="flex items-center gap-2">
                  <ArrowUpRight className="size-4" />
                </div>
                <span className="pr-6 pl-4 text-sm whitespace-nowrap lg:pr-8 lg:pl-6 lg:text-base">
                  {buttons.primary?.text}
                </span>
              </a>
            </Button>
            <Button asChild variant="link" className="underline">
              <a href={buttons.secondary?.url}>Log back in</a>
            </Button>
          </div>
        </div>
        <div className="relative z-10 w-full max-w-[450px] mx-auto">
          <img
            className="w-full h-auto"
            src="/iPhone-13-PRO-atomctrlvo1.vercel.app.png"
            alt="Atom Ctrl on iPhone"
          />
          <div className="absolute right-[-14rem] top-4 lg:right-[-15rem] lg:top-6 hidden lg:block">
            <CloudyWindow />
          </div>
        </div>
      </div>
    </section>
  );
};

function CloudyWindow() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [phase, setPhase] = useState<"idle" | "typing">("idle");
  const [typed, setTyped] = useState("");
  const intro =
    "Hello!!\n" +
    "I am Cloudy! I am here to be your friend <3\n\n" +
    "I can help you with:\n" +
    "~ Answering questions\n" +
    "~ Searching the web\n" +
    "~ Finding products\n" +
    "~ Playing YouTube videos";

  useEffect(() => {
    const node = containerRef.current;
    if (!node || typeof IntersectionObserver === "undefined") {
      setIsVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsVisible(entry.isIntersecting);
        });
      },
      { threshold: 0.4 }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isVisible) {
      setPhase("idle");
      setTyped("");
      return;
    }

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    if (phase === "idle") {
      setTyped("Thinking!!");
      timeoutId = setTimeout(() => {
        setPhase("typing");
        setTyped("");
      }, 1100);
    } else if (phase === "typing") {
      if (typed.length < intro.length) {
        timeoutId = setTimeout(() => {
          setTyped(intro.slice(0, typed.length + 1));
        }, 45);
      } else {
        timeoutId = setTimeout(() => {
          setPhase("idle");
          setTyped("");
        }, 2200);
      }
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isVisible, phase, typed, intro]);

  const isThinking = phase === "idle" && typed === "Thinking!!";
  const lineCount = typed ? typed.split("\n").length : 0;
  const maxHeight =
    isThinking || typed
      ? 24 + lineCount * 18
      : 0;

  return (
    <div
      ref={containerRef}
      className="rounded-3xl bg-neutral-50 shadow-lg border border-neutral-200 px-5 py-4 w-72"
    >
      <div className="mb-2 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Cloudy
      </div>
      <MiniCloudy />
      <div
        className="mt-3 overflow-hidden transition-[max-height] duration-300 ease-out"
        style={{ maxHeight }}
      >
        {isThinking ? (
          <p className="text-sm font-medium text-neutral-500">Thinking!!</p>
        ) : (
          (() => {
            const lines = typed.split("\n");
            const headingLine = lines[0] ?? "";
            const bodyLines = lines.slice(1).join("\n");
            return (
              <>
                {headingLine && (
                  <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-50">
                    {headingLine}
                  </p>
                )}
                {bodyLines && (
                  <p className="mt-1 text-xs font-medium text-neutral-900 dark:text-neutral-50 whitespace-pre-line">
                    {bodyLines}
                  </p>
                )}
              </>
            );
          })()
        )}
      </div>
    </div>
  );
}

function MiniCloudy() {
  const [cursor, setCursor] = useState(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
  });
  const [blink, setBlink] = useState(false);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => setCursor({ x: e.clientX, y: e.clientY });
    window.addEventListener("mousemove", handleMouse);
    return () => window.removeEventListener("mousemove", handleMouse);
  }, []);

  const eyePos = useMemo(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    const w = window.innerWidth || 1;
    const h = window.innerHeight || 1;
    const offsetX = (cursor.x / w - 0.5) * 20;
    const offsetY = (cursor.y / h - 0.5) * 10;
    return { x: offsetX, y: offsetY };
  }, [cursor]);

  useEffect(() => {
    const interval = setInterval(() => {
      setBlink(true);
      setTimeout(() => setBlink(false), 180);
    }, 2800);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="relative w-full aspect-[4/3] overflow-hidden rounded-xl">
      <img
        src="https://pub-940ccf6255b54fa799a9b01050e6c227.r2.dev/cloud.jpg"
        alt="Cloudy"
        className="h-full w-full object-cover"
      />
      {["left", "right"].map((side, idx) => (
        <div
          key={side}
          className="absolute flex items-end justify-center overflow-hidden bg-white"
          style={{
            top: "40%",
            left: idx === 0 ? "38%" : "58%",
            width: "6%",
            height: blink ? "6%" : "16%",
            borderRadius: blink ? "2px" : "50% / 60%",
            transition: "all 0.15s ease",
          }}
        >
          {!blink && (
            <div
              className="bg-black"
              style={{
                width: "60%",
                height: "60%",
                borderRadius: "50%",
                marginBottom: "8%",
                transform: `translate(${eyePos.x}px, ${eyePos.y * 0.2}px)`,
                transition: "all 0.1s ease",
              }}
            />
          )}
        </div>
      ))}
    </div>
  );
}

export { Hero47 };
