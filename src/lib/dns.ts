import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const DNS_FLUSH_TIMEOUT_MS = 5000;

function resolveTrustedBinary(candidates: readonly string[]): string | null {
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!;
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      // Try next trusted location
    }
  }
  return null;
}

async function runSystemBinary(binary: string, args: readonly string[]): Promise<void> {
  await execFileAsync(binary, [...args], {
    timeout: DNS_FLUSH_TIMEOUT_MS,
    windowsHide: true,
  });
}

export async function flushDns(): Promise<boolean> {
  if (process.env.LANEWAY_DISABLE_FLUSH) {
    return true;
  }

  const platform = os.platform();

  try {
    if (platform === 'darwin') {
      const dscacheutil = resolveTrustedBinary(['/usr/bin/dscacheutil']);
      const killall = resolveTrustedBinary(['/usr/bin/killall']);
      if (!dscacheutil || !killall) {
        console.error('Failed to flush DNS on macOS (required system binaries not found)');
        return false;
      }
      await runSystemBinary(dscacheutil, ['-flushcache']);
      await runSystemBinary(killall, ['-HUP', 'mDNSResponder']);
      return true;
    } else if (platform === 'win32') {
      const systemRoot = process.env.SystemRoot || 'C:\\Windows';
      const ipconfig = path.join(systemRoot, 'System32', 'ipconfig.exe');
      await runSystemBinary(ipconfig, ['/flushdns']);
      return true;
    } else if (platform === 'linux') {
      const resolvectl = resolveTrustedBinary([
        '/usr/bin/resolvectl',
        '/bin/resolvectl',
        '/usr/sbin/resolvectl',
      ]);
      if (resolvectl) {
        try {
          await runSystemBinary(resolvectl, ['flush-caches']);
          return true;
        } catch {
          // Fall through to systemctl restart
        }
      }

      const systemctl = resolveTrustedBinary([
        '/usr/bin/systemctl',
        '/bin/systemctl',
      ]);
      if (systemctl) {
        try {
          await runSystemBinary(systemctl, ['restart', 'systemd-resolved']);
          return true;
        } catch {
          console.error('Failed to flush DNS on Linux (systemd-resolved unavailable)');
          return false;
        }
      }

      console.error('Failed to flush DNS on Linux (no systemd-resolved found)');
      return false;
    }
  } catch (err) {
    console.error('Failed to flush DNS', err);
    return false;
  }

  return false;
}
