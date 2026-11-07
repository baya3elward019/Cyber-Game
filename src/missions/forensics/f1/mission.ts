import type { MissionDef, Feedback } from '../../types';
import { Shell, type Command } from '../../../terminals/linux/shell';
import { coreCommands, makeHelp } from '../../../terminals/linux/commands';
import { VirtualFS, resolvePath } from '../../../terminals/linux/vfs';
import { sha256 } from '../../../terminals/linux/crypto';

/** F1 — Evidence integrity. Hash verification plus metadata. All fictional. */

export const TAMPERED = 'invoice_7781.pdf';
export const EDITOR = 'm.farouk';
const DIR = '/evidence/case-2291';

const ORIGINAL: Record<string, string> = {
  'IMG_0412.jpg': 'JFIF\u0001 [binary image data: loading dock camera still, 2026-10-29 21:14]',
  'contract_v3.pdf': '%PDF-1.7 Supply contract Nexus Logistics / Orion Parts. Value: 1,200,000 EGP. Signed 2026-09-14.',
  'chat_export.txt': '[2026-10-28 19:02] karim.s: did the parts ship?\n[2026-10-28 19:05] m.farouk: tomorrow, dock 3\n[2026-10-29 08:11] karim.s: invoice amount?\n[2026-10-29 08:15] m.farouk: 48,500 as agreed\n',
  'invoice_7781.pdf': '%PDF-1.7 INVOICE 7781 Orion Parts -> Nexus Logistics. Amount due: 48,500 EGP. Bank: account ending 4410.',
  'usb_listing.txt': 'Volume: KINGSTON 32GB  Serial: 0019E06B4A1E\n/backup/q3_reports.zip\n/backup/invoices/\n/tools/notes.txt\n',
};
const TAMPERED_CONTENT = '%PDF-1.7 INVOICE 7781 Orion Parts -> Nexus Logistics. Amount due: 148,500 EGP. Bank: account ending 9902.';

const META: Record<string, [string, string][]> = {
  'IMG_0412.jpg': [['File Type', 'JPEG'], ['Make', 'Hikvision'], ['Create Date', '2026:10:29 21:14:07'], ['Image Size', '1920x1080']],
  'contract_v3.pdf': [['File Type', 'PDF'], ['Author', 'legal.team'], ['Create Date', '2026:09:14 10:22:41'], ['Modify Date', '2026:09:14 10:31:02'], ['Last Modified By', 'legal.team'], ['Producer', 'Microsoft Word 2021']],
  'chat_export.txt': [['File Type', 'TXT'], ['File Modification Date/Time', '2026:10:31 09:02:11+02:00']],
  'invoice_7781.pdf': [['File Type', 'PDF'], ['Author', 'accounts.orion'], ['Create Date', '2026:10:29 08:40:15'], ['Modify Date', '2026:10:31 23:47:52'], ['Last Modified By', EDITOR], ['Producer', 'PDF-XChange Editor 10.2']],
  'usb_listing.txt': [['File Type', 'TXT'], ['File Modification Date/Time', '2026:10:31 09:05:40+02:00']],
};

export function buildSums(): string {
  return Object.entries(ORIGINAL).map(([f, c]) => `${sha256(c)}  ${f}`).join('\n') + '\n';
}

export const missionF1: MissionDef = {
  id: 'f1', lab: 'forensics', order: 1, baseXp: 300, hintCount: 3, parTime: 300,
  createSession() {
    const files: Record<string, string | { content: string; owner?: string; mtime?: string }> = {};
    for (const [f, c] of Object.entries(ORIGINAL)) files[`${DIR}/${f}`] = { content: f === TAMPERED ? TAMPERED_CONTENT : c, owner: 'evidence', mtime: 'Oct 31 09:05' };
    files[`${DIR}/SHA256SUMS`] = { content: buildSums(), owner: 'evidence', mtime: 'Oct 31 09:10' };
    files[`${DIR}/custody.txt`] = { owner: 'evidence', content: `CHAIN OF CUSTODY — CASE 2291 (procurement fraud)
Seized:   2026-10-31 09:00, workstation FIN-WS-07, by D. Nabil
Imaged:   2026-10-31 09:05, write-blocker WB-3
Hashed:   2026-10-31 09:10, SHA-256 — see SHA256SUMS in this folder
Stored:   evidence locker 4, sealed bag 0091

Today the defense claims the evidence was altered after seizure.
Verify every file against the recorded hashes and report:
  submit file <name>       the file that no longer matches
  submit user <account>    the account that last modified it (check metadata)
` };
    const fs = new VirtualFS(files, ['/home/examiner']);
    let feedback: Feedback | null = null;
    const st = { file: false, user: false };
    const exiftool: Command = (args, _s, ctx) => {
      if (!args.length) return { out: 'Syntax:  exiftool FILE...\n', code: 1 };
      let out = '';
      for (const a of args) {
        const p = resolvePath(ctx.cwd, a, ctx.home);
        const name = p.split('/').pop()!;
        const f = ctx.fs.get(p);
        if (!f) { out += `Error: File not found - ${a}\n`; continue; }
        if (args.length > 1) out += `======== ${a}\n`;
        const rows: [string, string][] = [['ExifTool Version Number', '12.76'], ['File Name', name], ['File Size', `${f.content.length} bytes`], ...(META[name] ?? [['File Type', 'TXT']])];
        out += rows.map(([k, v]) => `${k.padEnd(32)}: ${v}`).join('\n') + '\n';
      }
      return { out, code: 0 };
    };
    const commands: Record<string, Command> = {
      ...coreCommands,
      help: makeHelp('  exiftool <file>        show file metadata\n  submit file <name> | submit user <account>\n'),
      exiftool,
      submit: (args) => {
        const [kind, v] = args;
        if (!v || !['file', 'user'].includes(kind)) return { out: 'usage: submit file <name> | submit user <account>\n', code: 2 };
        const okv = kind === 'file' ? v.replace(/^.*\//, '') === TAMPERED : v.toLowerCase() === EDITOR;
        if (okv) { st[kind as 'file' | 'user'] = true; feedback = { ok: true, key: `fb.f1.${kind}Ok` }; return { out: `[case 2291] finding recorded: ${kind} = ${v}  ✔ accepted\n`, code: 0 }; }
        feedback = { ok: false, key: kind === 'file' ? 'fb.f1.fileWrong' : v === 'accounts.orion' || v === 'legal.team' ? 'fb.f1.author' : 'fb.f1.userWrong' };
        return { out: `[case 2291] finding rejected: ${kind} = ${v}\n`, code: 1 };
      },
    };
    const shell = new Shell({ fs, cwd: DIR, home: '/home/examiner', user: 'examiner', host: 'forensic-ws', state: {} }, commands);
    return {
      console: shell,
      objectives: ['file', 'user'],
      status: () => ({ ...st }),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: 'Forensic workstation — evidence share mounted read-only at /evidence\nStart with: cat custody.txt\n',
    };
  },
};
