import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import type { StaffTransaction } from '../db/staff-transaction.js';
import type { StaffContext, StaffRole } from '../staff-context.js';
import type { Database } from '../db/types.js';
import { toolError, type RunToolCall, type ToolCallResult } from '../tool-call.js';

const TOOL_NAME = 'get_inquiry';

const STAGES = [
  'new',
  'contacted',
  'tour_booked',
  'applied',
  'assessment',
  'offered',
  'enrolled',
  'withdrawn',
  'lost',
] as const satisfies readonly Database['public']['Enums']['inquiry_stage'][];

const SOURCES = [
  'website',
  'referral',
  'walk_in',
  'agent',
  'event',
  'phone',
  'social_media',
] as const satisfies readonly Database['public']['Enums']['inquiry_source'][];

const CHANNELS = ['email', 'phone', 'whatsapp', 'meeting'] as const satisfies readonly Database['public']['Enums']['followup_channel'][];

export const NOT_FOUND_MESSAGE = 'Inquiry not found or not accessible.';
export const CAMPUS_HEAD_ONLY_NOTE =
  'Sensitive fields (date of birth, learning support notes, medical notes) are available to the campus head only.';
const NO_SENSITIVE_RECORD_NOTE = 'No sensitive record (date of birth, learning support, medical notes) is on file for this applicant.';

const InputSchema = z.object({
  inquiry_id: z.guid().describe('The inquiry id to look up.'),
  include_sensitive: z
    .boolean()
    .default(false)
    .describe(
      "Also return the child's date of birth, learning support notes and medical notes. Only honoured for the campus head of the inquiry's campus. Set true only when the user explicitly needs one of these fields."
    ),
});

const FollowupSchema = z.object({
  channel: z.enum(CHANNELS),
  note: z.string(),
  loggedBy: z.string().nullable(),
  createdAt: z.string(),
});

const SensitiveFieldsSchema = z.object({
  dateOfBirth: z.string().describe('YYYY-MM-DD'),
  learningSupportNotes: z.string().nullable(),
  medicalNotes: z.string().nullable(),
});

const OutputSchema = z.object({
  inquiryId: z.guid(),
  campusId: z.string(),
  stage: z.enum(STAGES),
  source: z.enum(SOURCES),
  createdAt: z.string(),
  assignedStaffName: z.string().nullable(),
  applicant: z.object({
    firstName: z.string(),
    lastName: z.string(),
    entryGrade: z.string(),
    entryYear: z.number().int(),
    currentSchool: z.string().nullable(),
  }),
  guardian: z.object({
    fullName: z.string(),
    email: z.string(),
    phone: z.string(),
    preferredLanguage: z.string(),
  }),
  recentFollowups: z.array(FollowupSchema),
  sensitiveFields: SensitiveFieldsSchema.optional().describe(
    'Present only for the campus head of this campus when include_sensitive was true.'
  ),
  sensitiveFieldsNote: z.string().optional().describe('Why sensitiveFields is absent, when they were requested.'),
});

type InquiryResult = z.infer<typeof OutputSchema>;
type InquiryRecord = Omit<InquiryResult, 'sensitiveFields' | 'sensitiveFieldsNote'>;
export type SensitiveFields = z.infer<typeof SensitiveFieldsSchema>;

interface InquiryQueryRow {
  inquiry_id: string;
  campus_id: string;
  stage: (typeof STAGES)[number];
  source: (typeof SOURCES)[number];
  // postgres.js deserializes timestamptz columns as Date, not string.
  created_at: Date;
  assigned_staff_name: string | null;
  first_name: string;
  last_name: string;
  entry_grade: string;
  entry_year: number;
  current_school: string | null;
  guardian_name: string;
  guardian_email: string;
  guardian_phone: string;
  preferred_language: string;
}

interface FollowupQueryRow {
  channel: (typeof CHANNELS)[number];
  note: string;
  created_at: Date;
  logged_by: string | null;
}

interface SensitiveQueryRow {
  date_of_birth: string;
  learning_support_notes: string | null;
  medical_notes: string | null;
}

