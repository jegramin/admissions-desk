// Deterministic generator for supabase/seed.sql.
//
// This file is NOT part of the app and is not run by `supabase db reset` —
// it's run once, by hand, and its stdout is committed as seed.sql. That
// keeps the committed seed fully static (no random(), no now()-dependent
// branching logic) while avoiding ~300 hand-typed INSERT rows that would be
// tedious to review and easy to get subtly wrong.
//
// Run from the repo root: node supabase/generate-seed.mjs > supabase/seed.sql
//
// Every name is invented. Surnames are common ones belonging to no ruling or
// political family, and no full name or school name should match a
// well-known real person or school.

const pad = (n, width) => String(n).padStart(width, '0');
const pad2 = (n) => String(n).padStart(2, '0');

const staffId = (n) => `00000000-0000-0000-0000-${pad(n, 12)}`;
const guardianId = (n) => `00000000-0000-0000-0001-${pad(n, 12)}`;
const applicantId = (n) => `00000000-0000-0000-0002-${pad(n, 12)}`;
const inquiryId = (n) => `00000000-0000-0000-0003-${pad(n, 12)}`;
const followupId = (n) => `00000000-0000-0000-0004-${pad(n, 12)}`;

const sqlStr = (s) => (s === null ? 'null' : `'${String(s).replace(/'/g, "''")}'`);

const CAMPUSES = [
  { id: 'erbil', name: 'Aldermoor Erbil', city: 'Erbil', country: 'Iraq', timezone: 'Asia/Baghdad' },
  { id: 'dubai', name: 'Aldermoor Dubai', city: 'Dubai', country: 'United Arab Emirates', timezone: 'Asia/Dubai' },
  { id: 'vienna', name: 'Aldermoor Vienna', city: 'Vienna', country: 'Austria', timezone: 'Europe/Vienna' },
];

// Fixed staff: 1 counsellor + 1 campus_head per campus, plus 2 leadership.
const STAFF = [
  { n: 1, full_name: 'Lana Hussein', email: 'lana.hussein@example.com', role: 'counsellor', campus_id: 'erbil' },
  { n: 2, full_name: 'Darin Saleh', email: 'darin.saleh@example.com', role: 'campus_head', campus_id: 'erbil' },
  { n: 3, full_name: 'Fatima Al Suwaidi', email: 'fatima.alsuwaidi@example.com', role: 'counsellor', campus_id: 'dubai' },
  { n: 4, full_name: 'Omar Al Farsi', email: 'omar.alfarsi@example.com', role: 'campus_head', campus_id: 'dubai' },
  { n: 5, full_name: 'Lena Gruber', email: 'lena.gruber@example.com', role: 'counsellor', campus_id: 'vienna' },
  { n: 6, full_name: 'Markus Weber', email: 'markus.weber@example.com', role: 'campus_head', campus_id: 'vienna' },
  { n: 7, full_name: 'Nadia Rahimi', email: 'nadia.rahimi@example.com', role: 'leadership', campus_id: null },
  { n: 8, full_name: 'Thomas Becker', email: 'thomas.becker@example.com', role: 'leadership', campus_id: null },
];

const COUNSELLOR_OF = { erbil: 1, dubai: 3, vienna: 5 };
const CAMPUS_HEAD_OF = { erbil: 2, dubai: 4, vienna: 6 };

const GUARDIAN_FIRST = [
  'Amina', 'Karim', 'Sofia', 'Noah', 'Layla', 'Elias', 'Mariam', 'Yusuf', 'Hana', 'Daniel',
  'Zara', 'Felix', 'Noor', 'Jonas', 'Rania', 'Lukas', 'Dina', 'Sebastian', 'Farah', 'Anna',
  'Tariq', 'Clara', 'Samir', 'Julia', 'Rawan', 'Matteo', 'Salma', 'Paul', 'Yasmin', 'Niklas',
];

const LAST_NAMES = [
  'Aziz', 'Hoffmann', 'Al Mansoori', 'Novak', 'Rahman', 'Steiner', 'Khalil', 'Fischer',
  'Haddad', 'Berger', 'Al Hammadi', 'Wagner', 'Jabbar', 'Huber', 'Al Dhaheri', 'Mayer',
  'Saleem', 'Gruber', 'Al Ali', 'Winkler', 'Osman', 'Bauer', 'Al Zaabi', 'Lang',
  'Mahmoud', 'Pichler', 'Al Obaidi', 'Moser', 'Kareem', 'Wolf',
];

