import { InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/env";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "Recipe Disclaimer",
  description: `Important information about gluten, allergens, nutrition estimates and food safety for recipes on ${siteConfig.name}.`,
  path: "/recipe-disclaimer",
});

export default function RecipeDisclaimerPage() {
  return (
    <InfoPage title="Recipe Disclaimer" path="/recipe-disclaimer">
      <p>
        The recipes on {siteConfig.name} are written to be gluten-free, but please read the following before you cook.
      </p>
      <h2>Not medical advice</h2>
      <p>
        Our content is for general information only and is not medical, nutritional or dietary advice. We cannot guarantee
        that any recipe is safe for everyone with celiac disease, non-celiac gluten sensitivity, wheat allergy or other
        food allergies. Always follow the advice of your doctor or a registered dietitian.
      </p>
      <h2>Check every label</h2>
      <p>
        Product formulations change, and the same product can be gluten-free in one country and not in another. Always
        read ingredient labels and choose products that are certified or clearly labeled gluten-free, especially oats,
        flour blends, broth, sauces, seasonings, chocolate and processed foods.
      </p>
      <h2>Cross-contact</h2>
      <p>
        Gluten can transfer from shared toasters, cutting boards, colanders, flour dust and cooking oil. We include
        guidance on avoiding cross-contact, but we cannot control the conditions in your kitchen.
      </p>
      <h2>Allergens</h2>
      <p>
        Recipes may contain eggs, dairy, nuts, soy or other common allergens. Review each ingredient list for your own
        needs.
      </p>
      <h2>Nutrition estimates and results</h2>
      <p>
        Nutrition values are estimates and will vary with the brands and amounts you use. Cooking times and results can
        vary with equipment, altitude and ingredients. Recipes labeled <em>Not yet kitchen-tested</em> have not been cooked
        and confirmed by us.
      </p>
      <h2>Food safety</h2>
      <p>
        Follow safe food handling practices, and cook meat, poultry, seafood and eggs to the internal temperatures
        recommended by the USDA.
      </p>
    </InfoPage>
  );
}