/** The non-sensitive record, or undefined when the id doesn't exist or isn't on `campusId`. */
async function queryInquiry(tx: StaffTransaction, inquiryId: string, campusId: string): Promise<InquiryRecord | undefined> {
  const [inquiry] = await tx<InquiryQueryRow[]>`
    select
      i.id as inquiry_id,
      i.campus_id,
      i.stage,
      i.source,
      i.created_at,
      s.full_name as assigned_staff_name,
      a.first_name,
      a.last_name,
      a.entry_grade,
      a.entry_year,
      a.current_school,
      g.full_name as guardian_name,
      g.email as guardian_email,
      g.phone as guardian_phone,
      g.preferred_language
    from inquiries i
    join applicants a on a.id = i.applicant_id
    join guardians g on g.id = i.guardian_id
    left join staff s on s.id = i.assigned_staff_id
    where i.id = ${inquiryId}
      and i.campus_id = ${campusId}
  `;
  if (!inquiry) {
    return undefined;
  }

  const followups = await tx<FollowupQueryRow[]>`
    select f.channel, f.note, f.created_at, s.full_name as logged_by
    from followups f
    left join staff s on s.id = f.staff_id
    where f.inquiry_id = ${inquiryId}
    order by f.created_at desc
    limit 5
  `;

  return {
    inquiryId: inquiry.inquiry_id,
    campusId: inquiry.campus_id,
    stage: inquiry.stage,
    source: inquiry.source,
    createdAt: inquiry.created_at.toISOString(),
    assignedStaffName: inquiry.assigned_staff_name,
    applicant: {
      firstName: inquiry.first_name,
      lastName: inquiry.last_name,
      entryGrade: inquiry.entry_grade,
      entryYear: inquiry.entry_year,
      currentSchool: inquiry.current_school,
    },
    guardian: {
      fullName: inquiry.guardian_name,
      email: inquiry.guardian_email,
      phone: inquiry.guardian_phone,
      preferredLanguage: inquiry.preferred_language,
    },
    recentFollowups: followups.map((f) => ({
      channel: f.channel,
      note: f.note,
      loggedBy: f.logged_by,
      createdAt: f.created_at.toISOString(),
    })),
  };
}

/**
 * The applicant_private row for an inquiry. Callers check the role first;
 * RLS (applicant_private_campus_head) independently returns nothing to
 * anyone but the campus head of that campus.
 */
export async function querySensitiveFields(
  tx: StaffTransaction,
  inquiryId: string,
  campusId: string
): Promise<SensitiveFields | undefined> {
  // ::text keeps the date exact; a JS Date would shift it by the timezone.
  const [row] = await tx<SensitiveQueryRow[]>`
    select ap.date_of_birth::text as date_of_birth, ap.learning_support_notes, ap.medical_notes
    from inquiries i
    join applicant_private ap on ap.applicant_id = i.applicant_id
    where i.id = ${inquiryId}
      and i.campus_id = ${campusId}
  `;
  if (!row) {
    return undefined;
  }
  return {
    dateOfBirth: row.date_of_birth,
    learningSupportNotes: row.learning_support_notes,
    medicalNotes: row.medical_notes,
  };
}

type SensitiveSection =
  | { returned: false; output: { sensitiveFieldsNote?: string } }
  | { returned: true; output: { sensitiveFields: SensitiveFields } };

async function resolveSensitiveSection(
  tx: StaffTransaction,
  role: StaffRole,
  includeSensitive: boolean,
  inquiryId: string,
  campusId: string
): Promise<SensitiveSection> {
  if (!includeSensitive) {
    return { returned: false, output: {} };
  }
  if (role !== 'campus_head') {
    return { returned: false, output: { sensitiveFieldsNote: CAMPUS_HEAD_ONLY_NOTE } };
  }
  const sensitiveFields = await querySensitiveFields(tx, inquiryId, campusId);
  if (!sensitiveFields) {
    return { returned: false, output: { sensitiveFieldsNote: NO_SENSITIVE_RECORD_NOTE } };
  }
  return { returned: true, output: { sensitiveFields } };
}

