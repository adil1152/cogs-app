import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
    ...((process.env.DATABASE_URL.includes("rds.amazonaws.com") || process.env.NODE_ENV === "production" || process.env.NODE_ENV === "staging") ? { ssl: { rejectUnauthorized: false } } : {}),
  },
});
