// Renders AI search results as an inline chat-style answer with rich blocks
"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { WeatherWidget } from "@/components/ui/weather-widget";
import { WeatherItem } from "@/app/lib/weather";
import { VideoList } from "@/components/video-list";
import type { PinnedItem } from "@/app/lib/chat-store";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationCarousel,
  InlineCitationCarouselContent,
  InlineCitationCarouselHeader,
  InlineCitationCarouselIndex,
  InlineCitationCarouselItem,
  InlineCitationSource,
  InlineCitationCarouselPrev,
  InlineCitationCarouselNext,
} from "@/components/ai-elements/inline-citation";
import { Response } from "@/components/ai-elements/response";
import { cn } from "@/lib/utils";

// Normalizes and validates external URLs used for media thumbnails
function normalizeExternalUrl(value: string | undefined) {
  const raw = (value ?? "").trim().replace(/^['"`]+|['"`]+$/g, "");
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

function formatDisplayUrl(value: string) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^www\./i, "");
    return `www.${host}`;
  } catch {
    return value;
  }
}

// Define locally to avoid server-client import issues if any
type YouTubeVideo = {
  id: string;
  title: string;
  description: string;
  thumbnail: string;
  channelTitle: string;
  publishedAt: string;
};

type ShoppingProduct = {
  id: string;
  title: string;
  link: string;
  thumbnailUrl?: string;
  priceText?: string;
  price?: number | null;
  rating?: number | null;
  reviewCount?: number | null;
  source?: string;
  sourceIconUrl?: string;
  descriptionSnippet?: string;
  additionalImageUrls?: string[];
};

type SearchResultsBlockProps = {
  searchQuery: string;
  overallSummaryLines: string[];
  summary?: string | null;
  summaryIsStreaming?: boolean;
  webItems: { link: string; title: string; summaryLines: string[]; imageUrl?: string }[];
  mediaItems: { src: string; alt?: string }[];
  scrapedItems?: { url: string; title?: string; summary: string }[];
  weatherItems?: WeatherItem[];
  youtubeItems?: YouTubeVideo[];
  shoppingItems?: ShoppingProduct[];
  shouldShowTabs: boolean;
  onLinkClick?: (url: string, title: string) => void;
  onPinItem?: (item: PinnedItem) => void;
  pinnedIds?: string[];
  onMediaLoad?: () => void;
};

