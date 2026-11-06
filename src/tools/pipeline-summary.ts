import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { INQUIRY_STAGES, isTerminalStage } from '../db/enums.js';
import type { StaffTransaction } from '../db/staff-transaction.js';
import type { Database } from '../db/types.js';
import type { StaffContext } from '../staff-context.js';
import { toolError, type RunToolCall, type ToolCallResult } from '../tool-call.js';

const TOOL_NAME = 'pipeline_summary';

const MIN_DAYS_WITHOUT_CONTACT = 1;
const MAX_DAYS_WITHOUT_CONTACT = 60;
const DEFAULT_DAYS_WITHOUT_CONTACT = 5;

const InputSchema = z.object({
  campus: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Campus id to summarise (e.g. 'erbil'). Leadership: any campus, or every campus combined when omitted. Counsellor or campus_head: defaults to and may only be their own campus."
    ),
  min_days_without_contact: z
    .number()
    .int()
    .min(MIN_DAYS_WITHOUT_CONTACT)
    .max(MAX_DAYS_WITHOUT_CONTACT)
    .default(DEFAULT_DAYS_WITHOUT_CONTACT)
    .describe(
      `Inclusive staleness threshold in whole days, same as find_stale_inquiries: an active inquiry is stale when daysSinceContact >= this value. For "more than 5 days", pass 6. ${MIN_DAYS_WITHOUT_CONTACT}-${MAX_DAYS_WITHOUT_CONTACT}, default ${DEFAULT_DAYS_WITHOUT_CONTACT}.`
    ),
});

const StageCountSchema = z.object({
  stage: z.enum(INQUIRY_STAGES),
  inquiryCount: z.number().int(),
  staleCount: z.number().int(),
});

const OutputSchema = z.object({
  campus: z.string().nullable().describe('The campus summarised, or null for every campus combined.'),
  minDaysWithoutContact: z.number().int(),
  byStage: z.array(StageCountSchema).describe('Every stage, including those with zero inquiries.'),
  activeTotal: z.number().int().describe('Inquiries not enrolled, withdrawn or lost.'),
  staleCount: z.number().int().describe('Active inquiries with daysSinceContact >= minDaysWithoutContact.'),
});

type PipelineSummary = z.infer<typeof OutputSchema>;
type SummaryRow = Database['public']['Functions']['pipeline_summary']['Returns'][number];

/**
 * Counts from the pipeline_summary database function, which decides the
 * caller's scope itself from current_staff(): it is the only way leadership
 * can count anything, because RLS gives leadership no rows.
 */
async function querySummary(tx: StaffTransaction, campusId: string | null, minDays: number): Promise<SummaryRow[]> {
  return tx<SummaryRow[]>`
    select stage, inquiry_count, stale_count
    from pipeline_summary(${campusId}, ${minDays})
  `;
}

function summarise(rows: SummaryRow[], campus: string | null, minDays: number): PipelineSummary {
  const byStage = rows.map((row) => ({ stage: row.stage, inquiryCount: row.inquiry_count, staleCount: row.stale_count }));
  const activeTotal = byStage
    .filter((row) => !isTerminalStage(row.stage))
    .reduce((sum, row) => sum + row.inquiryCount, 0);
  const staleCount = byStage.reduce((sum, row) => sum + row.staleCount, 0);
  return { campus, minDaysWithoutContact: minDays, byStage, activeTotal, staleCount };
}

function renderSummary(summary: PipelineSummary): string {
  const scope = summary.campus ?? 'all campuses';
  return [
    `Pipeline for ${scope}: ${summary.activeTotal} active inquiries, ${summary.staleCount} with no contact for ${summary.minDaysWithoutContact}+ whole days.`,
    ...summary.byStage.map((row) => `- ${row.stage}: ${row.inquiryCount}${row.staleCount > 0 ? ` (${row.staleCount} stale)` : ''}`),
  ].join('\n');
}

async function campusExists(tx: StaffTransaction, campusId: string): Promise<boolean> {
  const rows = await tx`select 1 from campuses where id = ${campusId}`;
  return rows.length > 0;
}

type Scope = { allowed: true; campusId: string | null } | { allowed: false; message: string };

async function resolveScope(tx: StaffTransaction, staff: StaffContext, campus: string | undefined): Promise<Scope> {
  if (staff.role === 'leadership') {
    if (campus !== undefined && !(await campusExists(tx, campus))) {
      return { allowed: false, message: `Unknown campus "${campus}". Omit campus to summarise every campus.` };
    }
    return { allowed: true, campusId: campus ?? null };
  }

  const ownCampusId = staff.campusId;
  if (ownCampusId === null) {
    throw new Error(`Staff ${staff.id} has role ${staff.role} but no campus_id`);
  }
  if (campus !== undefined && campus !== ownCampusId) {
    return {
      allowed: false,
      message: `Access denied: you are a ${staff.role} for campus "${ownCampusId}" and can only summarise your own campus. You requested campus "${campus}".`,
    };
  }
  return { allowed: true, campusId: ownCampusId };
}

export function registerPipelineSummaryTool(server: McpServer, runToolCall: RunToolCall, staff: StaffContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Pipeline summary',
      description:
        'Aggregate admissions pipeline counts: the number of inquiries in each stage (all nine stages, zero-filled), the active total (not enrolled, withdrawn or lost), and how many active inquiries are stale — no contact for at least min_days_without_contact whole days, the same inclusive definition as find_stale_inquiries (for "more than 5 days", pass 6). Returns counts only: no names, ids or individual records. Leadership can summarise any campus, or every campus combined by omitting campus. A counsellor or campus_head can only summarise their own campus. Use find_stale_inquiries, not this, when the user needs to know which inquiries are stale.',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      runToolCall(TOOL_NAME, args, async (tx): Promise<ToolCallResult> => {
        const { campus, min_days_without_contact: minDays } = args;

        const scope = await resolveScope(tx, staff, campus);
        if (!scope.allowed) {
          // An unknown campus is recorded as denied too, like get_inquiry's
          // not-found: the audit outcome has no separate "bad input" value.
          return { outcome: 'denied', result: toolError(scope.message) };
        }

        const summary = summarise(await querySummary(tx, scope.campusId, minDays), scope.campusId, minDays);

        return {
          outcome: 'ok',
          result: { content: [{ type: 'text', text: renderSummary(summary) }], structuredContent: summary },
          // One aggregate, never individual rows.
          resultCount: 1,
          sensitiveReturned: false,
        };
      })
  );
}
