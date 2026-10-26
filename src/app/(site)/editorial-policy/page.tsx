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
        Recipes are based on established gluten-free cooking and baking techniques. Some are drafted with the help of
        software, including AI writing tools. Every recipe is reviewed by a person before it is published, with particular
        attention to ingredients, measurements, temperatures and food-safety steps.
      </p>
      <h2>Testing labels</h2>
      <p>
        If a recipe has not yet been cooked and confirmed in a kitchen, it carries a <em>Not yet kitchen-tested</em> label.
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
