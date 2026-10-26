// Shapes of the JSON columns on public.recipes plus the row types used by the app.

export type RecipeStatus = "draft" | "in_review" | "published" | "archived";

export interface Ingredient {
  /** Optional sub-heading, e.g. "For the sauce". */
  group?: string;
  /** Exact US measurement amount, e.g. "1 1/2". Empty for "to taste" items. */
  amount: string;
  /** Unit, e.g. "cups", "tbsp". Empty for countable items like "2 eggs". */
  unit?: string;
  /** Ingredient name, e.g. "gluten-free all-purpose flour blend". */
  name: string;
  /** Preparation or buying note, e.g. "with xanthan gum". */
  note?: string;
  /** Optional metric equivalent, e.g. "180 g". */
  metric?: string;
}

export interface InstructionStep {
  group?: string;
  text: string;
}

export interface Substitution {
  original: string;
  substitute: string;
  note?: string;
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface Nutrition {
  /** What the values describe, e.g. "1 pancake" or "1 serving". */
  per: string;
  calories?: number;
  protein_g?: number;
  carbohydrates_g?: number;
  fat_g?: number;
  saturated_fat_g?: number;
  fiber_g?: number;
  sugar_g?: number;
  sodium_mg?: number;
  /** True when values were calculated from ingredient data rather than lab tested. */
  is_estimate: boolean;
  /** How the values were obtained, e.g. "Calculated with USDA FoodData Central". */
  method?: string;
}

export interface Category {
  id: string;
  name: string;
  short_name: string;
  slug: string;
  description: string;
  introduction: string;
  seo_title: string | null;
  seo_description: string | null;
  image_url: string | null;
  image_alt: string | null;
  sort_order: number;
  updated_at: string;
}

export interface Recipe {
  id: string;
  title: string;
  slug: string;
  description: string;
  introduction: string;
  category_id: string | null;
  ingredients: Ingredient[];
  instructions: InstructionStep[];
  prep_time: number | null;
  cook_time: number | null;
  servings: number | null;
  yield_description: string | null;
  nutrition: Nutrition | null;
  tips: string[];
  substitutions: Substitution[];
  storage_instructions: string;
  faq: FaqItem[];
  featured_image: string | null;
  featured_image_alt: string | null;
  pinterest_image: string | null;
  pinterest_image_alt: string | null;
  seo_title: string | null;
  seo_description: string | null;
  focus_keyword: string | null;
  is_tested: boolean;
  status: RecipeStatus;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RecipeWithCategory extends Recipe {
  category: Pick<Category, "id" | "name" | "short_name" | "slug"> | null;
}

/** The subset of a recipe needed to render a card. */
export interface RecipeCardData {
  id: string;
  title: string;
  slug: string;
  description: string;
  prep_time: number | null;
  cook_time: number | null;
  featured_image: string | null;
  featured_image_alt: string | null;
  published_at: string | null;
  category: Pick<Category, "name" | "short_name" | "slug"> | null;
}

/** Fields an editor (or future automation) supplies when creating or updating a recipe. */
export type RecipeInput = Omit<
  Recipe,
  "id" | "status" | "published_at" | "created_at" | "updated_at"
>;
