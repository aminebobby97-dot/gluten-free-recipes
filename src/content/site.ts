// Editorial settings that are not stored in the database.

/** Main navigation. Slugs match the categories created by the migrations. */
export const primaryNav = [
  { label: "Recipes", href: "/recipes" },
  { label: "Breakfast", href: "/categories/gluten-free-breakfast" },
  { label: "Lunch", href: "/categories/gluten-free-lunch" },
  { label: "Dinner", href: "/categories/gluten-free-dinner" },
  { label: "Desserts", href: "/categories/gluten-free-desserts" },
] as const;

export const footerNav = [
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "Privacy Policy", href: "/privacy-policy" },
  { label: "Editorial Policy", href: "/editorial-policy" },
  { label: "Recipe Disclaimer", href: "/recipe-disclaimer" },
] as const;

/**
 * Social share image for the homepage metadata (Open Graph / Twitter). The
 * photo shown in the homepage hero itself is src/content/images/hero-bowl.webp.
 */
export const heroImage: { src: string | null; alt: string } = {
  src: null,
  alt: "A spread of gluten-free breakfast dishes on a linen tablecloth",
};

/** Categories shown as cards on the homepage, in display order. */
export const featuredCategories = [
  { slug: "gluten-free-breakfast", label: "Breakfast" },
  { slug: "gluten-free-lunch", label: "Lunch" },
  { slug: "gluten-free-dinner", label: "Dinner" },
  { slug: "gluten-free-desserts", label: "Desserts" },
  { slug: "gluten-free-baking", label: "Baking" },
  { slug: "gluten-free-snacks", label: "Snacks" },
  { slug: "gluten-free-dairy-free", label: "Dairy-Free" },
  { slug: "high-protein-gluten-free", label: "High-Protein" },
] as const;
