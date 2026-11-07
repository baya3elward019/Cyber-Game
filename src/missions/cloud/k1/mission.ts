import type { MissionDef, Feedback } from '../../types';
import { Shell, type Command } from '../../../terminals/linux/shell';
import { coreCommands, makeHelp } from '../../../terminals/linux/commands';
import { VirtualFS } from '../../../terminals/linux/vfs';

/** K1 — Exposed storage bucket. A fictional cloud ("NexusCloud") with an AWS-like CLI. */

interface Bucket { name: string; created: string; region: string; policyPublic: boolean; blockAll: boolean; encrypted: boolean; objects: [string, number, string][] }

export const LEAKY = 'hr-exports-2026';
export const WEBSITE = 'nexus-website-assets';

export function buildBuckets(): Bucket[] {
  return [
    { name: WEBSITE, created: '2024-02-11 09:14:02', region: 'me-central-1', policyPublic: true, blockAll: false, encrypted: true,
      objects: [['index.html', 18234, '2026-10-01'], ['css/site.css', 9411, '2026-10-01'], ['img/logo.svg', 4410, '2025-06-12'], ['img/campus.jpg', 512033, '2025-06-12']] },
    { name: LEAKY, created: '2026-09-28 16:40:51', region: 'me-central-1', policyPublic: true, blockAll: false, encrypted: false,
      objects: [['payroll_2026_q3.csv', 88412, '2026-10-02'], ['employee_ids_full.xlsx', 230118, '2026-10-02'], ['bank_details_export.csv', 41290, '2026-10-02']] },
    { name: 'nexus-app-logs', created: '2023-11-05 11:02:17', region: 'me-central-1', policyPublic: false, blockAll: true, encrypted: true,
      objects: [['2026/11/05/app-01.log.gz', 1840221, '2026-11-05'], ['2026/11/06/app-01.log.gz', 1204411, '2026-11-06']] },
  ];
}

export const isPublic = (b: Bucket) => b.policyPublic && !b.blockAll;

export function k1Status(buckets: Bucket[], found: boolean): Record<string, boolean> {
  const leak = buckets.find((b) => b.name === LEAKY)!;
  const web = buckets.find((b) => b.name === WEBSITE)!;
  return { find: found, private: !isPublic(leak), encrypt: leak.encrypted, website: isPublic(web) };
}

const CLI_HELP = `usage: nxcloud storage <command> [args]

commands:
  ls                                     list buckets
  ls <bucket>                            list objects in a bucket
  get-bucket-policy <bucket>             show the bucket policy (who can read)
  get-public-access-block <bucket>       show public access block settings
  get-encryption <bucket>                show default encryption
  put-public-access-block <bucket> --block-all
  delete-bucket-policy <bucket>
  put-encryption <bucket> --algorithm AES256
`;