const CHILD_FIRST = [
  'Zayd', 'Mila', 'Adam', 'Lea', 'Rayan', 'Emma', 'Amir', 'Nora', 'Ali', 'Sophie',
  'Yara', 'Ben', 'Dana', 'Finn', 'Sara', 'Elif', 'Maya', 'Jakob', 'Rana', 'Jana',
  'Omar', 'Lia', 'Khalid', 'Ida', 'Hassan', 'Marie', 'Ibrahim', 'Greta', 'Musa', 'Tara',
];

const LANGUAGES = ['English', 'Arabic', 'German', 'Kurdish', 'French', 'Spanish'];

const GRADES = [
  'KG1', 'KG2', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6',
  'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12',
];

const SCHOOLS = [
  'Brindlecombe International Primary', 'Corvane British School', 'Thistlemere Montessori',
  'Quillbourne Academy', 'Fennowick International School', 'Harrowgill Primary',
];

// index 0,3,5 -> null (no note); 1,2,4 -> a mild, generic note
const LEARNING_SUPPORT_NOTES = [
  null,
  'Benefits from extra time on written tasks.',
  'Receiving mild speech and language support.',
  null,
  'Mild dyslexia; uses audiobooks for reading.',
  null,
];

// mostly null; indices 4,5 -> a mild, generic note
const MEDICAL_NOTES = [
  null, null, null, null,
  'Mild seasonal allergies.',
  'Carries own epinephrine auto-injector for nut allergy.',
];

const SOURCES = ['website', 'referral', 'walk_in', 'agent', 'event', 'phone', 'social_media'];

const STAGES = [
  'new', 'contacted', 'tour_booked', 'applied', 'assessment', 'offered', 'enrolled', 'withdrawn', 'lost',
];

// Followup histories are built from the funnel, not drawn at random: each
// stage's history is the previous stage's plus one milestone, so the latest
// followup always explains the inquiry's current stage. Each milestone has a
// few interchangeable wordings, picked by inquiry number for variety.
const FUNNEL_MILESTONES = [
  [ // initial contact
    { channel: 'phone', note: 'Called to introduce the school and answer initial questions.' },
    { channel: 'email', note: 'Replied to the inquiry with a welcome email and campus brochure.' },
    { channel: 'whatsapp', note: 'Sent a WhatsApp introduction; family confirmed their interest.' },
  ],
  [ // tour booking
    { channel: 'whatsapp', note: 'Sent the tour booking link; family booked a campus tour.' },
    { channel: 'email', note: 'Confirmed the campus tour date and time by email.' },
    { channel: 'phone', note: 'Booked a campus tour by phone.' },
  ],
  [ // application received
    { channel: 'email', note: 'Application form and supporting documents received.' },
    { channel: 'meeting', note: 'Toured campus with the family; they submitted their application afterwards.' },
  ],
  [ // assessment scheduled
    { channel: 'email', note: 'Entry assessment scheduled; date confirmed with the family.' },
    { channel: 'phone', note: 'Called to schedule the entry assessment.' },
  ],
  [ // offer sent
    { channel: 'email', note: 'Offer letter sent following the assessment review.' },
    { channel: 'meeting', note: 'Met the family to discuss assessment results and present the offer.' },
  ],
  [ // offer accepted / enrolment confirmed
    { channel: 'email', note: 'Offer accepted; enrolment confirmed and deposit received.' },
    { channel: 'meeting', note: 'Enrolment meeting held; offer accepted and registration completed.' },
  ],
];

// How many funnel milestones an inquiry at each active/enrolled stage has
// reached. withdrawn/lost are handled separately: some funnel progress, then
// a closing followup that says why.
const MILESTONES_REACHED = {
  new: 0, contacted: 1, tour_booked: 2, applied: 3, assessment: 4, offered: 5, enrolled: 6,
};

const CLOSING_FOLLOWUPS = {
  withdrawn: [
    { channel: 'email', note: 'Family withdrew the application: relocating to another country.' },
    { channel: 'phone', note: 'Family called to withdraw; they have decided to defer entry by a year.' },
    { channel: 'email', note: 'Family withdrew: the daily commute to campus proved too long.' },
  ],
  lost: [
    { channel: 'phone', note: 'Family accepted a place at another school; closed as lost.' },
    { channel: 'email', note: 'Family found the fees outside their budget; closed as lost.' },
    { channel: 'phone', note: 'Family chose a school closer to home; closed as lost.' },
  ],
};

const lines = [];
const say = (s) => lines.push(s);

