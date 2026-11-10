import type { Console } from '../types';

/** A small but faithful simulation of a Cisco IOS access switch CLI. */

export type Mode = 'user' | 'priv' | 'config' | 'if' | 'vlan';

export interface Iface {
  name: string;   // FastEthernet0/1
  short: string;  // Fa0/1
  description: string;
  shutdown: boolean;
  mode: 'dynamic' | 'access' | 'trunk';
  vlan: number;
  connected: boolean;
  mac: string | null;
  ps: { enabled: boolean; max: number; sticky: boolean; violation: 'shutdown' | 'restrict' | 'protect' };
}

export interface SwitchEvents {
  /** Called after any configuration change. */
  onChange?: (sw: IosSwitch) => void;
  onSave?: (sw: IosSwitch) => void;
}

const INVALID = (_line: string, at: number) => `${' '.repeat(Math.max(0, at))}^\n% Invalid input detected at '^' marker.\n`;

export class IosSwitch implements Console {
  mode: Mode = 'user';
  hostname: string;
  ifaces: Iface[];
  selected: Iface[] = [];
  vlans = new Map<number, string>([[1, 'default']]);
  private curVlan = 0;
  /** Config generation counter; savedGen === gen means startup-config is current. */
  gen = 0;
  savedGen = 0;

  constructor(hostname: string, ifaces: Iface[], private ev: SwitchEvents = {}) {
    this.hostname = hostname;
    this.ifaces = ifaces;
  }

  get title() { return `console — ${this.hostname} (9600 8N1)`; }

  get prompt() {
    const p = { user: '>', priv: '#', config: '(config)#', vlan: '(config-vlan)#', if: this.selected.length > 1 ? '(config-if-range)#' : '(config-if)#' }[this.mode];
    return this.hostname + p;
  }

  iface(short: string) { return this.ifaces.find((i) => i.short.toLowerCase() === short.toLowerCase()); }

  private changed() { this.gen++; this.ev.onChange?.(this); }

  /** Matches an abbreviated keyword against options. Returns the full keyword, 'AMBIG' or null. */
  private kw(token: string | undefined, options: string[]): string | null {
    if (!token) return null;
    const t = token.toLowerCase();
    if (options.includes(t)) return t;
    const m = options.filter((o) => o.startsWith(t));
    return m.length === 1 ? m[0] : m.length > 1 ? 'AMBIG' : null;
  }

  /** Parses an interface reference like "fa0/1", "f 0/1", "gigabitethernet0/1". */
  parseIface(tokens: string[]): { list: Iface[] | null; used: number; err?: string } {
    const joined = tokens.slice(0, 2).join(' ');
    const m = joined.match(/^(f|fa|fas|fast|fastethernet|g|gi|gig|gigabitethernet)\s*(\d+\/\d+)/i);
    if (!m) return { list: null, used: 0 };
    const prefix = m[1].toLowerCase().startsWith('f') ? 'Fa' : 'Gi';
    const used = /\s/.test(m[0].trim()) ? 2 : 1;
    const it = this.iface(prefix + m[2]);
    return it ? { list: [it], used } : { list: null, used, err: '% Invalid interface type and number\n' };
  }

  /** Parses "range fa0/5 - 12", "range fa0/5-12", "range fa0/5 - fa0/12". */
  parseRange(rest: string): Iface[] | null {
    const m = rest.match(/^(f\w*|g\w*)\s*(\d+)\/(\d+)\s*-\s*(?:(?:f\w*|g\w*)\s*\d+\/)?(\d+)\s*$/i);
    if (!m) return null;
    const prefix = m[1].toLowerCase().startsWith('f') ? 'Fa' : 'Gi';
    const from = +m[3], to = +m[4];
    if (to < from) return null;
    const out: Iface[] = [];
    for (let n = from; n <= to; n++) { const it = this.iface(`${prefix}${m[2]}/${n}`); if (!it) return null; out.push(it); }
    return out;
  }

