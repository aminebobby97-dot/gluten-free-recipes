// Five example recipe drafts used to demonstrate the layout.
//
// They are seeded with status "draft" and is_tested = false. They must be
// reviewed (and ideally cooked) by a person before anyone publishes them.
// Nutrition is intentionally null: no reliable calculation has been done yet.
//
// This file must stay free of path-alias imports: scripts/generate-seed.ts
// runs it directly with Node.

import type { RecipeInput } from "../lib/recipes/types";

export interface ExampleRecipe extends Omit<RecipeInput, "category_id"> {
  category_slug: string;
}

export const exampleRecipes: ExampleRecipe[] = [
  {
    title: "Fluffy Gluten-Free Pancakes",
    slug: "fluffy-gluten-free-pancakes",
    category_slug: "gluten-free-breakfast",
    description:
      "Tall, tender gluten-free pancakes made with a measure-for-measure flour blend, a short batter rest and a hot griddle.",
    introduction:
      "Good gluten-free pancakes come down to two things: a flour blend that contains a binder such as xanthan gum, and a few minutes of rest so the flours can absorb the milk. Skip the rest and the batter stays thin and gritty; give it ten minutes and it thickens into something that puffs on the griddle. This recipe keeps the ingredient list short and uses pantry staples you can find in most US grocery stores.",
    ingredients: [
      { amount: "1 1/2", unit: "cups", name: "gluten-free all-purpose flour blend", note: "one that contains xanthan gum", metric: "210 g" },
      { amount: "2", unit: "tbsp", name: "granulated sugar", metric: "25 g" },
      { amount: "1", unit: "tbsp", name: "baking powder", metric: "12 g" },
      { amount: "1/2", unit: "tsp", name: "fine salt" },
      { amount: "1 1/4", unit: "cups", name: "whole milk", note: "at room temperature", metric: "300 ml" },
      { amount: "1", unit: "", name: "large egg", note: "at room temperature" },
      { amount: "3", unit: "tbsp", name: "unsalted butter", note: "melted and slightly cooled, plus more for the pan", metric: "42 g" },
      { amount: "1", unit: "tsp", name: "pure vanilla extract" },
    ],
    instructions: [
      { text: "In a large bowl, whisk together the gluten-free flour blend, sugar, baking powder and salt until evenly combined." },
      { text: "In a separate bowl or large measuring cup, whisk the milk, egg, melted butter and vanilla until smooth." },
      { text: "Pour the wet ingredients into the dry ingredients and stir with a spatula until no dry streaks remain. A few small lumps are fine." },
      { text: "Let the batter rest for 10 minutes. It will thicken noticeably as the gluten-free flours absorb the liquid." },
      { text: "Heat a griddle or large nonstick skillet over medium heat and brush lightly with butter. The pan is ready when a drop of water sizzles and evaporates within a few seconds." },
      { text: "Pour about 1/4 cup of batter per pancake onto the griddle. Cook for 2 to 3 minutes, until bubbles form on the surface and the edges look set." },
      { text: "Flip and cook for another 1 to 2 minutes, until golden and cooked through in the center. Keep finished pancakes warm on a baking sheet in a 200°F oven while you cook the rest." },
    ],
    prep_time: 15,
    cook_time: 20,
    servings: 4,
    yield_description: "About 10 pancakes (4 inches each)",
    nutrition: null,
    tips: [
      "Use a flour blend that already contains xanthan gum. If yours does not, add 1/2 teaspoon of xanthan gum to the dry ingredients.",
      "Room-temperature milk and egg keep the melted butter from seizing into small lumps.",
      "If the batter becomes too thick to pour after resting, stir in 1 to 2 tablespoons of milk.",
      "Gluten-free pancakes brown faster than wheat pancakes, so keep the heat at medium rather than medium-high.",
    ],
    substitutions: [
      { original: "Whole milk", substitute: "Unsweetened almond or oat milk", note: "Choose an oat milk that is labeled gluten-free." },
      { original: "Unsalted butter", substitute: "Melted coconut oil or a neutral oil", note: "Use the same amount. This also makes the recipe dairy-free if you use plant milk." },
      { original: "Granulated sugar", substitute: "Light brown sugar or coconut sugar", note: "The pancakes will be slightly darker." },
    ],
    storage_instructions:
      "Cool leftover pancakes completely, then refrigerate in an airtight container for up to 3 days. To freeze, layer them between sheets of parchment paper in a freezer bag for up to 2 months. Reheat in a toaster, a 350°F oven or a dry skillet.",
    faq: [
      {
        question: "Why do I need to rest the batter?",
        answer:
          "Gluten-free flours, especially rice flour, absorb liquid more slowly than wheat flour. A 10-minute rest gives them time to hydrate, which thickens the batter and prevents a gritty texture.",
      },
      {
        question: "Can I use almond flour or coconut flour instead of the flour blend?",
        answer:
          "Not as a one-to-one swap. Almond and coconut flours behave very differently from an all-purpose gluten-free blend, so the pancakes would need different liquid and egg amounts.",
      },
      {
        question: "Why are my gluten-free pancakes gummy in the middle?",
        answer:
          "Usually the heat is too high, so the outside browns before the center cooks. Lower the heat slightly and make the pancakes a little smaller.",
      },
    ],
    featured_image: null,
    featured_image_alt: "Stack of fluffy gluten-free pancakes with butter and maple syrup",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: "Fluffy Gluten-Free Pancakes",
    seo_description:
      "Fluffy gluten-free pancakes made with an all-purpose gluten-free flour blend. Simple pantry ingredients, a 10-minute batter rest and tips for perfect results.",
    focus_keyword: "gluten-free pancakes",
    is_tested: false,
  },
  {
    title: "Easy Gluten-Free Banana Bread",
    slug: "easy-gluten-free-banana-bread",
    category_slug: "gluten-free-baking",
    description:
      "A moist, one-bowl gluten-free banana bread made with very ripe bananas, brown sugar and a gluten-free flour blend.",
    introduction:
      "Banana bread is one of the most forgiving things to bake gluten-free, because the mashed bananas add moisture and structure that the missing gluten would otherwise provide. The key is using bananas that are heavily speckled or even black, and letting the loaf cool completely before slicing so the crumb has time to set.",
    ingredients: [
      { amount: "3", unit: "", name: "very ripe medium bananas", note: "mashed (about 1 1/3 cups)", metric: "320 g mashed" },
      { amount: "1/3", unit: "cup", name: "unsalted butter", note: "melted", metric: "75 g" },
      { amount: "2/3", unit: "cup", name: "light brown sugar", note: "packed", metric: "135 g" },
      { amount: "2", unit: "", name: "large eggs", note: "at room temperature" },
      { amount: "1", unit: "tsp", name: "pure vanilla extract" },
      { amount: "1 3/4", unit: "cups", name: "gluten-free all-purpose flour blend", note: "one that contains xanthan gum", metric: "245 g" },
      { amount: "1", unit: "tsp", name: "baking soda" },
      { amount: "1/2", unit: "tsp", name: "fine salt" },
      { amount: "1", unit: "tsp", name: "ground cinnamon" },
      { amount: "1/2", unit: "cup", name: "chopped walnuts", note: "optional", metric: "60 g" },
    ],
    instructions: [
      { text: "Heat the oven to 350°F. Grease a 9 x 5-inch loaf pan and line it with a strip of parchment paper, leaving the ends hanging over the sides." },
      { text: "In a large bowl, mash the bananas with a fork until mostly smooth. Whisk in the melted butter, brown sugar, eggs and vanilla." },
      { text: "Sprinkle the flour blend, baking soda, salt and cinnamon over the wet ingredients. Stir with a spatula until just combined, then fold in the walnuts if using." },
      { text: "Scrape the batter into the prepared pan, smooth the top and let it rest for 10 minutes while the oven finishes heating." },
      { text: "Bake for 55 to 65 minutes, until a toothpick inserted in the center comes out clean or with a few moist crumbs. If the top browns too quickly, cover loosely with foil after about 40 minutes." },
      { text: "Cool in the pan for 15 minutes, then lift out using the parchment and cool completely on a wire rack before slicing." },
    ],
    prep_time: 15,
    cook_time: 60,
    servings: 10,
    yield_description: "One 9 x 5-inch loaf (10 slices)",
    nutrition: null,
    tips: [
      "The riper the bananas, the sweeter and moister the loaf. Bananas with mostly brown skins are ideal.",
      "Measure flour by weight if you can. Gluten-free blends vary in density, and too much flour makes a dry loaf.",
      "An instant-read thermometer should read about 200 to 205°F in the center when the loaf is done.",
      "Gluten-free quick breads keep setting as they cool. Slicing while warm can make the center look gummy.",
    ],
    substitutions: [
      { original: "Unsalted butter", substitute: "Neutral oil or melted coconut oil", note: "Use the same amount for a dairy-free loaf." },
      { original: "Walnuts", substitute: "Pecans, chocolate chips or leave them out", note: "If using chocolate chips, choose a brand labeled gluten-free." },
      { original: "Light brown sugar", substitute: "Coconut sugar", note: "Gives a slightly deeper caramel flavor." },
    ],
    storage_instructions:
      "Wrap the cooled loaf tightly and store at room temperature for up to 2 days or in the refrigerator for up to 5 days. For longer storage, freeze individual slices wrapped in plastic for up to 3 months and thaw at room temperature or toast lightly.",
    faq: [
      {
        question: "Can I make this banana bread without xanthan gum?",
        answer:
          "If your flour blend does not contain xanthan gum, add 3/4 teaspoon to the dry ingredients. Without a binder, the loaf is likely to crumble when sliced.",
      },
      {
        question: "Why did my gluten-free banana bread sink in the middle?",
        answer:
          "The most common causes are underbaking and opening the oven door early. Check that the center reaches about 200°F before taking it out.",
      },
      {
        question: "Can I make muffins with this batter?",
        answer:
          "Yes. Divide the batter among 12 lined muffin cups and start checking for doneness after about 20 minutes at 350°F.",
      },
    ],
    featured_image: null,
    featured_image_alt: "Sliced loaf of gluten-free banana bread on a wooden board",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: "Easy Gluten-Free Banana Bread (One Bowl)",
    seo_description:
      "An easy, moist gluten-free banana bread made in one bowl with ripe bananas, brown sugar and a gluten-free flour blend. Includes tips, swaps and storage.",
    focus_keyword: "gluten-free banana bread",
    is_tested: false,
  },
  {
    title: "Gluten-Free Chocolate Brownies",
    slug: "gluten-free-chocolate-brownies",
    category_slug: "gluten-free-desserts",
    description:
      "Rich, fudgy gluten-free brownies with a crackly top, made with melted chocolate, cocoa powder and a small amount of gluten-free flour.",
    introduction:
      "Brownies are a natural fit for gluten-free baking because they rely on chocolate, butter, sugar and eggs for their texture rather than flour. A small amount of gluten-free flour blend holds everything together. Beating the eggs and sugar well before adding the chocolate helps create the shiny, crackly top.",
    ingredients: [
      { amount: "1/2", unit: "cup", name: "unsalted butter", metric: "113 g" },
      { amount: "6", unit: "oz", name: "semisweet or bittersweet chocolate", note: "chopped", metric: "170 g" },
      { amount: "3/4", unit: "cup", name: "granulated sugar", metric: "150 g" },
      { amount: "1/4", unit: "cup", name: "light brown sugar", note: "packed", metric: "50 g" },
      { amount: "2", unit: "", name: "large eggs", note: "at room temperature" },
      { amount: "1", unit: "tsp", name: "pure vanilla extract" },
      { amount: "1/2", unit: "cup", name: "gluten-free all-purpose flour blend", metric: "70 g" },
      { amount: "1/4", unit: "cup", name: "unsweetened cocoa powder", metric: "21 g" },
      { amount: "1/2", unit: "tsp", name: "fine salt" },
      { amount: "1/2", unit: "cup", name: "chocolate chips", note: "optional", metric: "85 g" },
    ],
    instructions: [
      { text: "Heat the oven to 350°F. Line an 8 x 8-inch metal baking pan with parchment paper, leaving an overhang on two sides." },
      { text: "Melt the butter and chopped chocolate together in a heatproof bowl set over barely simmering water, or in the microwave in 20-second bursts, stirring until smooth. Let cool for 5 minutes." },
      { text: "In a large bowl, whisk the granulated sugar, brown sugar, eggs and vanilla vigorously for about 1 minute, until pale and slightly thickened." },
      { text: "Whisk the melted chocolate mixture into the egg mixture until glossy." },
      { text: "Add the flour blend, cocoa powder and salt and fold with a spatula until no dry spots remain. Fold in the chocolate chips if using." },
      { text: "Spread the batter evenly in the pan. Bake for 25 to 30 minutes, until the top is set and a toothpick inserted in the center comes out with moist crumbs but no wet batter." },
      { text: "Cool completely in the pan, at least 1 hour, before lifting out and cutting into 16 squares." },
    ],
    prep_time: 15,
    cook_time: 30,
    servings: 16,
    yield_description: "16 brownies (2-inch squares)",
    nutrition: null,
    tips: [
      "A metal pan bakes more evenly than glass. If you use glass, reduce the temperature to 325°F and expect a slightly longer bake.",
      "For clean slices, chill the cooled brownies for 30 minutes and wipe the knife between cuts.",
      "Pull the brownies when the center still has moist crumbs; they continue to set as they cool.",
    ],
    substitutions: [
      { original: "Unsalted butter", substitute: "Dairy-free baking sticks", note: "Use a dairy-free chocolate as well for fully dairy-free brownies." },
      { original: "Gluten-free all-purpose flour blend", substitute: "Superfine almond flour", note: "Use 2/3 cup. The brownies will be denser and more moist, and they will no longer be nut-free." },
    ],
    storage_instructions:
      "Store brownies in an airtight container at room temperature for up to 3 days or in the refrigerator for up to 1 week. Freeze individually wrapped squares for up to 3 months.",
    faq: [
      {
        question: "Is cocoa powder gluten-free?",
        answer:
          "Pure unsweetened cocoa powder is made only from cocoa beans and does not contain gluten, but it can be processed in facilities that also handle wheat. Check the label if you need to avoid cross-contact.",
      },
      {
        question: "How do I get a crackly top on brownies?",
        answer:
          "Whisk the eggs and sugar well before adding the chocolate. This dissolves some of the sugar and creates the thin, shiny crust that cracks as it bakes.",
      },
    ],
    featured_image: null,
    featured_image_alt: "Squares of fudgy gluten-free chocolate brownies with a crackly top",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: "Fudgy Gluten-Free Chocolate Brownies",
    seo_description:
      "Rich, fudgy gluten-free chocolate brownies with a crackly top. Made with melted chocolate, cocoa and gluten-free flour in one bowl.",
    focus_keyword: "gluten-free brownies",
    is_tested: false,
  },
  {
    title: "Gluten-Free Chicken Alfredo",
    slug: "gluten-free-chicken-alfredo",
    category_slug: "gluten-free-dinner",
    description:
      "Creamy gluten-free chicken Alfredo with seared chicken breast, a garlic Parmesan cream sauce and gluten-free fettuccine.",
    introduction:
      "Classic Alfredo sauce is naturally gluten-free: it is simply butter, cream, garlic and Parmesan. The gluten comes from the pasta and, sometimes, from flour used to thicken restaurant versions. This recipe uses gluten-free fettuccine and lets the cheese and a splash of starchy pasta water thicken the sauce instead.",
    ingredients: [
      { amount: "12", unit: "oz", name: "gluten-free fettuccine", note: "or another long gluten-free pasta", metric: "340 g" },
      { amount: "1 1/2", unit: "lb", name: "boneless, skinless chicken breasts", note: "about 2 large, halved horizontally", metric: "680 g" },
      { amount: "1", unit: "tsp", name: "fine salt", note: "divided" },
      { amount: "1/2", unit: "tsp", name: "freshly ground black pepper" },
      { amount: "1", unit: "tbsp", name: "olive oil" },
      { amount: "3", unit: "tbsp", name: "unsalted butter", metric: "42 g" },
      { amount: "3", unit: "cloves", name: "garlic", note: "minced" },
      { amount: "1 1/2", unit: "cups", name: "heavy cream", metric: "360 ml" },
      { amount: "1 1/2", unit: "cups", name: "Parmesan cheese", note: "finely grated from a block", metric: "120 g" },
      { amount: "2", unit: "tbsp", name: "fresh parsley", note: "chopped" },
    ],
    instructions: [
      { text: "Bring a large pot of salted water to a boil. Cook the gluten-free fettuccine for 1 to 2 minutes less than the package directions. Reserve 1 cup of pasta water, then drain." },
      { text: "While the water heats, season the chicken on both sides with 1/2 teaspoon of the salt and the pepper." },
      { text: "Heat the olive oil in a large skillet over medium-high heat. Cook the chicken for 4 to 6 minutes per side, until golden and an instant-read thermometer reads 165°F in the thickest part. Transfer to a cutting board and rest for 5 minutes, then slice." },
      { text: "Lower the heat to medium. Add the butter to the same skillet. When it melts, add the garlic and cook for about 30 seconds, until fragrant but not browned." },
      { text: "Pour in the cream and the remaining 1/2 teaspoon of salt. Bring to a gentle simmer and cook for 3 to 4 minutes, stirring often, until slightly reduced." },
      { text: "Remove the skillet from the heat and whisk in the Parmesan a handful at a time until smooth." },
      { text: "Add the drained pasta and toss to coat, adding reserved pasta water a few tablespoons at a time until the sauce is silky. Top with the sliced chicken and parsley and serve immediately." },
    ],
    prep_time: 10,
    cook_time: 25,
    servings: 4,
    yield_description: "4 servings",
    nutrition: null,
    tips: [
      "Gluten-free pasta continues to soften after draining and can turn mushy, so slightly undercook it and finish it in the sauce.",
      "Take the pan off the heat before adding the cheese. Cheese added to boiling cream can turn grainy.",
      "Use a separate pot, colander and utensils if you are also cooking wheat pasta in the same kitchen.",
    ],
    substitutions: [
      { original: "Chicken breasts", substitute: "Boneless chicken thighs or shrimp", note: "Cook thighs to 165°F; cook shrimp just until pink, about 2 minutes per side." },
      { original: "Heavy cream", substitute: "Half-and-half", note: "The sauce will be thinner. Simmer a little longer and add the cheese gradually." },
      { original: "Gluten-free fettuccine", substitute: "Gluten-free penne or spaghetti", note: "Any gluten-free pasta shape works with this sauce." },
    ],
    storage_instructions:
      "Refrigerate leftovers in an airtight container for up to 3 days. Alfredo sauce thickens as it chills; reheat gently in a skillet over low heat with a splash of milk or water, stirring until creamy. Freezing is not recommended because the sauce can separate.",
    faq: [
      {
        question: "Is Alfredo sauce gluten-free?",
        answer:
          "Homemade Alfredo made from butter, cream, garlic and Parmesan contains no gluten ingredients. Jarred and restaurant sauces sometimes include wheat flour or other additives, so always check the label or ask.",
      },
      {
        question: "Is Parmesan cheese gluten-free?",
        answer:
          "Parmesan is naturally gluten-free. Pre-grated cheese often contains anti-caking agents that are usually gluten-free but worth checking on the label; grating from a block also gives a smoother sauce.",
      },
      {
        question: "What is the best gluten-free pasta for Alfredo?",
        answer:
          "Pasta made from a blend of corn and rice, or from brown rice, tends to hold its shape well in creamy sauces. Look for packages clearly labeled gluten-free.",
      },
    ],
    featured_image: null,
    featured_image_alt: "Bowl of creamy gluten-free chicken Alfredo with sliced chicken and parsley",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: "Creamy Gluten-Free Chicken Alfredo",
    seo_description:
      "Creamy gluten-free chicken Alfredo with seared chicken, garlic Parmesan sauce and gluten-free fettuccine. Ready in about 35 minutes.",
    focus_keyword: "gluten-free chicken alfredo",
    is_tested: false,
  },
  {
    title: "Gluten-Free Blueberry Muffins",
    slug: "gluten-free-blueberry-muffins",
    category_slug: "gluten-free-breakfast",
    description:
      "Soft, bakery-style gluten-free blueberry muffins with a domed, sugar-crusted top and plenty of fresh blueberries.",
    introduction:
      "These gluten-free blueberry muffins use sour cream for moisture and a short batter rest so the flour blend can hydrate, which gives a softer crumb and taller tops. Starting the muffins in a hot oven and then lowering the temperature helps them dome without drying out.",
    ingredients: [
      { amount: "2", unit: "cups", name: "gluten-free all-purpose flour blend", note: "one that contains xanthan gum", metric: "280 g" },
      { amount: "3/4", unit: "cup", name: "granulated sugar", metric: "150 g" },
      { amount: "2", unit: "tsp", name: "baking powder" },
      { amount: "1/2", unit: "tsp", name: "baking soda" },
      { amount: "1/2", unit: "tsp", name: "fine salt" },
      { amount: "1/2", unit: "cup", name: "unsalted butter", note: "melted and slightly cooled", metric: "113 g" },
      { amount: "2", unit: "", name: "large eggs", note: "at room temperature" },
      { amount: "1/2", unit: "cup", name: "sour cream", note: "at room temperature", metric: "120 g" },
      { amount: "1/2", unit: "cup", name: "whole milk", note: "at room temperature", metric: "120 ml" },
      { amount: "2", unit: "tsp", name: "pure vanilla extract" },
      { amount: "1 1/2", unit: "cups", name: "fresh blueberries", metric: "225 g" },
      { amount: "1", unit: "tbsp", name: "turbinado sugar", note: "for topping" },
    ],
    instructions: [
      { text: "Line a 12-cup muffin pan with paper liners." },
      { text: "In a large bowl, whisk together the flour blend, granulated sugar, baking powder, baking soda and salt." },
      { text: "In another bowl, whisk the melted butter, eggs, sour cream, milk and vanilla until smooth." },
      { text: "Add the wet ingredients to the dry ingredients and fold until just combined. Gently fold in the blueberries." },
      { text: "Let the batter rest for 15 minutes. Meanwhile, heat the oven to 400°F." },
      { text: "Divide the batter among the muffin cups; they will be full. Sprinkle the tops with turbinado sugar." },
      { text: "Bake for 5 minutes at 400°F, then lower the oven to 350°F without opening the door and bake for 15 to 18 minutes more, until golden and a toothpick inserted in the center comes out clean." },
      { text: "Cool in the pan for 10 minutes, then transfer to a wire rack." },
    ],
    prep_time: 20,
    cook_time: 22,
    servings: 12,
    yield_description: "12 muffins",
    nutrition: null,
    tips: [
      "If using frozen blueberries, keep them frozen and fold them in at the last moment to limit color bleeding. Add 3 to 5 minutes to the bake time.",
      "Toss the blueberries with 1 tablespoon of the flour mixture before folding them in to help keep them suspended in the batter.",
      "Paper liners can stick to gluten-free muffins while warm. Let the muffins cool before peeling.",
    ],
    substitutions: [
      { original: "Sour cream", substitute: "Plain full-fat Greek yogurt", note: "Use the same amount." },
      { original: "Whole milk", substitute: "Any unsweetened plant milk", note: "Choose an oat milk labeled gluten-free if using oat milk." },
      { original: "Fresh blueberries", substitute: "Raspberries or chopped strawberries", note: "Use the same amount of fruit." },
    ],
    storage_instructions:
      "Store cooled muffins in an airtight container lined with a paper towel at room temperature for up to 2 days, or refrigerate for up to 5 days. Freeze for up to 3 months and reheat for 15 to 20 seconds in the microwave.",
    faq: [
      {
        question: "Why rest gluten-free muffin batter?",
        answer:
          "Resting lets the rice and starch flours absorb the liquid. The batter thickens, the muffins rise taller, and the texture is less gritty.",
      },
      {
        question: "Can I make these muffins dairy-free?",
        answer:
          "Replace the butter with a neutral oil, the milk with a plant milk and the sour cream with a dairy-free yogurt. The texture may be slightly different.",
      },
    ],
    featured_image: null,
    featured_image_alt: "Gluten-free blueberry muffins with sugar-crusted tops on a cooling rack",
    pinterest_image: null,
    pinterest_image_alt: null,
    seo_title: "Bakery-Style Gluten-Free Blueberry Muffins",
    seo_description:
      "Soft, bakery-style gluten-free blueberry muffins with domed, sugar-crusted tops. Made with a gluten-free flour blend, sour cream and fresh blueberries.",
    focus_keyword: "gluten-free blueberry muffins",
    is_tested: false,
  },
];
