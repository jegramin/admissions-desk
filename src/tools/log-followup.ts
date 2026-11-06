import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { FOLLOWUP_CHANNELS } from '../db/enums.js';
import type { StaffTransaction } from '../db/staff-transaction.js';
import type { StaffContext } from '../staff-context.js';
import { toolError, type RunToolCall, type ToolCallResult } from '../tool-call.js';
import { NOT_FOUND_MESSAGE } from './get-inquiry.js';

const TOOL_NAME = 'log_followup';

const MAX_NOTE_LENGTH = 1000;

type FollowupChannel = (typeof FOLLOWUP_CHANNELS)[number];

const InputSchema = z.object({
  inquiry_id: z.guid().describe('The inquiry the followup was about.'),
  channel: z.enum(FOLLOWUP_CHANNELS).describe('How the contact happened.'),
  note: z
    .string()
    .trim()
    .min(1)
    .max(MAX_NOTE_LENGTH)
    .describe(`What happened, in 1-${MAX_NOTE_LENGTH} characters. Visible to every counsellor and campus head on the campus.`),
});

const OutputSchema = z.object({
  followupId: z.guid(),
  inquiryId: z.guid(),
  applicantName: z.string(),
  channel: z.enum(FOLLOWUP_CHANNELS),
  loggedAt: z.string(),
  daysSinceContact: z.number().int().describe('The inquiry’s days since contact after this followup.'),
});

type LoggedFollowup = z.infer<typeof OutputSchema>;

interface InsertedRow {
  id: string;
  created_at: Date;
}

interface InquiryAfterRow {
  applicant_name: string;
  days_since_contact: number;
}

/**
 * Inserts the followup as `staffId`, or returns undefined when the inquiry
 * doesn't exist or isn't on `campusId`. The explicit campus filter means
 * another campus's id inserts nothing rather than tripping RLS; RLS
 * (followups_insert_as_self) independently refuses it if the filter is wrong.
 */
async function insertFollowup(
  tx: StaffTransaction,
  staffId: string,
  campusId: string,
  inquiryId: string,
  channel: FollowupChannel,
  note: string
): Promise<LoggedFollowup | undefined> {
  const [inserted] = await tx<InsertedRow[]>`
    insert into followups (inquiry_id, staff_id, channel, note)
    select i.id, ${staffId}, ${channel}, ${note}
    from inquiries i
    where i.id = ${inquiryId}
      and i.campus_id = ${campusId}
    returning id, created_at
  `;
  if (!inserted) {
    return undefined;
  }

  // Read back from inquiry_activity, the one definition of staleness.
  const [after] = await tx<InquiryAfterRow[]>`
    select a.first_name || ' ' || a.last_name as applicant_name, ia.days_since_contact
    from inquiry_activity ia
    join inquiries i on i.id = ia.inquiry_id
    join applicants a on a.id = i.applicant_id
    where ia.inquiry_id = ${inquiryId}
  `;
  if (!after) {
    throw new Error(`Inquiry ${inquiryId} accepted a followup but is not visible in inquiry_activity`);
  }

  return {
    followupId: inserted.id,
    inquiryId,
    applicantName: after.applicant_name,
    channel,
    loggedAt: inserted.created_at.toISOString(),
    daysSinceContact: after.days_since_contact,
  };
}

export function registerLogFollowupTool(server: McpServer, runToolCall: RunToolCall, staff: StaffContext): void {
  server.registerTool(
    TOOL_NAME,
    {
      title: 'Log followup',
      description:
        'Record a followup with an inquiry’s family that has ALREADY happened — a call made, an email or WhatsApp message sent, a meeting held — as the acting staff member. This tool sends nothing and contacts no one; it only writes the record. Call it only after the user has confirmed the followup actually took place, never to plan, draft or schedule contact. Each call adds a new followup, so do not retry a call that succeeded. Returns a confirmation with the inquiry’s new days since contact. A counsellor or campus_head can only log followups for inquiries on their own campus; an inquiry that does not exist or belongs to another campus returns the same not-found message. Leadership cannot use this tool.',
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ inquiry_id: inquiryId, channel, note }) =>
      // The note is deliberately not audited: it is free text that may hold
      // personal details. The followups row itself is the record of it.
      runToolCall(TOOL_NAME, { inquiry_id: inquiryId, channel }, async (tx): Promise<ToolCallResult> => {
        if (staff.role === 'leadership') {
          return {
            outcome: 'denied',
            result: toolError(
              'Leadership accounts cannot log followups: they work with aggregate data only and have no access to individual inquiries.'
            ),
          };
        }

        const campusId = staff.campusId;
        if (campusId === null) {
          throw new Error(`Staff ${staff.id} has role ${staff.role} but no campus_id`);
        }

        const logged = await insertFollowup(tx, staff.id, campusId, inquiryId, channel, note);
        if (!logged) {
          return { outcome: 'denied', result: toolError(NOT_FOUND_MESSAGE) };
        }

        const text = `Logged a ${logged.channel} followup for ${logged.applicantName} (${logged.inquiryId}) at ${logged.loggedAt}. Days since contact is now ${logged.daysSinceContact}.`;
        return {
          outcome: 'ok',
          result: { content: [{ type: 'text', text }], structuredContent: logged },
          resultCount: 1,
          sensitiveReturned: false,
        };
      })
  );
}
