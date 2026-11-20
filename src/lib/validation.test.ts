import { test, expect, describe } from "bun:test";
import * as os from "os";
import * as path from "path";
import {
  isValidIp,
  isValidDomain,
  parseDomainList,
  validateHostEntry,
  sanitizeText,
  sanitizeSingleLine,
  expandTilde,
} from "./validation";

describe("validation utilities", () => {
  test("validates IPv4, IPv6, and IPv6 with zone ID", () => {
    expect(isValidIp("127.0.0.1")).toBe(true);
    expect(isValidIp("255.255.255.255")).toBe(true);
    expect(isValidIp("::1")).toBe(true);
    expect(isValidIp("fe80::1%lo0")).toBe(true);
    expect(isValidIp("fe80::1%eth0")).toBe(true);

    expect(isValidIp("")).toBe(false);
    expect(isValidIp("999.999.999.999")).toBe(false);
    expect(isValidIp("127.0.0.1\n1.2.3.4")).toBe(false);
    expect(isValidIp("127.0.0.1 localhost")).toBe(false);
    expect(isValidIp("fe80::1%lo0%extra")).toBe(false);
    expect(isValidIp("fe80::1%bad/zone")).toBe(false);
    expect(isValidIp("not-an-ip")).toBe(false);
  });

  test("validates hostnames and rejects injection payloads", () => {
    expect(isValidDomain("localhost")).toBe(true);
    expect(isValidDomain("dev.local")).toBe(true);
    expect(isValidDomain("my-api_1.internal.example.com")).toBe(true);
    expect(isValidDomain("example.local.")).toBe(true);

    expect(isValidDomain("")).toBe(false);
    expect(isValidDomain(".")).toBe(false);
    expect(isValidDomain("-bad.local")).toBe(false);
    expect(isValidDomain("bad-.local")).toBe(false);
    expect(isValidDomain("a..b")).toBe(false);
    expect(isValidDomain("safe.local\n1.2.3.4 evil.com")).toBe(false);
    expect(isValidDomain("safe.local # comment")).toBe(false);
    expect(isValidDomain("safe.local\tevil.com")).toBe(false);
    expect(isValidDomain("bad/path")).toBe(false);
    expect(isValidDomain("a".repeat(64) + ".local")).toBe(false);
    expect(isValidDomain(("a".repeat(50) + ".").repeat(6))).toBe(false);
  });

  test("parseDomainList splits on arbitrary whitespace", () => {
    expect(parseDomainList("  dev.local   test.local\tapi.local  ")).toEqual([
      "dev.local",
      "test.local",
      "api.local",
    ]);
    expect(parseDomainList("   ")).toEqual([]);
  });

  test("validateHostEntry validates combined IP and domains", () => {
    expect(validateHostEntry("127.0.0.1", ["dev.local", "api.local"]).valid).toBe(true);
    expect(validateHostEntry("invalid", ["dev.local"]).valid).toBe(false);
    expect(validateHostEntry("127.0.0.1", []).valid).toBe(false);
    expect(validateHostEntry("127.0.0.1", ["dev.local", "bad#domain"]).valid).toBe(false);
  });

  test("sanitizeText strips ANSI escape sequences and control chars", () => {
    expect(sanitizeText("normal.local")).toBe("normal.local");
    expect(sanitizeText("\x1b[31mred\x1b[0m")).toBe("red");
    expect(sanitizeText("\x1b]52;c;evil\x07safe")).toBe("safe");
    expect(sanitizeText("a\x00b\x07c\x7fd")).toBe("abcd");
  });

  test("sanitizeSingleLine strips CR, LF, and NUL", () => {
    expect(sanitizeSingleLine("127.0.0.1\r\n1.2.3.4\0")).toBe("127.0.0.11.2.3.4");
    expect(sanitizeSingleLine("clean")).toBe("clean");
  });

  test("expandTilde expands bare and prefixed tilde paths", () => {
    expect(expandTilde("~")).toBe(os.homedir());
    expect(expandTilde("~/configs/domains.conf")).toBe(
      path.join(os.homedir(), "configs/domains.conf")
    );
    expect(expandTilde("/etc/hosts")).toBe("/etc/hosts");
  });
});
