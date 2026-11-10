import type { MissionDef } from '../../types';
import { terminalMission } from '../../helpers';

export const PHISH = '03_invoice_overdue.eml';
export const BAD_DOMAIN = 'micros0ft-support.example';

const eml = (h: string, body: string) => h.trim() + '\n\n' + body.trim() + '\n';
const FILES = {
  '01_timetable.eml': eml(`Return-Path: <registrar@nexus-academy.example>
Received-SPF: pass (nexus-academy.example: domain of registrar@nexus-academy.example designates 10.0.5.12 as permitted sender)
DKIM-Signature: v=1; a=rsa-sha256; d=nexus-academy.example; s=mail; b=Kd9...
From: Registrar Office <registrar@nexus-academy.example>
Subject: Updated exam timetable
Date: Thu, 5 Nov 2026 09:12:44 +0200`, `Hi all,
The updated timetable is on the student portal:
  Link text: https://portal.nexus-academy.example/exams
  Actual URL: https://portal.nexus-academy.example/exams`),
  '02_password_expiry.eml': eml(`Return-Path: <it-helpdesk@nexus-academy.example>
Received-SPF: pass (nexus-academy.example: domain of it-helpdesk@nexus-academy.example designates 10.0.5.12 as permitted sender)
DKIM-Signature: v=1; a=rsa-sha256; d=nexus-academy.example; s=mail; b=Pq2...
From: IT Helpdesk <it-helpdesk@nexus-academy.example>
Subject: Your password expires in 3 days
Date: Thu, 5 Nov 2026 11:40:02 +0200`, `Your password expires on 8 November.
Change it from the portal as usual. IT will never ask for your password by email.
  Link text: https://portal.nexus-academy.example/account
  Actual URL: https://portal.nexus-academy.example/account`),
  [PHISH]: eml(`Return-Path: <bounce-7731@${BAD_DOMAIN}>
Received: from mail.${BAD_DOMAIN} (unknown [203.0.113.88])
Received-SPF: fail (nexus-academy.example: domain of microsoft.com does not designate 203.0.113.88 as permitted sender)
DKIM-Signature: none
From: Microsoft 365 Billing <billing@microsoft.com>
Reply-To: billing-team@${BAD_DOMAIN}
Subject: URGENT: Invoice overdue — account suspended in 24h
Date: Thu, 5 Nov 2026 23:58:10 +0200`, `Dear user,
Your Microsoft 365 subscription payment failed. Your mailbox will be
deleted in 24 hours unless you verify your billing details now.
  Link text: https://portal.office.com/billing
  Actual URL: http://${BAD_DOMAIN}/o365/login.php?u=staff
Microsoft Billing Team`),
  '04_newsletter.eml': eml(`Return-Path: <news@campus-life.example>
Received-SPF: pass (campus-life.example: domain of news@campus-life.example designates 198.51.100.20 as permitted sender)
DKIM-Signature: v=1; a=rsa-sha256; d=campus-life.example; s=s1; b=Za0...
From: Campus Life <news@campus-life.example>
Subject: This week on campus: hackathon registration open
Date: Fri, 6 Nov 2026 08:00:00 +0200`, `Registration for the November hackathon is open.
  Link text: https://campus-life.example/hackathon
  Actual URL: https://campus-life.example/hackathon`),
};

export const missionS2: MissionDef = {
  id: 's2', lab: 'soc', order: 2, baseXp: 350, hintCount: 3, parTime: 300,
  createSession() {
    let quarantined = '';
    return terminalMission({
      files: { ...Object.fromEntries(Object.entries(FILES).map(([k, v]) => [`/home/analyst/reported/${k}`, { content: v, owner: 'analyst' }])),
        '/home/analyst/ticket.txt': `TICKET INC-4502 — staff reported 4 suspicious emails (folder: reported/)
1. Find the phishing email:          submit email <file>
2. Find the attacker's real domain:   submit domain <domain>
3. Pull it from all mailboxes:        quarantine <file>
Only one is malicious. Don't quarantine legitimate mail.\n` },
      dirs: ['/home/analyst/reported'],
      user: 'analyst', host: 'soc-mail-01', cwd: '/home/analyst', ticket: 'INC-4502',
      helpExtra: '  quarantine <file>     remove an email from all mailboxes\n',
      answers: {
        email: (v) => v.replace(/^.*\//, '') === PHISH ? { ok: true, key: 'fb.s2.emailOk' } : { ok: false, key: v.includes('02_') ? 'fb.s2.decoy' : 'fb.s2.emailWrong' },
        domain: (v) => v.toLowerCase() === BAD_DOMAIN ? { ok: true, key: 'fb.s2.domainOk' } : { ok: false, key: v.toLowerCase().includes('microsoft.com') ? 'fb.s2.spoofed' : 'fb.s2.domainWrong' },
      },
      extra: ({ setFeedback }) => ({
        quarantine: (args) => {
          const f = (args[0] ?? '').replace(/^.*\//, '');
          if (!f || !(f in FILES)) return { out: 'usage: quarantine <file in reported/>\n', code: 2 };
          quarantined = f;
          setFeedback(f === PHISH ? { ok: true, key: 'fb.s2.quarantined' } : { ok: false, key: 'fb.s2.quarantineWrong' });
          return { out: `Removed "${f}" from 412 mailboxes.\n`, code: 0 };
        },
      }),
      objectives: ['email', 'domain', 'quarantine'],
      status: (d) => ({ email: !!d.email, domain: !!d.domain, quarantine: quarantined === PHISH }),
      motd: 'SOC mail gateway shell.\nStart with: cat ticket.txt\n',
    });
  },
};
