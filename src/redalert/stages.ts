import type { MissionDef, LabId, Feedback } from '../missions/types';
import { terminalMission } from '../missions/helpers';
import { IosSwitch, makePort } from '../terminals/ios/IosSwitch';
import { sha256 } from '../terminals/linux/crypto';
import { resolvePath } from '../terminals/linux/vfs';

/** RED ALERT — a timed ransomware outbreak that moves through four labs. */

export const TIME_LIMIT_MS = 15 * 60 * 1000;
export const PATIENT_ZERO = 'FIN-WS-12';
export const LEAKED_KEY = 'NXKEY7Q2EXAMPLE';
export const CI_KEY = 'NXKEY3B9EXAMPLE';
export const CLEAN_SNAPSHOT = 'snap-2026-11-05.tar';

const base = { order: 1, baseXp: 0, hintCount: 2, parTime: 0, freeHints: 'ra.hintBtn' };

const ra1: MissionDef = {
  ...base, id: 'ra1', lab: 'soc',
  createSession() {
    return terminalMission({
      files: {
        '/home/analyst/edr_alerts.log': `03:55:41 host=HR-WS-03    ip=10.0.1.33 rule=ransom.encrypt  files=211
03:52:09 host=FIN-WS-04   ip=10.0.1.41 rule=ransom.encrypt  files=1834
03:49:30 host=DEV-WS-08   ip=10.0.2.18 rule=ransom.encrypt  files=97
03:41:02 host=${PATIENT_ZERO}   ip=10.0.1.47 rule=ransom.encrypt  files=9120
03:40:12 host=${PATIENT_ZERO}   ip=10.0.1.47 rule=macro.spawn_powershell parent=WINWORD.EXE
03:58:13 host=FIN-WS-02   ip=10.0.1.39 rule=ransom.encrypt  files=640
03:46:57 host=FIN-WS-04   ip=10.0.1.41 rule=smb.mass_write  src=10.0.1.47
`,
        '/home/analyst/ALERT.txt': 'RED ALERT — ransomware "LOCKBYTE" is spreading across the office.\nFind patient zero: the first host that was infected.\n  submit host <hostname>\n',
      },
      user: 'analyst', host: 'soc-01', cwd: '/home/analyst', ticket: 'RED ALERT', helpExtra: '',
      answers: { host: (v) => v.toUpperCase() === PATIENT_ZERO ? { ok: true, key: 'ra.fb.host' } : { ok: false, key: 'ra.fb.notFirst' } },
      objectives: ['host'], motd: '*** RED ALERT *** Start with: cat ALERT.txt\n',
    });
  },
};

const ra2: MissionDef = {
  ...base, id: 'ra2', lab: 'network',
  createSession() {
    let feedback: Feedback | null = null;
    const used = ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4', 'Fa0/7', 'Gi0/1'];
    const sw = new IosSwitch('SW-FIN-02', [
      makePort('Fa0/1', { description: 'FIN-WS-02', connected: true, mode: 'access' }),
      makePort('Fa0/2', { description: 'FIN-WS-04', connected: true, mode: 'access' }),
      makePort('Fa0/3', { description: 'FIN-PRINTER', connected: true, mode: 'access' }),
      makePort('Fa0/4', { description: 'FIN-WS-09', connected: true, mode: 'access' }),
      makePort('Fa0/5', {}), makePort('Fa0/6', {}),
      makePort('Fa0/7', { description: PATIENT_ZERO, connected: true, mode: 'access' }),
      makePort('Fa0/8', {}),
      makePort('Gi0/1', { description: 'Uplink-CORE', connected: true, mode: 'trunk' }),
    ], { onChange: (s) => { if (used.filter((p) => p !== 'Fa0/7').some((p) => s.iface(p)!.shutdown)) feedback = { ok: false, key: 'ra.fb.wrongPort' }; } });
    return {
      console: sw, objectives: ['isolate'],
      status: () => ({ isolate: sw.iface('Fa0/7')!.shutdown && used.filter((p) => p !== 'Fa0/7').every((p) => !sw.iface(p)!.shutdown) }),
      takeFeedback: () => { const f = feedback; feedback = null; return f; },
      motd: `*** RED ALERT *** Isolate ${PATIENT_ZERO} from the network.\nSW-FIN-02 console. Type ? for help.\n`,
    };
  },
};

