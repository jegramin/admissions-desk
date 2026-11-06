import { readFile } from 'node:fs/promises';
import { ResourceNotFoundError, ResourceTemplate, type McpServer, type ReadResourceResult } from '@modelcontextprotocol/server';

const RESOURCE_NAME = 'admissions_policy';
const URI_TEMPLATE = 'admissions://policy/{campus}';
const MIME_TYPE = 'text/markdown';

/**
 * One markdown file per campus, in content/policy/. The ids match the
 * campuses table. This list is deliberately not read from the database:
 * policy reads are not tool calls, so they never open a staff transaction.
 */
const POLICY_CAMPUSES = {
  erbil: 'Aldermoor Erbil',
  dubai: 'Aldermoor Dubai',
  vienna: 'Aldermoor Vienna',
} as const;

type PolicyCampus = keyof typeof POLICY_CAMPUSES;

// Resolved from this module, so it works from both src/ and dist/: each is
// one level below the repo root, and content/ sits at the root.
const POLICY_DIR = new URL('../../content/policy/', import.meta.url);

function isPolicyCampus(value: string): value is PolicyCampus {
  return Object.hasOwn(POLICY_CAMPUSES, value);
}

function policyUri(campus: string): string {
  return URI_TEMPLATE.replace('{campus}', campus);
}

async function readPolicy(uri: URL, campus: PolicyCampus): Promise<ReadResourceResult> {
  const text = await readFile(new URL(`${campus}.md`, POLICY_DIR), 'utf8');
  return { contents: [{ uri: uri.href, mimeType: MIME_TYPE, text }] };
}

/**
 * Each campus's admissions policy: intake dates, grades, fee ranges,
 * required documents and the reply standard. Not sensitive, so it is
 * readable by every role and, not being a tool call, not audited.
 */
export function registerAdmissionsPolicyResource(server: McpServer): void {
  const template = new ResourceTemplate(URI_TEMPLATE, {
    list: () => ({
      resources: Object.entries(POLICY_CAMPUSES).map(([campus, campusName]) => ({
        uri: policyUri(campus),
        name: `${RESOURCE_NAME}_${campus}`,
        title: `${campusName} admissions policy`,
        mimeType: MIME_TYPE,
      })),
    }),
  });

  server.registerResource(
    RESOURCE_NAME,
    template,
    {
      title: 'Admissions policy',
      description:
        'A campus’s admissions policy (fictional demo content): intake dates, grades offered, annual fee ranges, required documents, and the standard that families get a reply within 3 working days. {campus} is a campus id: erbil, dubai or vienna.',
      mimeType: MIME_TYPE,
    },
    async (uri, variables) => {
      const campus = variables['campus'];
      if (typeof campus !== 'string' || !isPolicyCampus(campus)) {
        const known = Object.keys(POLICY_CAMPUSES).join(', ');
        throw new ResourceNotFoundError(
          uri.href,
          `No admissions policy for campus "${String(campus)}". Known campuses: ${known}. Use a URI like ${policyUri('erbil')}.`
        );
      }
      return readPolicy(uri, campus);
    }
  );
}
