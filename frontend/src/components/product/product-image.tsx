"use client";

import Image from "next/image";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { FALLBACK_IMAGE, isHttpsImage, isLocalArtwork } from "@/lib/catalog/visuals";

/**
 * Product imagery wrapper.
 *
 * The mock catalog uses local SVG placeholders. Next's image optimiser refuses
 * to serve SVG unless `images.dangerouslyAllowSVG` is switched on globally, and
 * these are our own static files, so this one component opts out of
 * optimisation instead of weakening the site-wide config.
 *
 * The API can return absolute image URLs too. They stay `unoptimized` so no
 * `remotePatterns` allow-list is needed; add one and drop it if you want Next
 * to optimise real photography later.
 */
export function ProductImage({
  src,
  alt,
  sizes,
  priority = false,
  className,
}: {
  src: string;
  alt: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const safeSource = (isHttpsImage(src) || isLocalArtwork(src)) && failedSource !== src ? src : FALLBACK_IMAGE;
  return (
    <Image
      src={safeSource}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      onError={() => setFailedSource(src)}
      referrerPolicy="no-referrer"
      className={cn("object-cover", className)}
    />
  );
}
