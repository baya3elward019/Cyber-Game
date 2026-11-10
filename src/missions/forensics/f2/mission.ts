import type { MissionDef } from '../../types';
import { terminalMission } from '../../helpers';

export const ACCOUNT = 's.adel';
export const SUSPECT = 'k.hamdy';

export const missionF2: MissionDef = {
  id: 'f2', lab: 'forensics', order: 2, baseXp: 350, hintCount: 3, parTime: 360,
  createSession() {
    return terminalMission({
      files: {
        '/cases/2307/fileserver.log': `2026-11-03 17:02:11 user=r.nabil  host=FIN-WS-03 action=OPEN  path=/finance/budget_2027.xlsx
2026-11-03 17:40:55 user=s.adel   host=FIN-WS-07 action=OPEN  path=/finance/vendors.xlsx
2026-11-03 22:41:09 user=s.adel   host=FIN-WS-07 action=COPY  path=/finance/payroll_q3.xlsx dest=E:\\payroll_q3.xlsx (USB)
2026-11-03 22:43:30 user=s.adel   host=FIN-WS-07 action=LOGOFF
2026-11-04 08:31:02 user=s.adel   host=FIN-WS-07 action=LOGON
`,
        '/cases/2307/badge.log': `2026-11-03 08:55:12 badge=s.adel   door=FINANCE-OFFICE  IN
2026-11-03 08:58:40 badge=r.nabil  door=FINANCE-OFFICE  IN
2026-11-03 17:59:03 badge=r.nabil  door=MAIN-EXIT       OUT
2026-11-03 18:05:47 badge=s.adel   door=MAIN-EXIT       OUT
2026-11-03 21:10:22 badge=m.salah  door=MAIN-ENTRANCE   IN
2026-11-03 21:12:05 badge=m.salah  door=SERVER-ROOM     IN
2026-11-03 22:28:51 badge=k.hamdy  door=MAIN-ENTRANCE   IN
2026-11-03 22:30:14 badge=k.hamdy  door=FINANCE-OFFICE  IN
2026-11-03 22:47:02 badge=k.hamdy  door=MAIN-EXIT       OUT
2026-11-03 23:15:40 badge=m.salah  door=MAIN-EXIT       OUT
2026-11-04 08:29:10 badge=s.adel   door=MAIN-ENTRANCE   IN
`,
        '/cases/2307/vpn.log': `2026-11-03 20:01:33 user=r.nabil  src=198.51.100.140 CONNECT
2026-11-03 20:44:10 user=r.nabil  src=198.51.100.140 DISCONNECT
2026-11-03 21:30:02 user=t.fawzy  src=198.51.100.201 CONNECT
2026-11-03 23:05:48 user=t.fawzy  src=198.51.100.201 DISCONNECT
`,
        '/cases/2307/notes.txt': `CASE 2307 — payroll file copied to USB on 3 November.
FIN-WS-07 is a desktop PC inside the finance office. It is not reachable over VPN.
Staff: s.adel (finance), r.nabil (finance), m.salah (IT, night shift),
       k.hamdy (facilities), t.fawzy (developer, remote).

1. Which account performed the copy?      submit account <name>
2. Who was physically at the PC?          submit suspect <name>
`,
      },
      user: 'examiner', host: 'forensic-ws', cwd: '/cases/2307', ticket: 'case 2307',
      helpExtra: '',
      answers: {
        account: (v) => v.toLowerCase() === ACCOUNT ? { ok: true, key: 'fb.f2.accountOk' } : { ok: false, key: 'fb.f2.accountWrong' },
        suspect: (v) => v.toLowerCase() === SUSPECT ? { ok: true, key: 'fb.f2.suspectOk' }
          : { ok: false, key: v.toLowerCase() === ACCOUNT ? 'fb.f2.wasHome' : v.toLowerCase() === 'm.salah' ? 'fb.f2.serverRoom' : v.toLowerCase() === 't.fawzy' ? 'fb.f2.vpn' : 'fb.f2.suspectWrong' },
      },
      objectives: ['account', 'suspect'],
      motd: 'Forensic workstation — case 2307\nStart with: cat notes.txt\n',
    });
  },
};
