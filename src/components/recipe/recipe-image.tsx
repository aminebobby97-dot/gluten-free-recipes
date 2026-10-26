import Image from "next/image";
import { CategoryGlyph } from "@/components/icons";

interface RecipeImageProps {
  src: string | null;
  alt: string | null;
  categorySlug?: string | null;
  sizes: string;
  priority?: boolean;
  className?: string;
}

/**
 * Optimized recipe photo. When no photo has been uploaded yet, renders a quiet
 * illustrated placeholder rather than a stock or generated image.
 */
export function RecipeImage({ src, alt, categorySlug, sizes, priority, className = "" }: RecipeImageProps) {
  if (!src) {
    return (
      <div
        className={`flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#f4f1e8,#e9eee6)] text-sage-light ${className}`}
        role="img"
        aria-label={alt ? `${alt} (photo coming soon)` : "Photo coming soon"}
      >
        <CategoryGlyph slug={categorySlug} size={64} />
      </div>
    );
  }
  return (
    <Image
      src={src}
      alt={alt ?? ""}
      fill
      sizes={sizes}
      priority={priority}
      className={`object-cover ${className}`}
    />
  );
}
