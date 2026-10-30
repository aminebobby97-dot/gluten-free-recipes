import { InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/env";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "Editorial Policy",
  description: `How ${siteConfig.name} develops, reviews, labels and corrects its gluten-free recipes.`,
  path: "/editorial-policy",
});

export default function EditorialPolicyPage() {
  return (
    <InfoPage title="Editorial Policy" path="/editorial-policy">
      <p>
        We want every recipe on {siteConfig.name} to be useful, accurate and honest. This page explains how recipes are
        created, what our labels mean and how we handle corrections.
      </p>
      <h2>How recipes are created</h2>
      <p>
        Recipes are based on established gluten-free cooking and baking techniques. Many are written by AI: a large
        language model drafts the recipe from a search topic we choose, and software checks it before it can appear on the
        site.
      </p>
      <h2>Automated quality checks</h2>
      <p>Before an AI-written recipe is published, it must pass every one of these checks:</p>
      <ul>
        <li>
          Gluten: no wheat, barley, rye or other gluten-containing ingredients, and a note to choose products labeled
          gluten-free wherever an ingredient often hides gluten or picks it up through cross-contact.
        </li>
        <li>Allergens: the major allergens in the ingredient list are declared.</li>
        <li>
          Consistency: every ingredient is used in the steps, the times add up, and oven and food-safety temperatures are
          in a sensible range.
        </li>
        <li>Duplicates: it is not a copy of, or too close to, a recipe already on the site.</li>
        <li>
          An independent review by a second AI model, which reads the recipe as an editor would and looks for errors in
          ingredients, quantities, temperatures and food-safety steps.
        </li>
      </ul>
      <p>
        A recipe that fails any check is not published. A person reviewed and approved the first AI-written recipes on
        this site before they were published. Since then, AI-written recipes that pass every check are published
        automatically, without a person reading each one first. We read published recipes and correct them when we find
        or are told about a problem.
      </p>
      <h2>Photos</h2>
      <p>
        Some recipe photos are generated with AI to show what the finished dish looks like. These are labeled{" "}
        <em>AI-generated image</em> below the photo. They are checked to make sure they show the recipe and no
        gluten-containing foods that are not part of it, but your result may look different.
      </p>
      <h2>Allergens</h2>
      <p>
        Where a recipe lists the major food allergens it contains, that list is based on the ingredients as written. Brands
        differ, so always check the labels of the products you use.
      </p>
      <h2>Testing</h2>
      <p>
        We do not claim a recipe has been cooked and confirmed in a kitchen unless that is true, and results may vary.
        We never describe personal testing experiences, taste tests or family reactions that did not happen.
      </p>
      <h2>Gluten-free standards</h2>
      <ul>
        <li>We do not use wheat, barley, rye or other gluten-containing ingredients.</li>
        <li>
          Ingredients that are often contaminated or may contain hidden gluten, such as oats, broth, sauces and seasoning
          blends, are flagged so you can choose products labeled gluten-free.
        </li>
        <li>We include practical guidance on avoiding cross-contact.</li>
        <li>We never claim a recipe is medically safe for everyone with celiac disease.</li>
      </ul>
      <h2>Nutrition information</h2>
      <p>
        When nutrition information is shown, it is an estimate calculated from ingredient data and labeled as such. It is
        omitted when we do not have a reliable estimate.
      </p>
      <h2>Ratings and reviews</h2>
      <p>We do not display star ratings, review counts or popularity figures that are not based on real data.</p>
      <h2>Corrections</h2>
      <p>
        If you find an error, please contact us. We review every report and update the recipe, noting the date it was
        updated.
      </p>
    </InfoPage>
  );
}
