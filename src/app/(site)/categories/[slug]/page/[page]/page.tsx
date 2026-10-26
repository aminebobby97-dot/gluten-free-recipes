import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CategoryPageBody } from "@/components/recipe/category-page";
import { featuredCategories } from "@/content/site";
import { getCategoryBySlug } from "@/lib/data/public";
import { parsePageParam } from "@/lib/pagination";
import { categoryMetadata } from "@/lib/seo/metadata";

export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return featuredCategories.map((c) => ({ slug: c.slug, page: "2" }));
}

export async function generateMetadata({ params }: PageProps<"/categories/[slug]/page/[page]">): Promise<Metadata> {
  const { slug, page: raw } = await params;
  const page = parsePageParam(raw);
  const category = page ? await getCategoryBySlug(slug) : null;
  return category && page ? categoryMetadata(category, page) : {};
}

export default async function CategoryPaginatedPage({ params }: PageProps<"/categories/[slug]/page/[page]">) {
  const { slug, page: raw } = await params;
  const page = parsePageParam(raw);
  if (!page) notFound();
  return <CategoryPageBody slug={slug} page={page} />;
}
