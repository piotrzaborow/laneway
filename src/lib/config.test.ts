import { test, expect, describe, afterAll } from "bun:test";
import { exportToConf, importFromConf } from "./config";
import type { HostLine } from "./hosts";
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

describe("XML Config export and import", () => {
  const testFile = path.join(os.tmpdir(), `laneway_test_domains_${process.pid}.conf`);
  const maliciousFile = path.join(os.tmpdir(), `laneway_malicious_${process.pid}.conf`);

  afterAll(() => {
    for (const f of [testFile, maliciousFile]) {
      if (fs.existsSync(f)) {
        fs.unlinkSync(f);
      }
    }
  });

  test("should correctly export and import host lines to XML", () => {
    const lines: HostLine[] = [
      { id: '1', type: 'entry', raw: '', ip: '192.168.0.1', domains: ['my.router'] },
      { id: '2', type: 'comment', raw: '# ignored' },
      { id: '3', type: 'entry', raw: '', ip: '10.0.0.1', domains: ['api.local', 'db.local'] }
    ];

    const exported = exportToConf(lines, testFile);
    expect(exported).toBe(true);
    expect(fs.existsSync(testFile)).toBe(true);

    const imported = importFromConf(testFile);
    expect(imported.length).toBe(2);
    expect(imported[0]!.ip).toBe('192.168.0.1');
    expect(imported[0]!.domains).toEqual(['my.router']);

    expect(imported[1]!.ip).toBe('10.0.0.1');
    expect(imported[1]!.domains).toEqual(['api.local', 'db.local']);

    // Repeated imports must produce distinct IDs even within the same millisecond
    const importedAgain = importFromConf(testFile);
    expect(importedAgain[0]!.id).not.toBe(imported[0]!.id);
  });

  test("should reject injected newlines, comments, invalid IPs, and preserve numeric hostnames", () => {
    const craftedXml = `<?xml version="1.0" encoding="UTF-8"?>
<hosts>
  <entry>
    <ip>127.0.0.1</ip>
    <domain>safe.local
1.2.3.4 hijacked.bank.com</domain>
  </entry>
  <entry>
    <ip>127.0.0.1</ip>
    <domain>safe.local # injected comment</domain>
  </entry>
  <entry>
    <ip>not-an-ip</ip>
    <domain>invalid-ip.local</domain>
  </entry>
  <entry>
    <ip>127.0.0.1</ip>
    <domain>12345</domain>
  </entry>
  <entry>
    <ip>fe80::1%lo0</ip>
    <domain>ipv6.local   multi-space.local</domain>
  </entry>
</hosts>`;

    fs.writeFileSync(maliciousFile, craftedXml, 'utf-8');
    const imported = importFromConf(maliciousFile);

    expect(imported.length).toBe(2);
    expect(imported[0]!.ip).toBe('127.0.0.1');
    expect(imported[0]!.domains).toEqual(['12345']);
    expect(imported[1]!.ip).toBe('fe80::1%lo0');
    expect(imported[1]!.domains).toEqual(['ipv6.local', 'multi-space.local']);
  });

  test("should not expand XML DOCTYPE entities (XML bomb protection)", () => {
    const entityBomb = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE hosts [
  <!ENTITY lol "lol">
  <!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;">
]>
<hosts>
  <entry>
    <ip>127.0.0.1</ip>
    <domain>&lol2;.local</domain>
  </entry>
</hosts>`;

    fs.writeFileSync(maliciousFile, entityBomb, 'utf-8');
    const imported = importFromConf(maliciousFile);
    // Unexpanded entity contains '&' and ';', which fails strict domain validation
    expect(imported).toEqual([]);
  });

  test("should refuse importing from a directory", () => {
    expect(importFromConf(os.tmpdir())).toEqual([]);
  });
});