  complete(line: string): string {
    const words: Record<Mode, string[]> = {
      user: ['enable', 'show', 'exit', 'ping'],
      priv: ['configure', 'show', 'copy', 'write', 'disable', 'exit', 'ping'],
      config: ['interface', 'hostname', 'vlan', 'exit', 'end', 'do', 'no'],
      vlan: ['name', 'exit', 'end'],
      if: ['shutdown', 'no', 'description', 'switchport', 'exit', 'end', 'do', 'interface'],
    };
    const m = line.match(/^(\s*)(\S*)$/);
    if (!m) return line;
    const c = words[this.mode].filter((w) => w.startsWith(m[2].toLowerCase()));
    return c.length === 1 ? m[1] + c[0] + ' ' : line;
  }

  run(line: string): { text: string; clear?: boolean } {
    const raw = line.trim();
    if (!raw) return { text: '' };
    const out = this.exec(raw);
    return { text: out.replace(/\n$/, '') };
  }

  private help(): string {
    const h: Record<Mode, string> = {
      user: 'Exec commands:\n  enable     Turn on privileged commands\n  exit       Exit from the EXEC\n  ping       Send echo messages\n  show       Show running system information\n',
      priv: 'Exec commands:\n  configure  Enter configuration mode\n  copy       Copy from one file to another\n  disable    Turn off privileged commands\n  exit       Exit from the EXEC\n  ping       Send echo messages\n  show       Show running system information\n  write      Write running configuration to memory\n',
      config: 'Configure commands:\n  do         To run exec commands in config mode\n  end        Exit from configure mode\n  exit       Exit from configure mode\n  hostname   Set system\'s network name\n  interface  Select an interface to configure\n  no         Negate a command or set its defaults\n  vlan       Vlan commands\n',
      vlan: 'VLAN configuration commands:\n  end   Exit from configure mode\n  exit  Apply changes and exit\n  name  Ascii name of the VLAN\n',
      if: 'Interface configuration commands:\n  description  Interface specific description\n  do           To run exec commands in config mode\n  end          Exit from configure mode\n  exit         Exit from interface configuration mode\n  no           Negate a command or set its defaults\n  shutdown     Shutdown the selected interface\n  switchport   Set switching mode characteristics\n',
    };
    return h[this.mode];
  }

  private exec(raw: string): string {
    if (raw.endsWith('?')) return this.help();
    const t = raw.split(/\s+/);
    switch (this.mode) {
      case 'user': return this.execUser(t, raw);
      case 'priv': return this.execPriv(t, raw);
      case 'config': return this.execConfig(t, raw);
      case 'if': return this.execIf(t, raw);
      case 'vlan': {
        const c = this.kw(t[0], ['name', 'exit', 'end', 'vlan', 'interface', 'do']);
        if (c === 'vlan' || c === 'interface' || c === 'do') { this.mode = 'config'; return this.execConfig(t, raw); }
        if (c === 'name') { if (!t[1]) return '% Incomplete command.\n'; this.vlans.set(this.curVlan, t[1].slice(0, 32)); this.changed(); return ''; }
        if (c === 'exit') { this.mode = 'config'; return ''; }
        if (c === 'end') { this.mode = 'priv'; return ''; }
        return INVALID(raw, this.prompt.length);
      }
    }
  }

  private execUser(t: string[], raw: string): string {
    const c = this.kw(t[0], ['enable', 'show', 'exit', 'logout', 'ping']);
    if (c === 'AMBIG') return `% Ambiguous command:  "${raw}"\n`;
    if (c === 'enable') { this.mode = 'priv'; return ''; }
    if (c === 'show') return this.show(t.slice(1), raw, false);
    if (c === 'exit' || c === 'logout') return '\n' + this.hostname + ' con0 is now available\n\nPress RETURN to get started.\n';
    if (c === 'ping') return this.ping(t[1]);
    return INVALID(raw, this.prompt.length);
  }

