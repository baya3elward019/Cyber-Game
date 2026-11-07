import { describe, expect, it } from 'vitest';
import { INITIAL, runTests, c1Status } from './mission';

const fixed = `const { hash } = require('./crypto');
async function login(db, username, password) {
  const sql = "SELECT id, role FROM users WHERE username = ? AND password_hash = ?";
  const rows = await db.query(sql, [username, hash(password)]);
  return rows.length === 1 ? rows[0] : null;
}
module.exports = { login };`;

describe('C1 SQL injection validator', () => {
  it('original code is vulnerable but works', () => {
    const st = c1Status(runTests(INITIAL));
    expect(st).toEqual({ inject: false, works: true });
  });
  it('parameterized query passes everything', () => {
    expect(c1Status(runTests(fixed))).toEqual({ inject: true, works: true });
  });
  it('inline query with $1/$2 placeholders also passes', () => {
    const pg = fixed.replace(/const sql = .*\n/, '').replace('db.query(sql,', 'db.query("SELECT id, role FROM users WHERE username = $1 AND password_hash = $2",');
    expect(c1Status(runTests(pg))).toEqual({ inject: true, works: true });
  });
  it('template literal concatenation is still vulnerable', () => {
    const bad = fixed.replace('"SELECT id, role FROM users WHERE username = ? AND password_hash = ?"', '`SELECT id, role FROM users WHERE username = \'${username}\' AND password_hash = \'${hash(password)}\'`').replace('db.query(sql, [username, hash(password)])', 'db.query(sql)');
    expect(c1Status(runTests(bad)).inject).toBe(false);
  });
  it('filtering quotes is not accepted', () => {
    const bad = INITIAL.replace('" + username +', '" + username.replace(/\'/g, "") +');
    expect(c1Status(runTests(bad)).inject).toBe(false);
  });
  it('dropping the password check breaks the normal-login test', () => {
    const bad = fixed.replace(' AND password_hash = ?', '').replace('[username, hash(password)]', '[username, hash(password)]');
    expect(c1Status(runTests(bad)).works).toBe(false);
  });
});
