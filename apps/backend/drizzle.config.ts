import { defineConfig } from "drizzle-kit";

export default defineConfig({
	schema: "./src/db/schema.ts",
	out: "./drizzle",
	dialect: "sqlite",
	dbCredentials: {
		// Relative to this package, like `schema` and `out` above. Keep in step
		// with DB_PATH in src/db/index.ts.
		url: process.env.DATABASE_URL ?? "../../data/canireplaceit.db",
	},
});
