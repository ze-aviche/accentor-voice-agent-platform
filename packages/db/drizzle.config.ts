import "dotenv/config"
import { defineConfig } from "drizzle-kit"

import { env } from "@workspace/db/lib/env"

export default defineConfig({
  out: "./drizzle",
  schema: "./src/schema",
  dialect: "postgresql",
  // Only manage the public schema. Supabase ships managed schemas
  // (auth, storage, realtime, vault, extensions, …) that must not be touched.
  schemaFilter: ["public"],
  dbCredentials: {
    url: env.DATABASE_URL,
  },
})
