import { describe, expect, it } from 'vitest';
import { Shell, tokenize, splitPipes } from './shell';
import { coreCommands } from './commands';
import { VirtualFS } from './vfs';

const mk = () => new Shell({
  fs: new VirtualFS({ '/home/u/a.txt': 'b x\na y\nb z\n', '/home/u/.hidden': 'h', '/etc/x.conf': 'k=v' }),
  cwd: '/home/u', home: '/home/u', user: 'u', host: 'h', state: {},
}, coreCommands);

describe('tokenizer', () => {
  it('handles quotes', () => expect(tokenize(`grep "a b" 'c d' e`)).toEqual(['grep', 'a b', 'c d', 'e']));
  it('does not split pipes inside quotes', () => expect(splitPipes(`grep "a|b" f | wc -l`)).toEqual(['grep "a|b" f', 'wc -l']));
});

describe('commands', () => {
  it('ls hides dotfiles unless -a', () => {
    const sh = mk();
    expect(sh.run('ls').text).toBe('a.txt');
    expect(sh.run('ls -a').text).toContain('.hidden');
  });
  it('cd and pwd', () => {
    const sh = mk();
    sh.run('cd /etc');
    expect(sh.run('pwd').text).toBe('/etc');
    expect(sh.run('cd nope').text).toContain('No such file');
    sh.run('cd');
    expect(sh.run('pwd').text).toBe('/home/u');
  });
  it('pipelines: grep | sort | uniq -c', () => {
    const sh = mk();
    expect(sh.run(`awk '{print $1}' a.txt | sort | uniq -c | sort -nr`).text).toBe('      2 b\n      1 a');
    expect(sh.run('grep -c b a.txt').text).toBe('2');
    expect(sh.run('grep -v b a.txt').text).toBe('a y');
    expect(sh.run('cat a.txt | wc -l').text).toBe('3');
    expect(sh.run('head -n 1 a.txt').text).toBe('b x');
    expect(sh.run('tail -1 a.txt').text).toBe('b z');
    expect(sh.run('cut -d " " -f 2 a.txt').text).toBe('x\ny\nz');
  });
  it('unknown command', () => expect(mk().run('nmap').text).toBe('nmap: command not found'));
  it('tab completion', () => {
    const sh = mk();
    expect(sh.complete('ca')).toBe('cat ');
    expect(sh.complete('cat a')).toBe('cat a.txt ');
    expect(sh.complete('cd /et')).toBe('cd /etc/');
  });
});

import { sha256, rot13 } from './crypto';
describe('crypto helpers and commands', () => {
  it('sha256 known vectors', () => {
    expect(sha256('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('base64, xxd, tr round trip', () => {
    const sh = mk();
    expect(sh.run('echo hello | base64').text).toBe('aGVsbG8K');
    expect(sh.run('echo aGVsbG8K | base64 -d').text).toBe('hello');
    expect(sh.run('echo hi | xxd -p').text).toBe('68690a');
    expect(sh.run('echo 6869 | xxd -r -p').text).toBe('hi');
    expect(sh.run(`echo Uryyb | tr 'A-Za-z' 'N-ZA-Mn-za-m'`).text).toBe('Hello');
    expect(rot13('NEXUS')).toBe('ARKHF');
  });
});
