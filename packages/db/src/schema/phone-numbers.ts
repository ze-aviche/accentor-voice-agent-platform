import { pgTable, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core"

import { agentsTable, agentVersionsTable } from "@workspace/db/schema/agents"

export const phoneNumbersTable = pgTable(
  "phone_numbers",
  {
    id: uuid().primaryKey(),
    number: varchar({ length: 16 }).notNull(),
    agentId: uuid("agent_id").references(() => agentsTable.id, {
      onDelete: "set null",
    }),
    agentVersionId: uuid("agent_version_id").references(
      () => agentVersionsTable.id,
      { onDelete: "set null" }
    ),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" })
      .defaultNow()
      .notNull(),
  },
  (table) => ({
    uniquePhoneNumber: unique("unique_phone_number").on(table.number),
  })
)
