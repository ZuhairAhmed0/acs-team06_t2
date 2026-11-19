import { defineConfig } from "drizzle-kit";
import env from "./src/config/env.js";

export default defineConfig({
  dialect: "postgresql",
  dbCredentials: {
    url: env.DATABASE_URL,
  },
  schema: "./src/db/schema.ts",
  out: "./src/migrations",
  verbose: true,
  strict: true,
});
