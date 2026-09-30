"use client";

import { useRef, useState } from "react";
import { ProductImage } from "@/components/product/product-image";
import { cn } from "@/lib/cn";

/**
 * Product gallery.
 *
 * The main area is a native scroll-snap strip, so swiping works the way a phone
 * user expects without any gesture library; the active index is derived from
 * the scroll position. Thumbnails only appear when there is more than one
 * image, so a single-image product does not get a meaningless rail.
 */
export function ProductGallery({
  images,
  name,
}: {
  images: string[];
  name: string;
}) {
  const [active, setActive] = useState(0);
  const stripRef = useRef<HTMLUListElement>(null);

  const slides = images.length > 0 ? images : [""];

  const handleScroll = () => {
    const strip = stripRef.current;
    if (!strip) return;
    const width = strip.clientWidth;
    if (!width) return;
    setActive(Math.round(strip.scrollLeft / width));
  };

  const showThumbnails = slides.length > 1;

  return (
    <div className="space-y-3">
      <ul
        ref={stripRef}
        onScroll={handleScroll}
        className="no-scrollbar flex snap-x snap-mandatory overflow-x-auto rounded-2xl border border-border bg-surface"
      >
        {slides.map((src, index) => (
          <li
            key={`${src}-${index}`}
            className="relative aspect-square w-full shrink-0 snap-center"
            aria-hidden={index !== active}
          >
            <ProductImage
              src={src}
              alt={index === 0 ? name : `${name} — view ${index + 1}`}
              priority={index === 0}
              sizes="(min-width: 1024px) 560px, 92vw"
            />
          </li>
        ))}
      </ul>

      {showThumbnails ? (
        <ul
          className="no-scrollbar flex gap-2 overflow-x-auto"
          aria-label="Product images"
        >
          {slides.map((src, index) => (
            <li key={`thumb-${src}-${index}`}>
              <button
                type="button"
                onClick={() => {
                  const strip = stripRef.current;
                  if (!strip) return;
                  strip.scrollTo({
                    left: strip.clientWidth * index,
                    behavior: "smooth",
                  });
                  setActive(index);
                }}
                aria-label={`Show image ${index + 1} of ${slides.length}`}
                aria-current={index === active}
                className={cn(
                  "relative block size-16 overflow-hidden rounded-xl border bg-surface",
                  index === active
                    ? "border-brand ring-1 ring-brand"
                    : "border-border",
                )}
              >
                <ProductImage src={src} alt="" sizes="64px" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
