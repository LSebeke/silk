import { describe, expect, it } from 'vitest';
import { judgeAudit } from './audit.mjs';

const advisory = (name: string, id: string, severity = 'moderate') => ({
  name,
  severity,
  url: `https://github.com/advisories/${id}`,
  title: `${name} issue`,
});
const report = (...via: ReturnType<typeof advisory>[]) => ({
  vulnerabilities: Object.fromEntries(via.map((a) => [a.name, { via: [a, 'transitive-name'] }])),
  metadata: { dependencies: {} },
});
const reviewed = { 'GHSA-aaaa': { pkg: 'tooling' } };

describe('audit gate', () => {
  it('accepts a reviewed advisory for the package it was reviewed for', () => {
    const result = judgeAudit(report(advisory('tooling', 'GHSA-aaaa')), reviewed);
    expect(result.failing).toEqual([]);
    expect(result.accepted).toHaveLength(1);
  });

  it('fails on a new advisory', () => {
    expect(judgeAudit(report(advisory('runtime', 'GHSA-bbbb')), reviewed).failing).toHaveLength(1);
  });

  it('fails when a reviewed advisory reaches another package', () => {
    expect(judgeAudit(report(advisory('runtime', 'GHSA-aaaa')), reviewed).failing).toHaveLength(1);
  });

  it('ignores low severity, like --audit-level=moderate', () => {
    expect(judgeAudit(report(advisory('x', 'GHSA-cccc', 'low')), reviewed).failing).toEqual([]);
  });

  it('reports reviewed entries that no longer occur', () => {
    expect(judgeAudit(report(), reviewed).stale).toEqual(['GHSA-aaaa']);
  });

  it('fails when the same advisory also reaches a package listed before the reviewed one', () => {
    const result = judgeAudit(
      report(advisory('runtime', 'GHSA-aaaa'), advisory('tooling', 'GHSA-aaaa')),
      reviewed,
    );
    expect(result.failing.map((a) => a.name)).toEqual(['runtime']);
    expect(result.accepted.map((a) => a.name)).toEqual(['tooling']);
  });

  it('fails closed when npm audit could not produce a report', () => {
    const error = {
      message: 'request to https://registry.npmjs.org failed',
      error: { code: 'ECONNREFUSED' },
    };
    expect(() => judgeAudit(error, reviewed)).toThrow('no report');
    expect(() => judgeAudit({}, reviewed)).toThrow('no report');
  });
});
