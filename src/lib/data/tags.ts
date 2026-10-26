// Cache tags shared by the cached public queries and the publishing services.

export const CACHE_TAGS = {
  recipes: "recipes",
  categories: "categories",
  views: "recipe-views",
  recipe: (slug: string) => `recipe:${slug}`,
} as const;
