import type { Metadata } from "next";
import { CategoryPageBody } from "@/components/recipe/category-page";
import { featuredCategories } from "@/content/site";
import { getCategoryBySlug } from "@/lib/data/public";
import { categoryMetadata } from "@/lib/seo/metadata";

export const ensureStatic = "navigation";

export async function generateStaticParams() {
  return featuredCategories.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/categories/[slug]">): Promise<Metadata> {
  const category = await getCategoryBySlug((await params).slug);
  return category ? categoryMetadata(category, 1) : {};
}

export default async function CategoryPage({ params }: PageProps<"/categories/[slug]">) {
  const { slug } = await params;
  return <CategoryPageBody slug={slug} page={1} />;
}