export function SearchResultsBlock({
  searchQuery,
  overallSummaryLines,
  summary,
  summaryIsStreaming,
  webItems,
  mediaItems,
  scrapedItems,
  weatherItems,
  youtubeItems,
  shoppingItems,
  shouldShowTabs,
  onLinkClick,
  onPinItem,
  pinnedIds,
  onMediaLoad,
}: SearchResultsBlockProps) {
  // keep shouldShowTabs for backwards compatibility, but UI is always inline (no tabs)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [citationActive, setCitationActive] = useState(false);
  const displayText = summaryIsStreaming
    ? String(summary ?? "")
    : (summary || "").trim() || overallSummaryLines.filter(Boolean).join("\n");
  const hasAnyAnswerText = Boolean((displayText || "").trim());
  const fallbackFromSources =
    !hasAnyAnswerText && Array.isArray(webItems) && webItems.length > 0
      ? webItems
          .slice(0, 4)
          .map((item) => {
            const line =
              item.summaryLines?.find((l) => l && l.trim().length > 0) || "";
            return line;
          })
          .filter(Boolean)
          .join("\n")
      : "";
  const fullAnswerText =
    (displayText || "").trim() ||
    overallSummaryLines.filter(Boolean).join("\n").trim() ||
    (fallbackFromSources || "").trim();
  const answerParts = (() => {
    const raw = String(fullAnswerText || "").trim();
    if (!raw) return { top: "", bottom: "" };
    const paragraphs = raw.split(/\n\s*\n/).filter(Boolean);
    if (paragraphs.length >= 2) {
      return { top: paragraphs[0], bottom: paragraphs.slice(1).join("\n\n") };
    }
    const words = raw.split(/\s+/).filter(Boolean);
    if (words.length <= 1) return { top: raw, bottom: raw };
    const splitIndex = Math.ceil(words.length / 2);
    return {
      top: words.slice(0, splitIndex).join(" "),
      bottom: words.slice(splitIndex).join(" "),
    };
  })();

  const chatMediaItems = mediaItems
    .map((item) => ({ ...item, src: normalizeExternalUrl(item.src) }))
    .filter((item) => Boolean(item.src)) as Array<{
      src: string;
      alt?: string;
    }>;
  const chatMediaItemsLimited = chatMediaItems.slice(0, 5);

  const [mediaIndex, setMediaIndex] = useState(0);
  const [shoppingIndex, setShoppingIndex] = useState(0);
  const shoppingTouchStartXRef = useRef<number | null>(null);
  const mediaTouchStartXRef = useRef<number | null>(null);

  const handleMediaPrev = () => {
    if (!chatMediaItemsLimited.length) return;
    setMediaIndex((prev) =>
      prev === 0 ? chatMediaItemsLimited.length - 1 : prev - 1
    );
  };

  const handleMediaNext = () => {
    if (!chatMediaItemsLimited.length) return;
    setMediaIndex((prev) =>
      prev === chatMediaItemsLimited.length - 1 ? 0 : prev + 1
    );
  };

  const handleMediaTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    mediaTouchStartXRef.current = touch.clientX;
  };

  const handleMediaTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (mediaTouchStartXRef.current == null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - mediaTouchStartXRef.current;
    mediaTouchStartXRef.current = null;
    const threshold = 40;
    if (Math.abs(dx) < threshold) return;
    if (dx < 0) {
      handleMediaNext();
    } else {
      handleMediaPrev();
    }
  };

  const shoppingItemsLimited = Array.isArray(shoppingItems)
    ? shoppingItems.slice(0, 10)
    : [];
  const scrapedItemsLimited = Array.isArray(scrapedItems)
    ? scrapedItems.slice(0, 2)
    : [];

  const handleShoppingPrev = () => {
    if (!shoppingItemsLimited.length) return;
    setShoppingIndex((prev) =>
      prev === 0 ? shoppingItemsLimited.length - 1 : prev - 1
    );
  };

  const handleShoppingNext = () => {
    if (!shoppingItemsLimited.length) return;
    setShoppingIndex((prev) =>
      prev === shoppingItemsLimited.length - 1 ? 0 : prev + 1
    );
  };

  const handleShoppingTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    const touch = e.touches[0];
    shoppingTouchStartXRef.current = touch.clientX;
  };

  const handleShoppingTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (shoppingTouchStartXRef.current == null) return;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - shoppingTouchStartXRef.current;
    shoppingTouchStartXRef.current = null;
    const threshold = 40;
    if (Math.abs(dx) < threshold) return;
    if (dx < 0) {
      handleShoppingNext();
    } else {
      handleShoppingPrev();
    }
  };

  const renderSummaryWithCitations = (text: string) => {
    const raw = String(text || "").trim();
    if (!raw) return null;

    const angleRegex = /<\s*(https?:\/\/[^\s<>|]+)(?:\|[^>]+)?>/g;
    const parenRegex = /\(\s*(https?:\/\/[^\s()]+)\s*\)/g;
    const value = raw.replace(angleRegex, "$1").replace(parenRegex, "$1");

    const sources = webItems.slice(0, 4).map((item) => ({
      title: item.title,
      url: item.link,
      description:
        item.summaryLines.find((l) => l && l.trim().length > 0) || "",
    }));

    if (!sources.length) {
      return (
        <Response className="text-sm leading-relaxed" parseIncompleteMarkdown>
          {value}
        </Response>
      );
    }

    const triggerSources = sources.map((s) => {
      try {
        const u = new URL(s.url);
        return u.hostname.replace(/^www\./i, "");
      } catch {
        return s.url;
      }
    });

    return (
      <InlineCitation>
        <div
          className={cn(
            "rounded px-0.5 transition-colors",
            citationActive && "bg-sky-100 dark:bg-sky-900/40"
          )}
        >
          <Response className="text-sm leading-relaxed" parseIncompleteMarkdown>
            {value}
          </Response>
        </div>
        <InlineCitationCard open={citationActive}>
          <InlineCitationCardTrigger
            sources={triggerSources}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setCitationActive((prev) => !prev);
            }}
          />
          <InlineCitationCardBody>
            <InlineCitationCarousel>
              <InlineCitationCarouselHeader>
                <InlineCitationCarouselPrev />
                <InlineCitationCarouselNext />
                <InlineCitationCarouselIndex />
              </InlineCitationCarouselHeader>
              <InlineCitationCarouselContent>
                {sources.map((source) => (
                  <InlineCitationCarouselItem key={source.url}>
                    <InlineCitationSource
                      title={source.title}
                      url={source.url}
                      description={source.description}
                    />
                  </InlineCitationCarouselItem>
                ))}
              </InlineCitationCarouselContent>
            </InlineCitationCarousel>
          </InlineCitationCardBody>
        </InlineCitationCard>
      </InlineCitation>
    );
  };

  return (
    <div className="w-full space-y-4 pr-3">
      {/* Image lightbox for inline media */}
      {lightboxIndex !== null && chatMediaItemsLimited[lightboxIndex] && (
            <div
              className="fixed inset-0 z-[70] bg-black/90 flex items-center justify-center"
              onClick={() => setLightboxIndex(null)}
            >
              <button
                type="button"
                onClick={() => setLightboxIndex(null)}
                className="absolute top-6 right-6 text-white/80 hover:text-white"
              >
                <X className="w-6 h-6" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => {
                    if (prev === null || chatMediaItemsLimited.length === 0)
                      return prev;
                    return (
                      (prev - 1 + chatMediaItemsLimited.length) %
                      chatMediaItemsLimited.length
                    );
                  });
                }}
                className="absolute left-6 text-white/80 hover:text-white"
              >
                <ChevronLeft className="w-8 h-8" />
              </button>
              <div
                className="max-w-5xl w-full px-10"
                onClick={(e) => e.stopPropagation()}
              >
                <img
                  src={chatMediaItemsLimited[lightboxIndex].src}
                  alt={chatMediaItemsLimited[lightboxIndex].alt ?? ""}
                  referrerPolicy="no-referrer"
                  className="w-full max-h-[80vh] object-contain rounded-lg"
                />
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setLightboxIndex((prev) => {
                    if (prev === null || chatMediaItemsLimited.length === 0)
                      return prev;
                    return (prev + 1) % chatMediaItemsLimited.length;
                  });
                }}
                className="absolute right-6 text-white/80 hover:text-white"
              >
                <ChevronRight className="w-8 h-8" />
              </button>
            </div>
          )}

      {/* Response (top) */}
      <div className="space-y-3">
        {fullAnswerText ? (
          <div className="text-sm">
            {renderSummaryWithCitations(
              summaryIsStreaming ? fullAnswerText : answerParts.top
            )}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            {summaryIsStreaming ? "Thinking!!" : "No results found."}
          </div>
        )}
      </div>

      {chatMediaItemsLimited.length > 0 && (
        <div className="w-full">
          <div className="relative w-full">
            <div
              className="aspect-video bg-accent rounded-md border overflow-hidden flex items-center justify-center"
              onTouchStart={handleMediaTouchStart}
              onTouchEnd={handleMediaTouchEnd}
              onClick={() => setLightboxIndex(mediaIndex)}
            >
              {chatMediaItemsLimited[mediaIndex] && (
                <img
                  src={chatMediaItemsLimited[mediaIndex].src}
                  alt={chatMediaItemsLimited[mediaIndex].alt ?? ""}
                  loading="eager"
                  referrerPolicy="no-referrer"
                  className="w-full h-full object-cover"
                  onLoad={onMediaLoad}
                  onError={onMediaLoad}
                />
              )}
              {chatMediaItemsLimited.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMediaPrev();
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleMediaNext();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Response (bottom) */}
      {!summaryIsStreaming && answerParts.bottom && (
        <div className="space-y-3">
          <div className="text-sm">
            {renderSummaryWithCitations(answerParts.bottom)}
          </div>
        </div>
      )}

      {scrapedItemsLimited.length > 0 && (
        <div className="w-full space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            Site-wise details
          </div>
          {scrapedItemsLimited.map((item, idx) => {
            const url = item.url;
            const display = formatDisplayUrl(url);
            return (
              <div
                key={`${url}:${idx}`}
                className="rounded-lg border border-border/60 bg-background/70 px-4 py-3"
              >
                <button
                  type="button"
                  className="text-xs font-medium text-primary underline break-words"
                  onClick={() => onLinkClick?.(url, display)}
                >
                  {display}
                </button>
                <div className="mt-1 text-sm">
                  <Response parseIncompleteMarkdown>{item.summary}</Response>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Videos (if any) */}
      {youtubeItems && youtubeItems.length > 0 && (
        <div className="w-full pr-3">
          <VideoList
            videos={youtubeItems}
            onLinkClick={onLinkClick}
            onPinItem={onPinItem}
            pinnedIds={pinnedIds}
          />
        </div>
      )}

      {/* Shopping products */}
      {shoppingItemsLimited.length > 0 && (
        <div className="w-full space-y-3 pr-3">
          <div className="relative w-full">
            <div
              className="rounded-lg border bg-accent/40 hover:bg-accent transition-colors p-3 text-left overflow-hidden"
              onTouchStart={handleShoppingTouchStart}
              onTouchEnd={handleShoppingTouchEnd}
            >
              {shoppingItemsLimited[shoppingIndex] && (() => {
                const item = shoppingItemsLimited[shoppingIndex];
                const src = normalizeExternalUrl(item.thumbnailUrl);
                return (
                  <a
                    href={item.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex gap-3"
                  >
                    {src && (
                      <div className="relative h-20 w-20 shrink-0 rounded-md overflow-hidden bg-background/40">
                        <Image
                          src={src}
                          alt={item.title}
                          fill
                          className="object-contain"
                          sizes="80px"
                          loading="lazy"
                          unoptimized
                          referrerPolicy="no-referrer"
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="text-sm font-medium leading-snug line-clamp-2 break-words">
                        {item.title}
                      </div>
                      {item.descriptionSnippet && (
                        <div className="text-xs text-muted-foreground line-clamp-2 break-words">
                          {item.descriptionSnippet}
                        </div>
                      )}
                      <div className="flex items-center gap-2 flex-wrap">
                        {item.priceText && (
                          <div className="text-sm font-semibold">
                            {item.priceText}
                          </div>
                        )}
                        {(item.rating != null || item.reviewCount != null) && (
                          <div className="text-xs text-muted-foreground">
                            {item.rating != null && (
                              <span>{item.rating.toFixed(1)}</span>
                            )}
                            {item.rating != null && item.reviewCount != null && (
                              <span> • </span>
                            )}
                            {item.reviewCount != null && (
                              <span>
                                {item.reviewCount.toLocaleString()} reviews
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      {item.source && (
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                          {item.sourceIconUrl &&
                            normalizeExternalUrl(item.sourceIconUrl) && (
                              <span className="relative h-4 w-4 overflow-hidden rounded-full bg-background/60">
                                <Image
                                  src={normalizeExternalUrl(item.sourceIconUrl)!}
                                  alt={item.source}
                                  fill
                                  className="object-contain"
                                  sizes="16px"
                                  loading="lazy"
                                  unoptimized
                                  referrerPolicy="no-referrer"
                                />
                              </span>
                            )}
                          <span className="truncate">{item.source}</span>
                        </div>
                      )}
                    </div>
                  </a>
                );
              })()}

              {shoppingItemsLimited.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShoppingPrev();
                    }}
                    className="absolute left-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1"
                    aria-label="Previous product"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShoppingNext();
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 bg-black/60 text-white rounded-full p-1"
                    aria-label="Next product"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>
            {shoppingItemsLimited.length > 1 && (
              <div className="mt-2 text-xs text-muted-foreground text-center tabular-nums">
                {shoppingIndex + 1}/{shoppingItemsLimited.length}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Weather widgets */}
      {weatherItems && weatherItems.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {weatherItems.map((w, i) => (
              <div key={i} className="flex justify-center">
                <WeatherWidget
                  width="100%"
                  className="w-full"
                  location={
                    w.latitude && w.longitude
                      ? { latitude: w.latitude, longitude: w.longitude }
                      : undefined
                  }
                  onFetchWeather={async () => {
                    if (w.data) return w.data;
                    throw new Error(w.error || "Weather unavailable");
                  }}
                  onError={() => {}}
                  onWeatherLoaded={() => {}}
                />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Web result cards are not shown in inline search; sources are surfaced via InlineCitation.
          If there is no summary, weather, or other content, show a fallback message. */}
      {!webItems.length &&
        !weatherItems?.length &&
        !hasAnyAnswerText &&
        !summaryIsStreaming && (
          <div className="text-sm text-muted-foreground">No results found.</div>
        )}
    </div>
  );
}