function renderSensitive(result: InquiryResult): string[] {
  if (result.sensitiveFields) {
    const { dateOfBirth, learningSupportNotes, medicalNotes } = result.sensitiveFields;
    return [
      'SENSITIVE (campus head only):',
      `  Date of birth: ${dateOfBirth}`,
      `  Learning support notes: ${learningSupportNotes ?? 'none recorded'}`,
      `  Medical notes: ${medicalNotes ?? 'none recorded'}`,
    ];
  }
  return result.sensitiveFieldsNote ? [`Note: ${result.sensitiveFieldsNote}`] : [];
}

function renderResult(result: InquiryResult): string {
  const followupLines =
    result.recentFollowups.length === 0
      ? '  (no followups logged yet)'
      : result.recentFollowups.map((f) => `  - [${f.channel}] ${f.createdAt} by ${f.loggedBy ?? 'unknown'}: ${f.note}`).join('\n');

  return [
    `${result.applicant.firstName} ${result.applicant.lastName} (${result.applicant.entryGrade}, ${result.applicant.entryYear}) — campus: ${result.campusId}, stage: ${result.stage}, source: ${result.source}`,
    `Guardian: ${result.guardian.fullName} <${result.guardian.email}>, ${result.guardian.phone} (prefers ${result.guardian.preferredLanguage})`,
    `Assigned staff: ${result.assignedStaffName ?? 'unassigned'}`,
    `Created: ${result.createdAt}`,
    'Recent followups:',
    followupLines,
    ...renderSensitive(result),
  ].join('\n');
}

export function registerGetInquiryTool(server: McpServer, runToolCall: RunToolCall, staff: StaffContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Get inquiry',
      description:
        "Look up one admissions inquiry by id: applicant name, entry grade/year and current school; guardian name, email, phone and preferred language; stage, source, created date, assigned staff, and the 5 most recent followups. Sensitive child fields — date of birth, learning support notes and medical notes — are returned only when include_sensitive is true AND the caller is the campus_head of the inquiry's campus, in a separate sensitiveFields section. Set include_sensitive only when the user explicitly needs one of those fields (for example they ask about the child's age, medical needs or learning support); never request them by default or just in case. A counsellor who sets it gets the normal record plus a note that sensitive fields are available to the campus head only. A counsellor or campus_head can only see inquiries belonging to their own campus; a request for an inquiry that does not exist or belongs to another campus returns the same not-found message, so other campuses' records cannot be detected by probing ids. Leadership cannot use this tool — it returns a single individual record, which leadership must only see as aggregates.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async (args) =>
      runToolCall(TOOL_NAME, args, async (tx): Promise<ToolCallResult> => {
        const { inquiry_id: inquiryId, include_sensitive: includeSensitive } = args;

        if (staff.role === 'leadership') {
          return {
            outcome: 'denied',
            result: toolError(
              'Leadership accounts can only see aggregate data across campuses, never individual inquiry records. This tool returns a single inquiry record, so it is not available to leadership.'
            ),
          };
        }

        const campusId = staff.campusId;
        if (campusId === null) {
          throw new Error(`Staff ${staff.id} has role ${staff.role} but no campus_id`);
        }

        const inquiry = await queryInquiry(tx, inquiryId, campusId);
        if (!inquiry) {
          // Audited as denied: a missing id and another campus's id are
          // indistinguishable here by design, and probing is what audit is for.
          return { outcome: 'denied', result: toolError(NOT_FOUND_MESSAGE) };
        }

        const sensitive = await resolveSensitiveSection(tx, staff.role, includeSensitive, inquiryId, campusId);
        const result: InquiryResult = { ...inquiry, ...sensitive.output };

        return {
          outcome: 'ok',
          result: { content: [{ type: 'text', text: renderResult(result) }], structuredContent: result },
          resultCount: 1,
          sensitiveReturned: sensitive.returned,
        };
      })
  );
}