say('-- Admissions Desk — seed data (generated, see generate-seed.mjs)');
say('--');
say('-- All names, emails, and phone numbers below are invented for this demo.');
say('-- Emails use @example.com; phone numbers use the +1-555-01xx block reserved');
say('-- for fictional use. Timestamps are relative to now() so the demo data');
say("-- never goes stale, and the generator is deterministic so re-running it");
say('-- produces identical output.');
say('');

// Campuses ----------------------------------------------------------------
say('insert into campuses (id, name, city, country, timezone) values');
say(
  CAMPUSES.map(
    (c, i) =>
      `  (${sqlStr(c.id)}, ${sqlStr(c.name)}, ${sqlStr(c.city)}, ${sqlStr(c.country)}, ${sqlStr(c.timezone)})` +
      (i === CAMPUSES.length - 1 ? ';' : ',')
  ).join('\n')
);
say('');

// Staff ---------------------------------------------------------------------
say('insert into staff (id, full_name, email, role, campus_id) values');
say(
  STAFF.map(
    (s, i) =>
      `  (${sqlStr(staffId(s.n))}, ${sqlStr(s.full_name)}, ${sqlStr(s.email)}, ${sqlStr(s.role)}, ${sqlStr(s.campus_id)})` +
      (i === STAFF.length - 1 ? ';' : ',')
  ).join('\n')
);
say('');

// Per-campus inquiry plan ----------------------------------------------------
// i = 0..19 within each campus. stage cycles through all 9 stages twice+,
// guaranteeing >=5 distinct stages per campus (all 9 appear, in fact).
const stageFor = (i) => STAGES[i % STAGES.length];

const pick = (variants, k) => variants[k % variants.length];

// The followups an inquiry has had, oldest first, as { channel, note, isClosing }.
function followupHistoryFor(stage, n) {
  if (stage === 'withdrawn' || stage === 'lost') {
    // Withdrawn families got as far as an offer at most; lost ones dropped
    // out before applying or during assessment.
    const reached = stage === 'withdrawn' ? 1 + (n % 5) : 1 + (n % 4);
    const funnel = FUNNEL_MILESTONES.slice(0, reached).map((variants) => pick(variants, n));
    return [...funnel, { ...pick(CLOSING_FOLLOWUPS[stage], n), isClosing: true }];
  }
  return FUNNEL_MILESTONES.slice(0, MILESTONES_REACHED[stage]).map((variants, step) => ({
    ...pick(variants, n),
    isClosing: stage === 'enrolled' && step === FUNNEL_MILESTONES.length - 1,
  }));
}

// How many days ago the inquiry was last touched: the latest followup, or
// created_at for a never-contacted (stage 'new') inquiry. This is what
// inquiry_activity.days_since_contact reports, so it carries the demo
// guarantees:
//   - erbil i=0..5 (stages new..offered): exactly 6..11 days — the required
//     "6 active Erbil inquiries stale for more than 5 days" bucket
//   - every other active Erbil inquiry: 1..4 days, so that bucket stays
//     exactly six
//   - dubai/vienna i=0 (stage new): 14 days — stale and never contacted
//   - every stage 'new' inquiry has no followups — the never-contacted bucket
//   - enrolled / withdrawn / lost: weeks old, but terminal, so never stale
function lastTouchDaysAgoFor(campusId, i, n, stage) {
  if (campusId === 'erbil' && i <= 5) return 6 + i;
  if (stage === 'new' && i === 0) return 14;
  if (stage === 'enrolled') return 15;
  if (stage === 'withdrawn' || stage === 'lost') return 28 + (n % 10);
  return (n % 4) + 1;
}

// Lays the history out backwards from the last touch: followups a few days
// apart, and the inquiry created a day or two before the first one. Whole
// days only, so days_since_contact is exact.
function timelineFor(campusId, i, n, stage) {
  const lastTouch = lastTouchDaysAgoFor(campusId, i, n, stage);
  const history = followupHistoryFor(stage, n);
  if (history.length === 0) return { createdDaysAgo: lastTouch, followups: [] };

  const gapDays = 3 + (n % 3);
  const followups = history.map((followup, idx) => ({
    ...followup,
    daysAgo: lastTouch + (history.length - 1 - idx) * gapDays,
  }));
  const firstFollowupDaysAgo = lastTouch + (history.length - 1) * gapDays;
  return { createdDaysAgo: firstFollowupDaysAgo + 1 + (n % 2), followups };
}

const guardianRows = [];
const applicantRows = [];
const applicantPrivateRows = [];
const inquiryRows = [];
const followupRows = [];

let followupCounter = 0;

