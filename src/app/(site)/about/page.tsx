import Link from "next/link";
import { InfoPage } from "@/components/site/info-page";
import { siteConfig } from "@/lib/env";
import { pageMetadata } from "@/lib/seo/metadata";

export const metadata = pageMetadata({
  title: "About",
  description: `About ${siteConfig.name}, a recipe website dedicated to easy, flavorful gluten-free cooking.`,
  path: "/about",
});

export default function AboutPage() {
  return (
    <InfoPage title={`About ${siteConfig.name}`} path="/about">
      <p>
        {siteConfig.name} is a recipe website dedicated entirely to gluten-free cooking. We publish easy, flavorful recipes
        for everyday meals, from weekday breakfasts to weekend baking, written for home cooks in the United States.
      </p>
      <h2>What you will find here</h2>
      <ul>
        <li>Recipes that avoid wheat, barley, rye and other gluten-containing ingredients.</li>
        <li>Exact measurements, clear step-by-step instructions and practical tips.</li>
        <li>Notes on ingredients that need a gluten-free label, such as oats, broth and sauces.</li>
        <li>Guidance on avoiding cross-contact in a shared kitchen.</li>
      </ul>
      <h2>How our recipes are made</h2>
      <p>
        Some recipes on this site are developed with the help of software tools and then reviewed by a person before
        publication. A recipe that has not yet been cooked and confirmed in a kitchen is clearly labeled{" "}
        <em>Not yet kitchen-tested</em>. Nutrition information, when shown, is always an estimate. You can read more in our{" "}
        <Link href="/editorial-policy">editorial policy</Link>.
      </p>
      <h2>An important note</h2>
      <p>
        We are not medical professionals, and our recipes are not medical advice. If you have celiac disease, a wheat
        allergy or another medical condition, please follow the guidance of your doctor or a registered dietitian. See our{" "}
        <Link href="/recipe-disclaimer">recipe disclaimer</Link>.
      </p>
    </InfoPage>
  );
}