  private execPriv(t: string[], raw: string): string {
    const c = this.kw(t[0], ['configure', 'show', 'copy', 'write', 'disable', 'exit', 'ping', 'enable']);
    if (c === 'AMBIG') return `% Ambiguous command:  "${raw}"\n`;
    switch (c) {
      case 'enable': return '';
      case 'configure':
        if (t[1] && this.kw(t[1], ['terminal']) !== 'terminal') return INVALID(raw, this.prompt.length + t[0].length + 1);
        this.mode = 'config';
        return 'Enter configuration commands, one per line.  End with CNTL/Z.\n';
      case 'show': return this.show(t.slice(1), raw, true);
      case 'copy': {
        const a = this.kw(t[1], ['running-config', 'startup-config']);
        const b = this.kw(t[2], ['running-config', 'startup-config']);
        if (a === 'running-config' && b === 'startup-config') return this.save();
        if (!t[1]) return '% Incomplete command.\n';
        return INVALID(raw, this.prompt.length + t[0].length + 1);
      }
      case 'write':
        if (!t[1] || this.kw(t[1], ['memory']) === 'memory') return this.save();
        return INVALID(raw, this.prompt.length + t[0].length + 1);
      case 'disable': this.mode = 'user'; return '';
      case 'exit': this.mode = 'user'; return '';
      case 'ping': return this.ping(t[1]);
    }
    return INVALID(raw, this.prompt.length);
  }

  private save(): string {
    this.savedGen = this.gen;
    this.ev.onSave?.(this);
    return 'Destination filename [startup-config]? \nBuilding configuration...\n[OK]\n';
  }

  private execConfig(t: string[], raw: string): string {
    const c = this.kw(t[0], ['interface', 'hostname', 'vlan', 'exit', 'end', 'do', 'no']);
    if (c === 'AMBIG') return `% Ambiguous command:  "${raw}"\n`;
    switch (c) {
      case 'vlan': {
        const n = Number(t[1]);
        if (!Number.isInteger(n) || n < 2 || n > 4094) return '% Bad VLAN list - character #1 is a non-numeric\ncharacter or out of range (2-4094).\n';
        if (!this.vlans.has(n)) { this.vlans.set(n, 'VLAN' + String(n).padStart(4, '0')); this.changed(); }
        this.curVlan = n; this.mode = 'vlan'; return '';
      }
      case 'exit': case 'end': this.mode = 'priv'; return '';
      case 'do': return this.execPriv(t.slice(1), t.slice(1).join(' '));
      case 'hostname':
        if (!t[1]) return '% Incomplete command.\n';
        this.hostname = t[1]; this.changed(); return '';
      case 'interface': return this.selectIface(t.slice(1), raw);
      case 'no': return INVALID(raw, this.prompt.length + 3);
    }
    return INVALID(raw, this.prompt.length);
  }

  private selectIface(args: string[], raw: string): string {
    if (!args.length) return '% Incomplete command.\n';
    if (this.kw(args[0], ['range']) === 'range') {
      const list = this.parseRange(args.slice(1).join(' '));
      if (!list) return '% Invalid input detected: use e.g. "interface range fa0/5 - 12"\n';
      this.selected = list; this.mode = 'if'; return '';
    }
    const r = this.parseIface(args);
    if (r.err) return r.err;
    if (!r.list) return INVALID(raw, this.prompt.length + raw.indexOf(args[0]));
    this.selected = r.list; this.mode = 'if';
    return '';
  }

  private execIf(t: string[], raw: string): string {
    let neg = false;
    if (this.kw(t[0], ['no']) === 'no' && t[0].toLowerCase() === 'no') { neg = true; t = t.slice(1); }
    const c = this.kw(t[0], ['shutdown', 'description', 'switchport', 'exit', 'end', 'do', 'interface']);
    if (c === 'AMBIG') return `% Ambiguous command:  "${raw}"\n`;
    const sel = this.selected;
    switch (c) {
      case 'exit': this.mode = 'config'; this.selected = []; return '';
      case 'end': this.mode = 'priv'; this.selected = []; return '';
      case 'do': return this.execPriv(t.slice(1), t.slice(1).join(' '));
      case 'interface': return this.selectIface(t.slice(1), raw);
      case 'shutdown': {
        let out = '';
        for (const i of sel) {
          if (i.shutdown === !neg) continue;
          i.shutdown = !neg;
          out += `%LINK-5-CHANGED: Interface ${i.name}, changed state to ${neg ? 'up' : 'administratively down'}\n`;
          if (i.connected) out += `%LINEPROTO-5-UPDOWN: Line protocol on Interface ${i.name}, changed state to ${neg ? 'up' : 'down'}\n`;
        }
        this.changed();
        return out;
      }
      case 'description':
        for (const i of sel) i.description = neg ? '' : t.slice(1).join(' ');
        this.changed(); return '';
      case 'switchport': return this.switchport(t.slice(1), neg, raw);
    }
    return INVALID(raw, this.prompt.length);
  }

