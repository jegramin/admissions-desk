import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunAsStaff } from '../src/db/staff-transaction.js';
import { CAMPUS_HEAD_ONLY_NOTE, NOT_FOUND_MESSAGE, querySensitiveFields } from '../src/tools/get-inquiry.js';
import { auditMarker, auditRowsSince } from './audit.js';
import { connectAsAdmin, connectAsApp, SEED_INQUIRY, SEED_STAFF } from './db.js';
import { connectMcpClient, textOf, type McpSession } from './mcp.js';

const app = connectAsApp();
const admin = connectAsAdmin();
let counsellor: McpSession;
let campusHead: McpSession;

interface ExpectedSensitive {
  dateOfBirth: string;
  learningSupportNotes: string | null;
  medicalNotes: string | null;
}
let expected: ExpectedSensitive;

beforeAll(async () => {
  counsellor = await connectMcpClient(app, SEED_STAFF.erbilCounsellor);
  campusHead = await connectMcpClient(app, SEED_STAFF.erbilCampusHead);

  const [row] = await admin<ExpectedSensitive[]>`
    select ap.date_of_birth::text as "dateOfBirth", ap.learning_support_notes as "learningSupportNotes",
           ap.medical_notes as "medicalNotes"
    from inquiries i join applicant_private ap on ap.applicant_id = i.applicant_id
    where i.id = ${SEED_INQUIRY.erbil}
  `;
  if (!row) {
    throw new Error(`Seed has no applicant_private row for inquiry ${SEED_INQUIRY.erbil}`);
  }
  expected = row;
});

afterAll(async () => {
  await Promise.all([counsellor.close(), campusHead.close()]);
  await Promise.all([app.end(), admin.end()]);
});

function getInquiry(session: McpSession, inquiryId: string, includeSensitive: boolean) {
  return session.client.callTool({
    name: 'get_inquiry',
    arguments: { inquiry_id: inquiryId, include_sensitive: includeSensitive },
  });
}

describe('get_inquiry sensitive fields', () => {
  it('counsellor asking for them gets the normal record and a note, and nothing sensitive leaves', async () => {
    const marker = await auditMarker(admin);
    const result = await getInquiry(counsellor, SEED_INQUIRY.erbil, true);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ inquiryId: SEED_INQUIRY.erbil, sensitiveFieldsNote: CAMPUS_HEAD_ONLY_NOTE });
    expect(result.structuredContent).not.toHaveProperty('sensitiveFields');
    expect(textOf(result)).not.toContain(expected.dateOfBirth);
    expect(textOf(result)).toContain(CAMPUS_HEAD_ONLY_NOTE);

    expect(await auditRowsSince(admin, marker)).toMatchObject([{ outcome: 'ok', sensitive_returned: false }]);
  });

  it('campus head not asking for them gets no sensitive fields and no note', async () => {
    const result = await getInquiry(campusHead, SEED_INQUIRY.erbil, false);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).not.toHaveProperty('sensitiveFields');
    expect(result.structuredContent).not.toHaveProperty('sensitiveFieldsNote');
    expect(textOf(result)).not.toContain(expected.dateOfBirth);
  });

  it('campus head asking for them on their own campus gets them, and the audit row says so', async () => {
    const marker = await auditMarker(admin);
    const result = await getInquiry(campusHead, SEED_INQUIRY.erbil, true);

    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ sensitiveFields: expected });
    expect(textOf(result)).toContain(`Date of birth: ${expected.dateOfBirth}`);

    expect(await auditRowsSince(admin, marker)).toMatchObject([
      {
        staff_id: SEED_STAFF.erbilCampusHead,
        tool_name: 'get_inquiry',
        arguments: { inquiry_id: SEED_INQUIRY.erbil, include_sensitive: true },
        outcome: 'ok',
        result_count: 1,
        sensitive_returned: true,
      },
    ]);
  });

  it('campus head asking for another campus’s inquiry gets not found', async () => {
    const result = await getInquiry(campusHead, SEED_INQUIRY.dubai, true);

    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(NOT_FOUND_MESSAGE);
    expect(result.structuredContent).toBeUndefined();
  });
});

describe('RLS backstop for sensitive fields', () => {
  // Calls the sensitive query directly, skipping the tool's role check, as
  // if that check had a bug. The database alone must refuse.
  it('returns no row to a counsellor', async () => {
    const asCounsellor = createRunAsStaff(app, SEED_STAFF.erbilCounsellor);
    expect(await asCounsellor((tx) => querySensitiveFields(tx, SEED_INQUIRY.erbil, 'erbil'))).toBeUndefined();
  });

  it('returns the row to the campus head (control)', async () => {
    const asCampusHead = createRunAsStaff(app, SEED_STAFF.erbilCampusHead);
    expect(await asCampusHead((tx) => querySensitiveFields(tx, SEED_INQUIRY.erbil, 'erbil'))).toEqual(expected);
  });
});
