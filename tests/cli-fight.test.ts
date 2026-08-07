import { describe, it, expect } from 'vitest';
import { buildUsage, connectUrl, parseCliArgs } from '../src/cli/fight';

describe('CLI argument parsing and help/usage text', () => {
  it('parses --host, defaulting to 127.0.0.1 when not given', () => {
    expect(parseCliArgs(['--serve']).host).toBe('127.0.0.1');
    expect(parseCliArgs(['--serve', '--host', '192.168.1.99']).host).toBe('192.168.1.99');
  });

  it('recognises --help and its -h short form', () => {
    expect(parseCliArgs(['--help']).help).toBe(true);
    expect(parseCliArgs(['-h']).help).toBe(true);
    expect(parseCliArgs([]).help).toBe(false);
  });

  it('buildUsage() documents the real flags', () => {
    const usage = buildUsage();
    for (const flag of ['--serve', '--connect', '--token', '--side', '--host', '--help']) {
      expect(usage).toContain(flag);
    }
  });

  it('connectUrl embeds the given host instead of a hardcoded 127.0.0.1', () => {
    expect(connectUrl('192.168.1.99', 8991, 'tok')).toContain('192.168.1.99');
    expect(connectUrl('192.168.1.99', 8991, 'tok')).not.toContain('127.0.0.1');
  });
});
