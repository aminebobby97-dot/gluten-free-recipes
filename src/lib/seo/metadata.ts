// Builders for Next.js Metadata objects (titles, canonicals, Open Graph, Twitter).

import type { Metadata } from "next";
import { absoluteUrl, siteConfig } from "@/lib/env";
import { truncate } from "@/lib/recipes/format";
import type { Category, RecipeWithCategory } from "@/lib/recipes/types";

export function pageMetadata({
  title,
  description,
  path,
  image,
  imageAlt,
  type = "website",
  noindex = false,
}: {
  title: string;
  description: string;
  path: string;
  image?: string | null;
  imageAlt?: string | null;
  type?: "website" | "article";
  noindex?: boolean;
}): Metadata {
  const url = absoluteUrl(path);
  const images = image ? [{ url: absoluteUrl(image), alt: imageAlt ?? title }] : undefined;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { type, url, title, description, siteName: siteConfig.name, locale: siteConfig.locale, images },
    twitter: { card: images ? "summary_large_image" : "summary", title, description, images: images?.map((i) => i.url) },
    robots: noindex ? { index: false, follow: true } : undefined,
  };
}

export function recipeMetadata(recipe: RecipeWithCategory): Metadata {
  const title = recipe.seo_title || recipe.title;
  const description = truncate(recipe.seo_description || recipe.description, 160);
  const base = pageMetadata({
    title,
    description,
    path: `/recipes/${recipe.slug}`,
    image: recipe.featured_image,
    imageAlt: recipe.featured_image_alt,
    type: "article",
  });
  return {
    ...base,
    keywords: recipe.focus_keyword ? [recipe.focus_keyword] : undefined,
    openGraph: {
      ...base.openGraph,
      type: "article",
      publishedTime: recipe.published_at ?? undefined,
      modifiedTime: recipe.updated_at,
      section: recipe.category?.name,
    },
    other: recipe.pinterest_image ? { "pinterest-rich-pin": "true" } : undefined,
  };
}

export function categoryMetadata(category: Category, page: number): Metadata {
  const baseTitle = category.seo_title || `${category.name} Recipes`;
  const title = page > 1 ? `${baseTitle} (Page ${page})` : baseTitle;
  const description = truncate(category.seo_description || category.description, 160);
  const path = page > 1 ? `/categories/${category.slug}/page/${page}` : `/categories/${category.slug}`;
  return pageMetadata({ title, description, path, image: category.image_url, imageAlt: category.image_alt });
}
