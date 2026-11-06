import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRunAsStaff } from '../src/db/staff-transaction.js';
import { queryStaleInquiries } from '../src/tools/find-stale-inquiries.js';
import { connectAsAdmin, connectAsApp } from './db.js';

// Regression test for "more than / at least N days" disagreeing with the
// number reported. Fixtures sit at N days + 12 hours since last contact, so
// floor(elapsed days) is exactly N however long the test takes and whatever
// the time of day; nothing is near a whole-day boundary.
//
// Isolated in its own campus so the seeded Erbil/Dubai/Vienna rows can't
// affect the result. The global setup resets to seed state afterwards.

const CAMPUS_ID = 'regression-stale';
const COUNSELLOR_ID = '00000000-0000-0000-0090-000000000001';
const HOURS_PAST_WHOLE_DAY = 12;
const MIN_DAYS = 5;

const fixtureId = (table: number, days: number) => `00000000-0000-0000-009${table}-${String(days).padStart(12, '0')}`;
const FIXTURE_DAYS = [4, 5, 6] as const;
const inquiryIdFor = (days: number) => fixtureId(3, days);

const app = connectAsApp();
const admin = connectAsAdmin();

beforeAll(async () => {
  await admin.begin(async (tx) => {
    await tx`
      insert into campuses (id, name, city, country, timezone)
      values (${CAMPUS_ID}, 'Regression campus', 'Nowhere', 'Nowhere', 'UTC')
    `;
    await tx`
      insert into staff (id, full_name, email, role, campus_id)
      values (${COUNSELLOR_ID}, 'Regression Counsellor', 'regression.counsellor@example.com', 'counsellor', ${CAMPUS_ID})
    `;

    for (const days of FIXTURE_DAYS) {
      await tx`
        insert into guardians (id, full_name, email, phone, preferred_language)
        values (${fixtureId(1, days)}, ${`Guardian ${days}d`}, ${`guardian.${days}d@example.com`}, '+1-555-0199', 'English')
      `;
      await tx`
        insert into applicants (id, guardian_id, first_name, last_name, entry_grade, entry_year)
        values (${fixtureId(2, days)}, ${fixtureId(1, days)}, 'Applicant', ${`${days}d`}, 'Grade 1', 2027)
      `;
      await tx`
        insert into inquiries (id, campus_id, applicant_id, guardian_id, assigned_staff_id, source, stage, created_at)
        values (${inquiryIdFor(days)}, ${CAMPUS_ID}, ${fixtureId(2, days)}, ${fixtureId(1, days)},
                ${COUNSELLOR_ID}, 'website', 'contacted', now() - interval '30 days')
      `;
      await tx`
        insert into followups (id, inquiry_id, staff_id, channel, note, created_at)
        values (${fixtureId(4, days)}, ${inquiryIdFor(days)}, ${COUNSELLOR_ID}, 'email', 'Regression fixture',
                now() - make_interval(days => ${days}, hours => ${HOURS_PAST_WHOLE_DAY}))
      `;
    }
  });
});

afterAll(async () => {
  await Promise.all([app.end(), admin.end()]);
});

describe('find_stale_inquiries staleness threshold', () => {
  it(`min_days_without_contact=${MIN_DAYS} includes ${MIN_DAYS} and ${MIN_DAYS + 1} days, excludes ${MIN_DAYS - 1}`, async () => {
    const rows = await createRunAsStaff(app, COUNSELLOR_ID)((tx) => queryStaleInquiries(tx, CAMPUS_ID, MIN_DAYS));

    // Exact ids *and* the reported day count, most stale first: an exclusive
    // comparison drops the 5-day row, and a calendar-date count reports a
    // different number than the filter used.
    expect(rows.map((r) => [r.inquiryId, r.daysSinceContact])).toEqual([
      [inquiryIdFor(6), 6],
      [inquiryIdFor(5), 5],
    ]);
  });
});
