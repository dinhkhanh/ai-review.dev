import { createDb } from "../client";
import { seed } from "../seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}
const { db, close } = createDb(url, { max: 1 });
try {
  await seed(db);
  console.log("Seed complete: launch categories, default settings, editor author");
} finally {
  await close();
}
