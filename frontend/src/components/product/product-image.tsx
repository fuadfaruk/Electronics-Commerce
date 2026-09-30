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
 * When real product photography replaces the placeholders, drop `unoptimized`.
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
