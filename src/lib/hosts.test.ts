import { test, expect, describe, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  parseHosts,
  serializeHosts,
  loadSystemHosts,
  saveSystemHosts,
  type HostLine,
} from "./hosts";

describe("hosts file parser and serializer", () => {
  const mockContent = `
# This is a comment
127.0.0.1 localhost
255.255.255.255 broadcasthost
::1             localhost
192.168.1.100 dev.local test.local # my dev server
`;

  const tempHostsFile = path.join(os.tmpdir(), `laneway-hosts-test-${process.pid}.hosts`);
  const originalHostsEnv = process.env.LANEWAY_HOSTS_PATH;

  afterAll(() => {
    if (originalHostsEnv === undefined) {
      delete process.env.LANEWAY_HOSTS_PATH;
    } else {
      process.env.LANEWAY_HOSTS_PATH = originalHostsEnv;
    }
    if (fs.existsSync(tempHostsFile)) {
      fs.unlinkSync(tempHostsFile);
    }
  });

  test("should parse hosts content correctly", () => {
    const lines = parseHosts(mockContent);
    expect(lines.length).toBe(7);

    // First line is blank
    expect(lines[0]!.type).toBe('blank');

    // Second line is comment
    expect(lines[1]!.type).toBe('comment');
    expect(lines[1]!.raw).toBe('# This is a comment');

    // Third line is entry
    expect(lines[2]!.type).toBe('entry');
    expect(lines[2]!.ip).toBe('127.0.0.1');
    expect(lines[2]!.domains).toEqual(['localhost']);

    // Last line with comment
    expect(lines[5]!.type).toBe('entry');
    expect(lines[5]!.ip).toBe('192.168.1.100');
    expect(lines[5]!.domains).toEqual(['dev.local', 'test.local']);
    expect(lines[5]!.comment).toBe('# my dev server');
  });

  test("should parse CRLF line endings and malformed lines safely", () => {
    const crlf = "127.0.0.1\tlocalhost\r\nmalformed-only-one-token\r\n127.0.0.1 # only comment\r\n";
    const lines = parseHosts(crlf);
    expect(lines.length).toBe(4);
    expect(lines[0]!.type).toBe("entry");
    expect(lines[0]!.ip).toBe("127.0.0.1");
    expect(lines[0]!.domains).toEqual(["localhost"]);
    expect(lines[1]!.type).toBe("comment");
    expect(lines[2]!.type).toBe("comment");
    expect(lines[3]!.type).toBe("blank");
  });

  test("should serialize hosts back to correct string", () => {
    const lines = parseHosts(mockContent);

    // Modify one entry
    lines[5]!.ip = '10.0.0.5';
    lines[5]!.domains = ['new.local'];

    const serialized = serializeHosts(lines);
    expect(serialized).toContain('127.0.0.1\tlocalhost');
    expect(serialized).toContain('10.0.0.5\tnew.local # my dev server');
  });

  test("should prevent newline and comment injection during serialization", () => {
    const malicious: HostLine[] = [
      {
        id: "1",
        type: "entry",
        raw: "",
        ip: "127.0.0.1\n1.2.3.4",
        domains: ["safe.local", "evil.local\n5.6.7.8 bank.com", "bad#comment"],
        comment: "unprefixed comment\n9.9.9.9 hijack.com",
      },
      {
        id: "2",
        type: "comment",
        raw: "# comment\n8.8.8.8 injected.com",
      },
    ];

    const serialized = serializeHosts(malicious);
    const outLines = serialized.split(os.EOL);
    expect(outLines.length).toBe(2);
    expect(outLines[0]).toContain("safe.local");
    expect(outLines[0]).not.toContain("bank.com");
    expect(outLines[0]).not.toContain("bad#comment");
    expect(outLines[0]).toContain("# unprefixed comment9.9.9.9 hijack.com");
    expect(outLines[1]).toBe("# comment8.8.8.8 injected.com");
  });

  test("should save and load system hosts atomically preserving permissions", () => {
    fs.writeFileSync(tempHostsFile, "127.0.0.1\tlocalhost\n", { mode: 0o644 });
    process.env.LANEWAY_HOSTS_PATH = tempHostsFile;

    const loaded = loadSystemHosts();
    expect(loaded[0]!.ip).toBe("127.0.0.1");

    loaded.push({
      id: "new-1",
      type: "entry",
      raw: "10.0.0.2\tapp.local",
      ip: "10.0.0.2",
      domains: ["app.local"],
    });

    expect(saveSystemHosts(loaded)).toBe(true);
    const reloaded = loadSystemHosts();
    expect(reloaded.some((l) => l.ip === "10.0.0.2" && l.domains?.[0] === "app.local")).toBe(true);
    if (os.platform() !== "win32") {
      expect(fs.statSync(tempHostsFile).mode & 0o777).toBe(0o644);
    }
  });

  test("should parse and serialize 50,000 lines quickly", () => {
    const bigLines: string[] = [];
    for (let i = 0; i < 50000; i++) {
      bigLines.push(`0.0.0.0\tblocked-${i}.example.test`);
    }
    const bigContent = bigLines.join("\n");

    const start = performance.now();
    const parsed = parseHosts(bigContent);
    const serialized = serializeHosts(parsed);
    const elapsedMs = performance.now() - start;

    expect(parsed.length).toBe(50000);
    expect(serialized.length).toBeGreaterThan(0);
    expect(elapsedMs).toBeLessThan(2000);
  });
});
