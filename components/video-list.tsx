"use client";

import { useState } from "react";
import Image from "next/image";
import { PlayIcon } from "lucide-react";
import { YouTubeVideo } from "@/app/lib/ai/youtube";
import type { PinnedItem } from "@/app/lib/chat-store";

type VideoListProps = {
  videos: YouTubeVideo[];
  onLinkClick?: (url: string, title: string) => void;
  onPinItem?: (item: PinnedItem) => void;
  pinnedIds?: string[];
  searchQuery?: string;
};

export function VideoList({ videos, onLinkClick, onPinItem, pinnedIds, searchQuery }: VideoListProps) {
  const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {videos.map((video) => (
        <div
          key={video.id}
          className="group rounded-2xl bg-muted/40 border border-border/70 overflow-hidden"
          data-cloudy-kind="youtube"
          data-cloudy-link={`https://www.youtube.com/watch?v=${video.id}`}
          data-cloudy-title={video.title}
          data-cloudy-summary={video.description}
          data-cloudy-search-query={searchQuery || ""}
        >
          <div
            className="relative w-full aspect-video bg-black overflow-hidden cursor-pointer shadow-sm hover:shadow-md transition-shadow"
            onClick={() =>
              setPlayingVideoId((current) =>
                current === video.id ? null : video.id
              )
            }
            onMouseEnter={() => {
              setPlayingVideoId(video.id);
            }}
          >
            {playingVideoId === video.id ? (
              <iframe
                width="100%"
                height="100%"
                src={`https://www.youtube.com/embed/${video.id}?autoplay=1`}
                title={video.title}
                frameBorder="0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 w-full h-full"
              />
            ) : (
              <>
                <Image
                  src={video.thumbnail}
                  alt={video.title}
                  fill
                  className="object-cover"
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover:bg-black/30 transition-colors">
                  <div className="w-16 h-16 bg-red-600 rounded-full flex items-center justify-center shadow-lg transition-transform group-hover:scale-110">
                    <PlayIcon className="w-8 h-8 text-white fill-current" />
                  </div>
                </div>
              </>
            )}
          </div>
          <div className="px-6 py-4 flex items-center gap-4">
            <div className="relative h-32 w-32 pb-1">
              <Image
                src="/yt.png"
                alt="YouTube"
                fill
                className="object-contain"
                sizes="300px"
              />
            </div>
            <div className="flex flex-col min-w-0">
              <span className="font-medium text-foreground text-base sm:text-lg leading-tight line-clamp-2">
                {video.title}
              </span>
              <span className="mt-1 text-xs sm:text-sm text-muted-foreground truncate">
                {video.channelTitle} ·{" "}
                {new Date(video.publishedAt).toLocaleDateString(undefined, {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
