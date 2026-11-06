import { z } from 'zod';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { RunAsStaff, StaffTransaction } from '../db/staff-transaction.js';
import type { StaffContext } from '../staff-context.js';
import type { Database } from '../db/types.js';

type ActiveStage = Exclude<Database['public']['Enums']['inquiry_stage'], 'enrolled' | 'withdrawn' | 'lost'>;

const TERMINAL_STAGES = ['enrolled', 'withdrawn', 'lost'] as const;
const ACTIVE_STAGES = ['new', 'contacted', 'tour_booked', 'applied', 'assessment', 'offered'] as const satisfies readonly ActiveStage[];

const MIN_DAYS_WITHOUT_CONTACT = 1;
const MAX_DAYS_WITHOUT_CONTACT = 60;
const DEFAULT_DAYS_WITHOUT_CONTACT = 5;

const InputSchema = z.object({
  min_days_without_contact: z
    .number()
    .int()
    .min(MIN_DAYS_WITHOUT_CONTACT)
    .max(MAX_DAYS_WITHOUT_CONTACT)
    .default(DEFAULT_DAYS_WITHOUT_CONTACT)
    .describe(
      `Inclusive lower bound, in whole days: returns inquiries whose daysSinceContact is >= this value. For "more than 5 days", pass 6. ${MIN_DAYS_WITHOUT_CONTACT}-${MAX_DAYS_WITHOUT_CONTACT}, default ${DEFAULT_DAYS_WITHOUT_CONTACT}.`
    ),
  campus: z
    .string()
    .min(1)
    .optional()
    .describe(
      "Campus id to search (e.g. 'erbil'). Defaults to the acting staff member's own campus. A counsellor or campus_head may not pass a different campus."
    ),
});

const StaleInquiryRowSchema = z.object({
  inquiryId: z.guid(),
  applicantName: z.string(),
  entryGrade: z.string(),
  entryYear: z.number().int(),
  stage: z.enum(ACTIVE_STAGES),
  daysSinceContact: z.number().int(),
  neverContacted: z.boolean(),
  guardianName: z.string(),
  preferredLanguage: z.string(),
  assignedStaffName: z.string().nullable(),
});

const OutputSchema = z.object({
  inquiries: z.array(StaleInquiryRowSchema),
});

export type StaleInquiryRow = z.infer<typeof StaleInquiryRowSchema>;

interface QueryRow {
  inquiry_id: string;
  applicant_name: string;
  entry_grade: string;
  entry_year: number;
  stage: ActiveStage;
  days_since_contact: number;
  never_contacted: boolean;
  guardian_name: string;
  preferred_language: string;
  assigned_staff_name: string | null;
}

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
}

function renderRow(row: StaleInquiryRow): string {
  const contact = row.neverContacted
    ? `never contacted (${row.daysSinceContact}d since created)`
    : `${row.daysSinceContact}d since last contact`;
  return `- [${row.stage}] ${row.applicantName} (${row.entryGrade}, ${row.entryYear}) — ${contact} — guardian: ${row.guardianName} (${row.preferredLanguage}) — staff: ${row.assignedStaffName ?? 'unassigned'} — ${row.inquiryId}`;
}

/**
 * Active inquiries in `campusId` with daysSinceContact >= `minDays`, most
 * stale first. The campus filter is kept here even though RLS also scopes
 * rows to the caller's campus: either layer alone must be enough.
 */
export async function queryStaleInquiries(
  tx: StaffTransaction,
  campusId: string,
  minDays: number
): Promise<StaleInquiryRow[]> {
  // days_since_contact and never_contacted come straight from the
  // inquiry_activity view, the single definition of staleness. The filter
  // and the reported number read the same column, so they cannot disagree.
  const rows = await tx<QueryRow[]>`
    select
      ia.inquiry_id,
      a.first_name || ' ' || a.last_name as applicant_name,
      a.entry_grade,
      a.entry_year,
      ia.stage,
      ia.days_since_contact,
      ia.never_contacted,
      g.full_name as guardian_name,
      g.preferred_language,
      s.full_name as assigned_staff_name
    from inquiry_activity ia
    join inquiries i on i.id = ia.inquiry_id
    join applicants a on a.id = i.applicant_id
    join guardians g on g.id = i.guardian_id
    left join staff s on s.id = ia.assigned_staff_id
    where ia.campus_id = ${campusId}
      and ia.stage not in ${tx(TERMINAL_STAGES)}
      and ia.days_since_contact >= ${minDays}
    order by ia.days_since_contact desc
    limit 50
  `;

  return rows.map((row) => ({
    inquiryId: row.inquiry_id,
    applicantName: row.applicant_name,
    entryGrade: row.entry_grade,
    entryYear: row.entry_year,
    stage: row.stage,
    daysSinceContact: row.days_since_contact,
    neverContacted: row.never_contacted,
    guardianName: row.guardian_name,
    preferredLanguage: row.preferred_language,
    assignedStaffName: row.assigned_staff_name,
  }));
}

export function registerFindStaleInquiriesTool(server: McpServer, runAsStaff: RunAsStaff, staff: StaffContext): void {
  server.registerTool(
    'find_stale_inquiries',
    {
      title: 'Find stale inquiries',
      description:
        'Active admissions inquiries (not enrolled, withdrawn, or lost) with no contact for at least N whole days, where N is min_days_without_contact (inclusive). For "more than 5 days", pass 6. daysSinceContact is whole days since the latest followup, rounded down; for an inquiry never contacted (neverContacted: true) it is whole days since the inquiry was created. Every returned row has daysSinceContact >= N. Returns one row per inquiry — applicant name, entry grade/year, stage, days since contact, guardian name and preferred language, and assigned staff — sorted most-stale first, capped at 50 rows. Does not return email, phone, or any sensitive child field (DOB, learning support, medical notes); use get_inquiry for guardian contact details. A counsellor or campus_head only ever sees their own campus. Leadership cannot use this tool — it returns individual records, which leadership must only see as aggregates.',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false },
    },
    async ({ min_days_without_contact: minDays, campus }): Promise<CallToolResult> => {
      if (staff.role === 'leadership') {
        return toolError(
          'Leadership accounts can only see aggregate data across campuses, never individual inquiry records. This tool returns per-inquiry rows, so it is not available to leadership.'
        );
      }

      const campusId = staff.campusId;
      if (campusId === null) {
        throw new Error(`Staff ${staff.id} has role ${staff.role} but no campus_id`);
      }

      if (campus !== undefined && campus !== campusId) {
        return toolError(
          `Access denied: you are a ${staff.role} for campus "${campusId}" and can only view inquiries for your own campus. You requested campus "${campus}".`
        );
      }

      const inquiries = await runAsStaff((tx) => queryStaleInquiries(tx, campusId, minDays));

      const text =
        inquiries.length === 0
          ? `No active inquiries in ${campusId} have gone ${minDays}+ whole days without contact.`
          : `${inquiries.length} active inquiries in ${campusId} have gone ${minDays}+ whole days without contact:\n${inquiries.map(renderRow).join('\n')}`;

      return {
        content: [{ type: 'text', text }],
        structuredContent: { inquiries },
      };
    }
  );
}
