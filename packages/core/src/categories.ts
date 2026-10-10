import { asc, categories, type DbOrTx } from "@repo/db";

export async function listCategories(db: DbOrTx) {
  return db
    .select({ id: categories.id, slug: categories.slug, name: categories.name, description: categories.description })
    .from(categories)
    .orderBy(asc(categories.position), asc(categories.name));
}
