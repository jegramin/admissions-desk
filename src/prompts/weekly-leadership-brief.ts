import { z } from 'zod';
import type { GetPromptResult, McpServer } from '@modelcontextprotocol/server';

const PROMPT_NAME = 'weekly_leadership_brief';

const MAX_BRIEF_WORDS = 200;
const REPLY_STANDARD_WORKING_DAYS = 3;

/**
 * pipeline_summary counts whole calendar days, but the standard is in
 * working days. Three working days span at most five calendar days (one
 * two-day weekend in between), so 6+ calendar days without contact has
 * missed the standard on every campus's working week. It undercounts: a
 * breach that falls inside a week with no weekend shows up a day or two late,
 * and public holidays are ignored.
 */
const STANDARD_BREACHED_CALENDAR_DAYS = 6;

const ArgsSchema = z.object({
  campus: z
    .string()
    .min(1)
    .optional()
    .describe("Campus id to brief on (e.g. 'erbil'). Omit for every campus combined."),
});

type BriefArgs = z.infer<typeof ArgsSchema>;

/** Instructions only: the prompt carries no data, so the model must get every number from pipeline_summary. */
function briefInstructions({ campus }: BriefArgs): string {
  const scope =
    campus === undefined
      ? 'Call pipeline_summary with no campus, so it covers every campus combined'
      : `Call pipeline_summary with campus "${campus}"`;

  return [
    `${scope}, and min_days_without_contact set to ${STANDARD_BREACHED_CALENDAR_DAYS}.`,
    '',
    'Then write a brief for senior leadership with these sections:',
    '1. Pipeline by stage: the inquiry count in each stage and the active total.',
    `2. Reply standard: families should get a reply within ${REPLY_STANDARD_WORKING_DAYS} working days. Report the stale count as active inquiries with no contact for ${STANDARD_BREACHED_CALENDAR_DAYS}+ calendar days, which have certainly missed that standard, and say it is a lower bound.`,
    '3. Risks: two or three, drawn only from the numbers returned.',
    '4. Suggested actions: one per risk.',
    '',
    'Rules:',
    `- Keep it under ${MAX_BRIEF_WORDS} words.`,
    '- Use only the counts pipeline_summary returns. Do not call any other tool and do not estimate or invent numbers.',
    '- Name no applicant, guardian or staff member, and include no inquiry ids or individual records.',
    '- If pipeline_summary returns an error, say the brief could not be produced and repeat the error. Do not write a brief without data.',
  ].join('\n');
}

export function registerWeeklyLeadershipBriefPrompt(server: McpServer): void {
  server.registerPrompt(
    PROMPT_NAME,
    {
      title: 'Weekly leadership brief',
      description: `A brief for senior leadership (under ${MAX_BRIEF_WORDS} words): pipeline by stage, inquiries past the ${REPLY_STANDARD_WORKING_DAYS}-working-day reply standard, risks and suggested actions. Built from pipeline_summary counts only, with no individual records.`,
      argsSchema: ArgsSchema,
    },
    (args): GetPromptResult => ({
      messages: [{ role: 'user', content: { type: 'text', text: briefInstructions(args) } }],
    })
  );
}
