import { permanentRedirect } from "next/navigation";

// There is no separate categories index; the recipes page lists every category.
export default function CategoriesIndex() {
  permanentRedirect("/recipes");
}
