import Image from "next/image";
import { cn } from "@/lib/cn";

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
  return (
    <Image
      src={src}
      alt={alt}
      fill
      unoptimized
      sizes={sizes}
      priority={priority}
      className={cn("object-cover", className)}
    />
  );
}
