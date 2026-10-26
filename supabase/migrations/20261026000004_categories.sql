-- The eight launch categories. Safe to re-run: existing rows are left alone.

insert into public.categories
  (slug, name, short_name, sort_order, description, introduction, seo_title, seo_description)
values
(
  'gluten-free-breakfast', 'Gluten-Free Breakfast', 'Breakfast', 10,
  'Gluten-free pancakes, muffins, egg dishes and make-ahead breakfasts for busy mornings.',
  'Breakfast is often where gluten hides in plain sight: pancake mixes, granola, toast and pastries. These recipes use gluten-free flour blends, certified gluten-free oats and naturally gluten-free staples like eggs, potatoes and fruit, so you can start the day with something warm and satisfying. Many of them can be prepared the night before or frozen in batches.',
  'Gluten-Free Breakfast Recipes',
  'Easy gluten-free breakfast recipes: fluffy pancakes, muffins, egg bakes and make-ahead ideas made with gluten-free flours and certified oats.'
),
(
  'gluten-free-lunch', 'Gluten-Free Lunch', 'Lunch', 20,
  'Packable salads, soups, wraps and bowls that are gluten-free and easy to prepare ahead.',
  'A good gluten-free lunch should travel well and keep you full until dinner. Here you will find hearty grain bowls built on rice and quinoa, soups thickened without wheat flour, and sandwiches and wraps that work with gluten-free bread or tortillas. Look for the notes on sauces and dressings, which are a common source of hidden gluten.',
  'Gluten-Free Lunch Recipes',
  'Gluten-free lunch recipes for home and work: grain bowls, soups, salads and wraps, with tips for spotting hidden gluten in sauces.'
),
(
  'gluten-free-dinner', 'Gluten-Free Dinner', 'Dinner', 30,
  'Weeknight-friendly gluten-free dinners, from creamy pastas to one-pan chicken and sheet-pan meals.',
  'Dinner does not need a separate gluten-free shopping list. These recipes rely on ingredients you can find in most US grocery stores, such as gluten-free pasta, rice, potatoes, fresh vegetables and proteins, and they flag the products worth double-checking, like broth, soy sauce and spice blends. Most are designed for weeknights, with a few slower weekend projects.',
  'Gluten-Free Dinner Recipes',
  'Easy gluten-free dinner recipes for weeknights: pastas, chicken, one-pan meals and comfort food, with notes on checking labels.'
),
(
  'gluten-free-desserts', 'Gluten-Free Desserts', 'Desserts', 40,
  'Brownies, cakes, cookies and puddings made without wheat flour.',
  'Gluten-free desserts can be every bit as rich and tender as their traditional versions. Some, like flourless chocolate cake and many puddings, are naturally gluten-free; others use a carefully chosen flour blend. Each recipe notes which blend works best and how to keep shared baking equipment free of gluten crumbs.',
  'Gluten-Free Dessert Recipes',
  'Gluten-free dessert recipes: fudgy brownies, cakes, cookies and puddings, with guidance on flour blends and avoiding cross-contact.'
),
(
  'gluten-free-baking', 'Gluten-Free Baking', 'Baking', 50,
  'Gluten-free breads, quick breads, muffins and pastry, with practical notes on flour blends and binders.',
  'Baking without gluten works differently: gluten-free flours absorb liquid at different rates, and many blends rely on xanthan gum or psyllium to hold everything together. These recipes explain which type of blend to use, why resting the batter helps, and how to tell when a loaf is properly baked through.',
  'Gluten-Free Baking Recipes',
  'Gluten-free baking recipes for bread, quick breads, muffins and pastry, with clear guidance on flour blends, binders and baking times.'
),
(
  'gluten-free-snacks', 'Gluten-Free Snacks', 'Snacks', 60,
  'Gluten-free snacks and small bites for after school, game day and the afternoon slump.',
  'Packaged snacks are one of the trickiest places to avoid gluten. These homemade options, from energy bites to crispy roasted chickpeas, let you control every ingredient. Where a recipe calls for oats, pretzels or crackers, we note that you should use products clearly labeled gluten-free.',
  'Gluten-Free Snack Recipes',
  'Homemade gluten-free snack recipes: energy bites, roasted chickpeas, dips and small bites, with notes on choosing labeled gluten-free products.'
),
(
  'gluten-free-dairy-free', 'Gluten-Free Dairy-Free', 'Dairy-Free', 70,
  'Recipes that are both gluten-free and dairy-free, without giving up flavor or texture.',
  'If you avoid both gluten and dairy, this collection is for you. These recipes use plant-based milks, olive oil, coconut and dairy-free butter alternatives in place of milk, butter and cheese. Always check labels on dairy-free substitutes, as some contain oats or other ingredients that may not be gluten-free.',
  'Gluten-Free Dairy-Free Recipes',
  'Recipes that are gluten-free and dairy-free: breakfasts, dinners and desserts made with plant-based milks and dairy-free swaps.'
),
(
  'high-protein-gluten-free', 'High-Protein Gluten-Free', 'High-Protein', 80,
  'Gluten-free recipes built around protein-rich ingredients like eggs, chicken, beans, Greek yogurt and tofu.',
  'These gluten-free recipes are built around protein-rich ingredients such as eggs, poultry, fish, legumes, Greek yogurt and tofu. Nutrition values on this site are estimates calculated from ingredient data, not laboratory measurements, so treat the numbers as a helpful guide rather than an exact figure.',
  'High-Protein Gluten-Free Recipes',
  'High-protein gluten-free recipes with eggs, chicken, beans, Greek yogurt and tofu. Nutrition values are clearly labeled estimates.'
)
on conflict (slug) do nothing;