CAMPUSES.forEach((campus, campusIdx) => {
  for (let i = 0; i < 20; i++) {
    const n = campusIdx * 20 + i + 1; // 1..60, globally unique
    const gId = guardianId(n);
    const aId = applicantId(n);
    const iqId = inquiryId(n);

    // Different strides per field so (first, last, child-first) triples
    // don't repeat in lockstep every 30 rows.
    const firstName = GUARDIAN_FIRST[n % GUARDIAN_FIRST.length];
    const lastName = LAST_NAMES[(n * 7) % LAST_NAMES.length];
    const childFirst = CHILD_FIRST[(n * 13) % CHILD_FIRST.length];
    const phone = `+1-555-01${pad2(n % 100)}`;
    const language = LANGUAGES[n % LANGUAGES.length];

    guardianRows.push(
      `  (${sqlStr(gId)}, ${sqlStr(`${firstName} ${lastName}`)}, ${sqlStr(
        `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s+/g, '')}${n}@example.com`
      )}, ${sqlStr(phone)}, ${sqlStr(language)})`
    );

    const gradeIdx = n % GRADES.length;
    const grade = GRADES[gradeIdx];
    const entryYear = 2027 + (n % 2); // upcoming intakes: 2027 or 2028
    const isEarlyYears = gradeIdx <= 1; // KG1 / KG2 -> not yet in a school
    const currentSchool = isEarlyYears ? null : SCHOOLS[n % SCHOOLS.length];

    applicantRows.push(
      `  (${sqlStr(aId)}, ${sqlStr(gId)}, ${sqlStr(childFirst)}, ${sqlStr(lastName)}, ${sqlStr(grade)}, ${entryYear}, ${sqlStr(currentSchool)})`
    );

    const approxAge = 4 + gradeIdx; // KG1 ~ 4yo .. Grade 12 ~ 17yo
    const birthYear = entryYear - approxAge;
    const birthMonth = pad2((n % 12) + 1);
    const birthDay = pad2((n % 28) + 1);
    const dob = `${birthYear}-${birthMonth}-${birthDay}`;
    const learningNote = LEARNING_SUPPORT_NOTES[n % LEARNING_SUPPORT_NOTES.length];
    const medicalNote = MEDICAL_NOTES[n % MEDICAL_NOTES.length];

    applicantPrivateRows.push(
      `  (${sqlStr(aId)}, ${sqlStr(dob)}, ${sqlStr(learningNote)}, ${sqlStr(medicalNote)})`
    );

    const stage = stageFor(i);
    const source = SOURCES[n % SOURCES.length];
    const escalated = stage === 'enrolled' || stage === 'withdrawn' || stage === 'lost';
    const assignedStaffN = escalated ? CAMPUS_HEAD_OF[campus.id] : COUNSELLOR_OF[campus.id];
    const assignedStaffId = staffId(assignedStaffN);

    const timeline = timelineFor(campus.id, i, n, stage);

    inquiryRows.push(
      `  (${sqlStr(iqId)}, ${sqlStr(campus.id)}, ${sqlStr(aId)}, ${sqlStr(gId)}, ${sqlStr(assignedStaffId)}, ${sqlStr(source)}, ${sqlStr(stage)}, now() - interval '${timeline.createdDaysAgo} days')`
    );

    // The counsellor works the funnel; the closing followup on an escalated
    // inquiry is logged by the campus head it was escalated to.
    const counsellorId = staffId(COUNSELLOR_OF[campus.id]);
    timeline.followups.forEach(({ channel, note, isClosing, daysAgo }) => {
      followupCounter += 1;
      const loggedBy = isClosing ? assignedStaffId : counsellorId;
      followupRows.push(
        `  (${sqlStr(followupId(followupCounter))}, ${sqlStr(iqId)}, ${sqlStr(loggedBy)}, ${sqlStr(channel)}, ${sqlStr(note)}, now() - interval '${daysAgo} days')`
      );
    });
  }
});

const block = (header, columns, rows) => {
  say(`insert into ${header} (${columns}) values`);
  say(rows.map((r, i) => r + (i === rows.length - 1 ? ';' : ',')).join('\n'));
  say('');
};

block('guardians', 'id, full_name, email, phone, preferred_language', guardianRows);
block('applicants', 'id, guardian_id, first_name, last_name, entry_grade, entry_year, current_school', applicantRows);
block('applicant_private', 'applicant_id, date_of_birth, learning_support_notes, medical_notes', applicantPrivateRows);
block('inquiries', 'id, campus_id, applicant_id, guardian_id, assigned_staff_id, source, stage, created_at', inquiryRows);
block('followups', 'id, inquiry_id, staff_id, channel, note, created_at', followupRows);

process.stdout.write(lines.join('\n') + '\n');