  private switchport(t: string[], neg: boolean, raw: string): string {
    const sel = this.selected;
    const c = this.kw(t[0], ['mode', 'access', 'port-security']);
    if (!c) return t[0] ? INVALID(raw, this.prompt.length + raw.indexOf(t[0])) : '% Incomplete command.\n';
    if (c === 'mode') {
      const m = this.kw(t[1], ['access', 'trunk', 'dynamic']);
      if (!m || m === 'AMBIG') return '% Incomplete command.\n';
      for (const i of sel) i.mode = neg ? 'dynamic' : (m as Iface['mode']);
      this.changed(); return '';
    }
    if (c === 'access') {
      if (this.kw(t[1], ['vlan']) !== 'vlan' || !/^\d+$/.test(t[2] ?? '')) return '% Incomplete command.\n';
      let msg = '';
      if (!neg && !this.vlans.has(+t[2])) { this.vlans.set(+t[2], 'VLAN' + t[2].padStart(4, '0')); msg = `% Access VLAN does not exist. Creating vlan ${t[2]}\n`; }
      for (const i of sel) i.vlan = neg ? 1 : +t[2];
      this.changed(); return msg;
    }
    // port-security
    let out = '';
    for (const i of sel) if (i.mode !== 'access') out += `Command rejected: ${i.name} is a dynamic port.\n`;
    if (out) return out;
    const sub = this.kw(t[1], ['maximum', 'violation', 'mac-address']);
    if (!t[1]) { for (const i of sel) i.ps.enabled = !neg; this.changed(); return ''; }
    if (sub === 'maximum') {
      if (!/^\d+$/.test(t[2] ?? '')) return '% Incomplete command.\n';
      for (const i of sel) i.ps.max = neg ? 1 : +t[2];
    } else if (sub === 'violation') {
      const v = this.kw(t[2], ['shutdown', 'restrict', 'protect']);
      if (!v || v === 'AMBIG') return '% Incomplete command.\n';
      for (const i of sel) i.ps.violation = neg ? 'shutdown' : (v as Iface['ps']['violation']);
    } else if (sub === 'mac-address') {
      if (this.kw(t[2], ['sticky']) !== 'sticky') return '% Incomplete command.\n';
      for (const i of sel) i.ps.sticky = !neg;
    } else return INVALID(raw, this.prompt.length + raw.indexOf(t[1]));
    this.changed();
    return '';
  }