export const missionK1: MissionDef = {
  id: 'k1', lab: 'cloud', order: 1, baseXp: 300, hintCount: 3, parTime: 300,
  createSession() {
    const buckets = buildBuckets();
    let found = false;
    let feedback: Feedback | null = null;
    const get = (n?: string) => buckets.find((b) => b.name === n);
    const noBucket = (n?: string) => ({ out: n ? `An error occurred (NoSuchBucket): The specified bucket does not exist: ${n}\n` : CLI_HELP, code: n ? 254 : 2 });

    const nxcloud: Command = (args) => {
      if (args[0] !== 'storage') return { out: args[0] === 'help' || !args[0] ? CLI_HELP : `nxcloud: unknown service '${args[0]}'. Try: nxcloud help\n`, code: args[0] ? 2 : 0 };
      const [, cmd, name, ...rest] = args;
      const b = get(name);
      switch (cmd) {
        case 'ls':
          if (!name) return { out: buckets.map((x) => `${x.created}  ${x.name}`).join('\n') + '\n', code: 0 };
          if (!b) return noBucket(name);
          return { out: b.objects.map(([k, size, d]) => `${d} 10:00:00 ${String(size).padStart(10)} ${k}`).join('\n') + '\n', code: 0 };
        case 'get-bucket-policy':
          if (!b) return noBucket(name);
          if (!b.policyPublic) return { out: 'An error occurred (NoSuchBucketPolicy): The bucket policy does not exist\n', code: 254 };
          return { out: JSON.stringify({ Version: '2012-10-17', Statement: [{ Sid: 'PublicRead', Effect: 'Allow', Principal: '*', Action: 'storage:GetObject', Resource: `nrn:storage:::${b.name}/*` }] }, null, 2) + '\n', code: 0 };
        case 'get-public-access-block':
          if (!b) return noBucket(name);
          return { out: JSON.stringify({ PublicAccessBlockConfiguration: { BlockPublicAcls: b.blockAll, IgnorePublicAcls: b.blockAll, BlockPublicPolicy: b.blockAll, RestrictPublicBuckets: b.blockAll } }, null, 2) + '\n', code: 0 };
        case 'get-encryption':
          if (!b) return noBucket(name);
          if (!b.encrypted) return { out: 'An error occurred (ServerSideEncryptionConfigurationNotFoundError): The server side encryption configuration was not found\n', code: 254 };
          return { out: JSON.stringify({ Rules: [{ ApplyServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] }, null, 2) + '\n', code: 0 };
        case 'put-public-access-block':
          if (!b) return noBucket(name);
          if (!rest.includes('--block-all')) return { out: 'error: missing --block-all\n', code: 2 };
          b.blockAll = true;
          feedback = b.name === WEBSITE ? { ok: false, key: 'fb.k1.websiteDown' } : b.name === LEAKY ? { ok: true, key: 'fb.k1.private' } : null;
          return { out: '', code: 0 };
        case 'delete-bucket-policy':
          if (!b) return noBucket(name);
          b.policyPublic = false;
          feedback = b.name === WEBSITE ? { ok: false, key: 'fb.k1.websiteDown' } : b.name === LEAKY ? { ok: true, key: 'fb.k1.private' } : null;
          return { out: '', code: 0 };
        case 'put-encryption':
          if (!b) return noBucket(name);
          if (!/AES256|aws:kms|nx:kms/.test(rest.join(' '))) return { out: 'error: --algorithm AES256 is required\n', code: 2 };
          b.encrypted = true;
          if (b.name === LEAKY) feedback = { ok: true, key: 'fb.k1.encrypted' };
          return { out: '', code: 0 };
      }
      return { out: CLI_HELP, code: 2 };
    };

    const fs = new VirtualFS({
      '/home/cloudops/ticket.txt': { owner: 'cloudops', content: `TICKET SEC-1187 — priority HIGH
Reported by: external security researcher (responsible disclosure)

"One of your storage buckets is readable by anyone on the internet and
 contains what looks like employee personal and salary data."

Tasks:
 1. Find the exposed bucket and record it:   submit bucket <name>
 2. Make it private.
 3. Turn on default encryption for it.
 4. Do NOT break the public company website — it is served from storage.

Use the CLI:  nxcloud storage ls   (help: nxcloud help)
` },
    });
    const commands: Record<string, Command> = {
      ...coreCommands,
      help: makeHelp('  nxcloud   NexusCloud CLI (try: nxcloud help)\n  submit bucket <name>   record the exposed bucket in the ticket\n'),
      nxcloud,
      submit: (args) => {
        if (args[0] !== 'bucket' || !args[1]) return { out: 'usage: submit bucket <name>\n', code: 2 };
        if (args[1] === LEAKY) { found = true; feedback = { ok: true, key: 'fb.k1.found' }; return { out: `[ticket SEC-1187] exposed bucket recorded: ${args[1]}  ✔ accepted\n`, code: 0 }; }
        feedback = { ok: false, key: args[1] === WEBSITE ? 'fb.k1.websiteIntended' : get(args[1]) ? 'fb.k1.notPublic' : 'fb.k1.noSuch' };
        return { out: `[ticket SEC-1187] finding rejected: ${args[1]}\n`, code: 1 };
      },
    };
    const shell = new Shell({ fs, cwd: '/home/cloudops', home: '/home/cloudops', user: 'cloudops', host: 'nx-bastion', state: {} }, commands);
    return {
      console: shell,
      objectives: ['find', 'private', 'encrypt', 'website'],
      status: () => k1Status(buckets, found),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: 'NexusCloud bastion host — all actions are logged.\nStart with: cat ticket.txt\n',
    };
  },
};
