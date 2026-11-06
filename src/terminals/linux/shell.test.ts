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