  private show(t: string[], raw: string, priv: boolean): string {
    const what = this.kw(t[0], ['running-config', 'startup-config', 'interfaces', 'ip', 'port-security', 'vlan', 'version']);
    if (!what) return t[0] ? INVALID(raw, raw.indexOf(t[0]) + this.prompt.length) : '% Incomplete command.\n';
    if (what === 'AMBIG') return `% Ambiguous command:  "${raw}"\n`;
    if ((what === 'running-config' || what === 'startup-config') && !priv) return INVALID(raw, raw.indexOf(t[0]) + this.prompt.length);
    switch (what) {
      case 'running-config': return this.runningConfig();
      case 'startup-config': return this.savedGen === this.gen ? this.runningConfig() : '% Startup config differs from running config. Use "copy running-config startup-config" to save.\n';
      case 'version': return `Cisco IOS Software, C2960 Software (C2960-LANBASEK9-M), Version 15.0(2)SE11\n${this.hostname} uptime is 41 weeks, 2 days, 3 hours\n`;
      case 'ip':
        if (this.kw(t[1], ['interface']) !== 'interface') return '% Incomplete command.\n';
        return 'Interface              IP-Address      OK? Method Status                Protocol\n' +
          'Vlan1                  10.0.1.2        YES NVRAM  up                    up\n' +
          this.ifaces.map((i) => `${i.name.padEnd(23)}unassigned      YES unset  ${(i.shutdown ? 'administratively down' : i.connected ? 'up' : 'down').padEnd(22)}${i.connected && !i.shutdown ? 'up' : 'down'}`).join('\n') + '\n';
      case 'interfaces':
        if (this.kw(t[1], ['status']) !== 'status') return '% Use "show interfaces status"\n';
        return 'Port      Name               Status       Vlan       Duplex  Speed Type\n' +
          this.ifaces.map((i) => `${i.short.padEnd(10)}${i.description.slice(0, 18).padEnd(19)}${(i.shutdown ? 'disabled' : i.connected ? 'connected' : 'notconnect').padEnd(13)}${String(i.mode === 'trunk' ? 'trunk' : i.vlan).padEnd(11)}${i.connected ? 'a-full  a-100' : '  auto   auto'} ${i.short.startsWith('Gi') ? '10/100/1000BaseTX' : '10/100BaseTX'}`).join('\n') + '\n';
      case 'port-security': {
        const rows = this.ifaces.filter((i) => i.ps.enabled);
        return 'Secure Port  MaxSecureAddr  CurrentAddr  SecurityViolation  Security Action\n                (Count)       (Count)          (Count)\n---------------------------------------------------------------------------\n' +
          rows.map((i) => `${i.short.padStart(11)}${String(i.ps.max).padStart(15)}${String(i.ps.sticky && i.mac ? 1 : 0).padStart(13)}${'0'.padStart(19)}${(i.ps.violation[0].toUpperCase() + i.ps.violation.slice(1)).padStart(17)}`).join('\n') +
          (rows.length ? '\n' : '') + '---------------------------------------------------------------------------\n';
      }
      case 'vlan':
        return 'VLAN Name                             Status    Ports\n---- -------------------------------- --------- -------------------------------\n' +
          [...this.vlans.keys()].sort((a, b) => a - b).map((v) => `${String(v).padEnd(5)}${(this.vlans.get(v) ?? '').padEnd(33)}active    ${this.ifaces.filter((i) => i.vlan === v && i.mode !== 'trunk').map((i) => i.short).join(', ')}`).join('\n') + '\n';
    }
    return '';
  }

  private runningConfig(): string {
    let s = `Building configuration...\n\nCurrent configuration : 2148 bytes\n!\nversion 15.0\nhostname ${this.hostname}\n!\nenable secret 5 $1$mERr$hx5rVt7rPNoS4wqbXKX7m0\n!\n`;
    for (const [v, n] of this.vlans) if (v !== 1) s += `vlan ${v}\n name ${n}\n!\n`;
    for (const i of this.ifaces) {
      s += `interface ${i.name}\n`;
      if (i.description) s += ` description ${i.description}\n`;
      if (i.mode === 'access') s += ' switchport mode access\n';
      if (i.mode === 'trunk') s += ' switchport mode trunk\n';
      if (i.vlan !== 1) s += ` switchport access vlan ${i.vlan}\n`;
      if (i.ps.enabled) s += ' switchport port-security\n';
      if (i.ps.max !== 1) s += ` switchport port-security maximum ${i.ps.max}\n`;
      if (i.ps.violation !== 'shutdown') s += ` switchport port-security violation ${i.ps.violation}\n`;
      if (i.ps.sticky) s += ' switchport port-security mac-address sticky\n';
      if (i.ps.sticky && i.mac && i.ps.enabled) s += ` switchport port-security mac-address sticky ${i.mac}\n`;
      if (i.shutdown) s += ' shutdown\n';
      s += '!\n';
    }
    return s + 'interface Vlan1\n ip address 10.0.1.2 255.255.255.0\n!\nend\n';
  }

  private ping(target?: string): string {
    if (!target) return '% Incomplete command.\n';
    const up = this.ifaces.find((i) => i.short === 'Gi0/1')?.shutdown === false;
    return `Type escape sequence to abort.\nSending 5, 100-byte ICMP Echos to ${target}, timeout is 2 seconds:\n${up ? '!!!!!' : '.....'}\nSuccess rate is ${up ? '100 percent (5/5), round-trip min/avg/max = 1/2/4 ms' : '0 percent (0/5)'}\n`;
  }
}

export function makePort(short: string, opts: Partial<Iface> = {}): Iface {
  const isGi = short.startsWith('Gi');
  return {
    name: (isGi ? 'GigabitEthernet' : 'FastEthernet') + short.slice(2),
    short, description: '', shutdown: false, mode: 'dynamic', vlan: 1, connected: false, mac: null,
    ps: { enabled: false, max: 1, sticky: false, violation: 'shutdown' },
    ...opts,
  };
}