const ra3: MissionDef = {
  ...base, id: 'ra3', lab: 'cloud',
  createSession() {
    const active = new Set([LEAKED_KEY, CI_KEY]);
    return terminalMission({
      files: {
        '/home/cloudops/audit.log': `03:43:10 key=${CI_KEY}  src=10.0.9.5      action=storage:PutObject     bucket=nexus-website-assets
03:44:51 key=${LEAKED_KEY}  src=203.0.113.90  action=storage:ListBuckets
03:45:02 key=${LEAKED_KEY}  src=203.0.113.90  action=storage:GetObject     bucket=nexus-backups  (2.1 GB)
03:47:30 key=${LEAKED_KEY}  src=203.0.113.90  action=storage:DeleteObject  bucket=nexus-backups
03:50:12 key=${CI_KEY}  src=10.0.9.5      action=storage:PutObject     bucket=nexus-website-assets
`,
        '/home/cloudops/ALERT.txt': 'RED ALERT — the attackers stole an access key and are deleting our cloud backups.\nDisable the stolen key. Do NOT disable the CI key, or deployments stop.\n  nxcloud iam list-access-keys\n  nxcloud iam deactivate-access-key <key-id>\n',
      },
      user: 'cloudops', host: 'nx-bastion', cwd: '/home/cloudops', ticket: 'RED ALERT', helpExtra: '  nxcloud iam list-access-keys | deactivate-access-key <id>\n', answers: {},
      extra: ({ setFeedback }) => ({
        nxcloud: (args) => {
          if (args[0] !== 'iam') return { out: 'usage: nxcloud iam list-access-keys | deactivate-access-key <id>\n', code: 2 };
          if (args[1] === 'list-access-keys') return { out: [[LEAKED_KEY, 'svc-backup', '2025-02-11'], [CI_KEY, 'svc-ci-deploy', '2026-06-01']].map(([k, u, d]) => `${k}  ${u.padEnd(14)} created ${d}  ${active.has(k) ? 'Active' : 'Inactive'}`).join('\n') + '\n', code: 0 };
          if (args[1] === 'deactivate-access-key' && args[2]) {
            if (!active.has(args[2]) && ![LEAKED_KEY, CI_KEY].includes(args[2])) return { out: `An error occurred (NoSuchEntity): key ${args[2]} not found\n`, code: 254 };
            active.delete(args[2]);
            setFeedback(args[2] === LEAKED_KEY ? { ok: true, key: 'ra.fb.key' } : { ok: false, key: 'ra.fb.ciKey' });
            return { out: '', code: 0 };
          }
          return { out: 'usage: nxcloud iam list-access-keys | deactivate-access-key <id>\n', code: 2 };
        },
      }),
      objectives: ['key'], status: () => ({ key: !active.has(LEAKED_KEY) && active.has(CI_KEY) }),
      motd: '*** RED ALERT *** Start with: cat ALERT.txt\n',
    });
  },
};

const SNAPS: [string, string, boolean][] = [['snap-2026-11-04.tar', 'backup of file server, 04 Nov 02:00', true], [CLEAN_SNAPSHOT, 'backup of file server, 05 Nov 02:00', true], ['snap-2026-11-06.tar', 'backup of file server, 06 Nov 02:00', false]];
const ra4: MissionDef = {
  ...base, id: 'ra4', lab: 'forensics',
  createSession() {
    let restored = '';
    const files: Record<string, string> = {};
    for (const [f, desc] of SNAPS) files[`/backups/${f}`] = desc + '\n';
    const sums = SNAPS.map(([f, desc]) => `${sha256(desc + '\n')}  ${f}`).join('\n') + '\n';
    files['/backups/snap-2026-11-06.tar'] = 'LOCKBYTE ENCRYPTED ::: 8f1c..e2 ::: pay 4 BTC\n';
    files['/backups/SHA256SUMS'] = sums;
    files['/backups/ALERT.txt'] = 'RED ALERT — final step. Restore the file server from the NEWEST backup that is still intact.\nHashes were recorded when each backup was made.\n  restore <snapshot>\n';
    return terminalMission({
      files, user: 'examiner', host: 'backup-01', cwd: '/backups', ticket: 'RED ALERT', helpExtra: '  restore <snapshot>\n', answers: {},
      extra: ({ setFeedback }) => ({
        restore: (args, _s, ctx) => {
          const f = (args[0] ?? '').replace(/^.*\//, '');
          if (!ctx.fs.get(resolvePath(ctx.cwd, f, ctx.home)) || !f.startsWith('snap-')) return { out: 'usage: restore <snapshot file>\n', code: 2 };
          restored = f;
          setFeedback(f === CLEAN_SNAPSHOT ? { ok: true, key: 'ra.fb.restored' } : f === 'snap-2026-11-06.tar' ? { ok: false, key: 'ra.fb.encrypted' } : { ok: false, key: 'ra.fb.tooOld' });
          return { out: `Restoring ${f} ... ${f === 'snap-2026-11-06.tar' ? 'ERROR: archive is not a valid tar file' : 'done'}\n`, code: 0 };
        },
      }),
      objectives: ['restore'], status: () => ({ restore: restored === CLEAN_SNAPSHOT }),
      motd: '*** RED ALERT *** Start with: cat ALERT.txt\n',
    });
  },
};

export const STAGES: MissionDef[] = [ra1, ra2, ra3, ra4];
export const stageLab = (i: number): LabId => STAGES[i].lab;
