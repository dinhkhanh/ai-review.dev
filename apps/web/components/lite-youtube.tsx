"use client";

import { useState } from "react";

/**
 * Click-to-load YouTube embed (FR-VID-4, FR-WEB-3): only a thumbnail until the visitor asks for
 * the player, so the page's LCP and JS budget are unaffected. Without JS the link opens YouTube.
 */
export function LiteYouTube({
  youtubeId,
  title,
  thumbnailUrl,
  watchUrl,
  vertical,
}: {
  youtubeId: string;
  title: string;
  thumbnailUrl: string;
  watchUrl: string;
  vertical: boolean;
}) {
  const [playing, setPlaying] = useState(false);
  const frame = vertical ? "aspect-[9/16] max-w-xs" : "aspect-video w-full";
  if (playing) {
    return (
      <iframe
        className={`${frame} rounded-lg`}
        src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(youtubeId)}?autoplay=1&rel=0`}
        title={title}
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowFullScreen
      />
    );
  }
  return (
    <a
      href={watchUrl}
      onClick={(e) => {
        e.preventDefault();
        setPlaying(true);
      }}
      className={`group relative block overflow-hidden rounded-lg bg-black ${frame}`}
      aria-label={`Play video: ${title}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- remote thumbnail, lazy, no layout shift (fixed aspect) */}
      <img src={thumbnailUrl} alt="" loading="lazy" className="h-full w-full object-cover opacity-90" />
      <span className="absolute inset-0 flex items-center justify-center">
        <span className="flex h-14 w-20 items-center justify-center rounded-xl bg-red-600 text-white shadow-lg group-hover:bg-red-700">
          <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        </span>
      </span>
    </a>
  );
}
