import { z } from 'zod';
import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import type { RunAsStaff } from '../db/staff-transaction.js';
import type { StaffContext } from '../staff-context.js';
import type { Database } from '../db/types.js';

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

const NOT_FOUND_MESSAGE = 'Inquiry not found or not accessible.';

const InputSchema = z.object({
  inquiry_id: z.guid().describe('The inquiry id to look up.'),
});

const FollowupSchema = z.object({
  channel: z.enum(CHANNELS),
  note: z.string(),
  loggedBy: z.string().nullable(),
  createdAt: z.string(),
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
});

type InquiryResult = z.infer<typeof OutputSchema>;

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

function toolError(text: string): CallToolResult {
  return { content: [{ type: 'text', text }], isError: true };
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
  ].join('\n');
}

export function registerGetInquiryTool(server: McpServer, runAsStaff: RunAsStaff, staff: StaffContext): void {
  server.registerTool(
    'get_inquiry',
    {
      title: 'Get inquiry',
      description:
        "Look up one admissions inquiry by id: applicant details (non-sensitive only — no DOB, learning-support, or medical notes), guardian name/email/phone/preferred language, stage, source, created date, assigned staff, and the 5 most recent followups. A counsellor or campus_head can only see inquiries belonging to their own campus; a request for an inquiry that does not exist or belongs to another campus returns the same not-found message, so other campuses' records cannot be detected by probing ids. Leadership cannot use this tool — it returns a single individual record, which leadership must only see as aggregates.",
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    },
    async ({ inquiry_id }): Promise<CallToolResult> => {
      if (staff.role === 'leadership') {
        return toolError(
          'Leadership accounts can only see aggregate data across campuses, never individual inquiry records. This tool returns a single inquiry record, so it is not available to leadership.'
        );
      }

      const campusId = staff.campusId;
      if (campusId === null) {
        throw new Error(`Staff ${staff.id} has role ${staff.role} but no campus_id`);
      }

      // One transaction for both reads, so they run as the same identity
      // against the same snapshot.
      const { inquiry, followupRows } = await runAsStaff(async (tx) => {
        const rows = await tx<InquiryQueryRow[]>`
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
          where i.id = ${inquiry_id}
            and i.campus_id = ${campusId}
        `;

        const found = rows[0];
        if (!found) {
          return { inquiry: undefined, followupRows: [] };
        }

        const followups = await tx<FollowupQueryRow[]>`
          select f.channel, f.note, f.created_at, s.full_name as logged_by
          from followups f
          left join staff s on s.id = f.staff_id
          where f.inquiry_id = ${inquiry_id}
          order by f.created_at desc
          limit 5
        `;
        return { inquiry: found, followupRows: followups };
      });

      if (!inquiry) {
        return toolError(NOT_FOUND_MESSAGE);
      }

      const result: InquiryResult = {
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
        recentFollowups: followupRows.map((f) => ({
          channel: f.channel,
          note: f.note,
          loggedBy: f.logged_by,
          createdAt: f.created_at.toISOString(),
        })),
      };

      return {
        content: [{ type: 'text', text: renderResult(result) }],
        structuredContent: result,
      };
    }
  );
}
