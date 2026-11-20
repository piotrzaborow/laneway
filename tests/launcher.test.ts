import { test, expect, describe, afterAll } from "bun:test";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const launcher = require("../bin/index.cjs");

describe("launcher security controls", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "laneway-launcher-test-"));

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("validateTrustedUrl allows GitHub HTTPS hosts and rejects others", () => {
    expect(
      launcher.validateTrustedUrl("https://api.github.com/repos/piotrzaborow/laneway/releases/latest")
    ).toBe("https://api.github.com/repos/piotrzaborow/laneway/releases/latest");
    expect(
      launcher.validateTrustedUrl("https://objects.githubusercontent.com/some/asset")
    ).toBe("https://objects.githubusercontent.com/some/asset");

    expect(() => launcher.validateTrustedUrl("http://api.github.com/repos/x/y")).toThrow(
      /non-HTTPS/
    );
    expect(() => launcher.validateTrustedUrl("https://evil.example.com/laneway")).toThrow(
      /untrusted download host/
    );
    expect(() =>
      launcher.validateTrustedUrl("https://evil.example.com/redirect", "https://github.com/a/b")
    ).toThrow(/untrusted download host/);
  });

  test("parseSha256Sums extracts matching binary hash", () => {
    const hashA = "a".repeat(64);
    const hashB = "b".repeat(64);
    const sums = `${hashA}  laneway-linux-x64\n${hashB} *dist/laneway-darwin-arm64\n`;

    expect(launcher.parseSha256Sums(sums, "laneway-linux-x64")).toBe(hashA);
    expect(launcher.parseSha256Sums(sums, "laneway-darwin-arm64")).toBe(hashB);
    expect(launcher.parseSha256Sums(sums, "laneway-windows-x64.exe")).toBeNull();
  });

  test("extractDigestFromAsset parses GitHub release asset sha256 digest", () => {
    const validHash = "0123456789abcdef".repeat(4);
    expect(launcher.extractDigestFromAsset({ digest: `sha256:${validHash}` })).toBe(validHash);
    expect(launcher.extractDigestFromAsset({ digest: "md5:1234" })).toBeNull();
    expect(launcher.extractDigestFromAsset({ digest: "sha256:short" })).toBeNull();
    expect(launcher.extractDigestFromAsset({})).toBeNull();
  });

  test("assertSafePath rejects symlinks and group/world-writable files on POSIX", () => {
    const regularFile = path.join(tempDir, "safe-bin");
    fs.writeFileSync(regularFile, "test", { mode: 0o755 });
    expect(launcher.assertSafePath(regularFile, "file")).toBe(true);

    const symlinkPath = path.join(tempDir, "link-bin");
    fs.symlinkSync(regularFile, symlinkPath);
    expect(() => launcher.assertSafePath(symlinkPath, "file")).toThrow(/symlinked path/);

    if (os.platform() !== "win32") {
      const worldWritable = path.join(tempDir, "writable-bin");
      fs.writeFileSync(worldWritable, "test");
      fs.chmodSync(worldWritable, 0o777);
      expect(() => launcher.assertSafePath(worldWritable, "file")).toThrow(
        /group\/world-writable/
      );
    }
  });
});
