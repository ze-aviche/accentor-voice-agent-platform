import { defineRelations } from "drizzle-orm"

import { agentsTable, agentVersionsTable } from "@workspace/db/schema/agents"
import { phoneNumbersTable } from "@workspace/db/schema/phone-numbers"

export const relations = defineRelations(
  { agentsTable, agentVersionsTable, phoneNumbersTable },
  (r) => ({
    agentsTable: {
      versions: r.many.agentVersionsTable({
        from: r.agentsTable.id,
        to: r.agentVersionsTable.agentId,
      }),
      phoneNumbers: r.many.phoneNumbersTable({
        from: r.agentsTable.id,
        to: r.phoneNumbersTable.agentId,
      }),
    },
    agentVersionsTable: {
      agent: r.one.agentsTable({
        from: r.agentVersionsTable.agentId,
        to: r.agentsTable.id,
      }),
      phoneNumbers: r.many.phoneNumbersTable({
        from: r.agentVersionsTable.id,
        to: r.phoneNumbersTable.agentVersionId,
      }),
    },
    phoneNumbersTable: {
      agent: r.one.agentsTable({
        from: r.phoneNumbersTable.agentId,
        to: r.agentsTable.id,
      }),
      agentVersion: r.one.agentVersionsTable({
        from: r.phoneNumbersTable.agentVersionId,
        to: r.agentVersionsTable.id,
      }),
    },
  })
)
