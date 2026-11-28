import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(process.env.DATABASE_URL
    ? {
        dbCredentials: {
          url: process.env.DATABASE_URL,
        },
      }
    : {}),
});
