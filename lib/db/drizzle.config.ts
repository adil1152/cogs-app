import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

// Disable SSL verification for drizzle-kit process (necessary for AWS self-signed certs)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

// Ensure sslmode=require is in the URL if not already present
const dbUrl = process.env.DATABASE_URL.includes("sslmode=") 
  ? process.env.DATABASE_URL 
  : `${process.env.DATABASE_URL}${process.env.DATABASE_URL.includes("?") ? "&" : "?"}sslmode=require`;

export default defineConfig({
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: dbUrl,
  },
});
