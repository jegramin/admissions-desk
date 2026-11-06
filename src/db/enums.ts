import type { Database } from './types.js';

type Enums = Database['public']['Enums'];

/**
 * Runtime copies of the database enums, for zod schemas. `satisfies` keeps
 * each list a subset of the generated type; keep them in the enum's order.
 */
export const INQUIRY_STAGES = [
  'new',
  'contacted',
  'tour_booked',
  'applied',
  'assessment',
  'offered',
  'enrolled',
  'withdrawn',
  'lost',
] as const satisfies readonly Enums['inquiry_stage'][];

/**
 * Stages where an inquiry is finished, so going quiet is not staleness. The
 * pipeline_summary SQL function restates this list; keep the two in step.
 */
export const TERMINAL_STAGES = ['enrolled', 'withdrawn', 'lost'] as const satisfies readonly Enums['inquiry_stage'][];

export type TerminalStage = (typeof TERMINAL_STAGES)[number];

export function isTerminalStage(stage: Enums['inquiry_stage']): stage is TerminalStage {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export const INQUIRY_SOURCES = [
  'website',
  'referral',
  'walk_in',
  'agent',
  'event',
  'phone',
  'social_media',
] as const satisfies readonly Enums['inquiry_source'][];

export const FOLLOWUP_CHANNELS = ['email', 'phone', 'whatsapp', 'meeting'] as const satisfies readonly Enums['followup_channel'][];
