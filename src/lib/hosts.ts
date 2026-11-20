import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sanitizeSingleLine } from './validation';

export type HostLine = {
  id: string;
  type: 'blank' | 'comment' | 'entry';
  raw: string;
  ip?: string;
  domains?: string[];
  comment?: string;
  isDirty?: boolean;
};

const MAX_HOSTS_FILE_SIZE = 50 * 1024 * 1024; // 50 MB safety cap
let lineIdCounter = 0;

export function nextHostLineId(prefix = 'line'): string {
  return `${prefix}-${++lineIdCounter}`;
}

export function getHostsFilePath(): string {
  if (process.env.LANEWAY_HOSTS_PATH) {
    return process.env.LANEWAY_HOSTS_PATH;
  }
  if (os.platform() === 'win32') {
    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    return path.join(systemRoot, 'System32', 'drivers', 'etc', 'hosts');
  }
  return '/etc/hosts';
}

function isAsciiWhitespace(code: number): boolean {
  return code === 32 || code === 9 || code === 11 || code === 12 || code === 13;
}

function parseSingleLine(line: string): HostLine {
  const id = nextHostLineId('line');
  const len = line.length;

  // Trim leading whitespace
  let start = 0;
  while (start < len && isAsciiWhitespace(line.charCodeAt(start))) {
    start++;
  }

  // Trim trailing whitespace
  let end = len;
  while (end > start && isAsciiWhitespace(line.charCodeAt(end - 1))) {
    end--;
  }

  if (start === end) {
    return { id, type: 'blank', raw: line };
  }

  if (line.charCodeAt(start) === 35 /* '#' */) {
    return { id, type: 'comment', raw: line };
  }

  // Scan IP token
  let ipEnd = start;
  while (ipEnd < end && !isAsciiWhitespace(line.charCodeAt(ipEnd))) {
    ipEnd++;
  }

  if (ipEnd === end) {
    // Malformed line with only one token, preserve as comment/raw
    return { id, type: 'comment', raw: line };
  }

  const ip = line.slice(start, ipEnd);

  // Skip whitespace between IP and rest
  let cursor = ipEnd;
  while (cursor < end && isAsciiWhitespace(line.charCodeAt(cursor))) {
    cursor++;
  }

  // Locate inline comment if present
  const commentIndex = line.indexOf('#', cursor);
  let domainLimit = end;
  let comment: string | undefined = undefined;
  if (commentIndex !== -1 && commentIndex < end) {
    comment = line.slice(commentIndex, end);
    domainLimit = commentIndex;
  }

  // Extract whitespace-separated domain tokens
  const domains: string[] = [];
  while (cursor < domainLimit) {
    while (cursor < domainLimit && isAsciiWhitespace(line.charCodeAt(cursor))) {
      cursor++;
    }
    if (cursor >= domainLimit) break;
    const tokStart = cursor;
    while (cursor < domainLimit && !isAsciiWhitespace(line.charCodeAt(cursor))) {
      cursor++;
    }
    domains.push(line.slice(tokStart, cursor));
  }

  if (domains.length === 0) {
    return { id, type: 'comment', raw: line };
  }

  return { id, type: 'entry', raw: line, ip, domains, comment };
}

export function parseHosts(content: string): HostLine[] {
  const result: HostLine[] = [];
  const totalLen = content.length;
  let pos = 0;

  while (true) {
    const nlIndex = content.indexOf('\n', pos);
    if (nlIndex === -1) {
      const lineEnd =
        totalLen > pos && content.charCodeAt(totalLen - 1) === 13 ? totalLen - 1 : totalLen;
      result.push(parseSingleLine(content.slice(pos, lineEnd)));
      break;
    }

    const lineEnd =
      nlIndex > pos && content.charCodeAt(nlIndex - 1) === 13 ? nlIndex - 1 : nlIndex;
    result.push(parseSingleLine(content.slice(pos, lineEnd)));
    pos = nlIndex + 1;
  }

  return result;
}

const UNSAFE_TOKEN_RE = /[\s#\r\n\0]/;
const UNSAFE_LINE_RE = /[\r\n\0]/;

export function serializeHosts(lines: HostLine[]): string {
  const len = lines.length;
  const out = new Array<string>(len);

  for (let i = 0; i < len; i++) {
    const line = lines[i]!;
    if (line.type === 'entry') {
      const rawIp = line.ip || '';
      const safeIp = UNSAFE_TOKEN_RE.test(rawIp)
        ? sanitizeSingleLine(rawIp).replace(/\s+/g, '')
        : rawIp;

      const domains = line.domains;
      let domainStr = '';
      if (domains) {
        const dLen = domains.length;
        for (let j = 0; j < dLen; j++) {
          const rawDomain = domains[j];
          if (!rawDomain) continue;
          if (!UNSAFE_TOKEN_RE.test(rawDomain)) {
            domainStr = domainStr ? `${domainStr} ${rawDomain}` : rawDomain;
          } else {
            const cleaned = sanitizeSingleLine(rawDomain).trim();
            if (cleaned && !UNSAFE_TOKEN_RE.test(cleaned)) {
              domainStr = domainStr ? `${domainStr} ${cleaned}` : cleaned;
            }
          }
        }
      }

      const rawComment = line.comment;
      if (rawComment) {
        if (rawComment.charCodeAt(0) === 35 /* '#' */ && !UNSAFE_LINE_RE.test(rawComment)) {
          out[i] = `${safeIp}\t${domainStr} ${rawComment}`;
        } else {
          const safeComment = sanitizeSingleLine(rawComment).trim();
          out[i] = safeComment
            ? `${safeIp}\t${domainStr} ${safeComment.startsWith('#') ? safeComment : `# ${safeComment}`}`
            : `${safeIp}\t${domainStr}`;
        }
      } else {
        out[i] = `${safeIp}\t${domainStr}`;
      }
    } else {
      const raw = line.raw;
      out[i] = UNSAFE_LINE_RE.test(raw) ? sanitizeSingleLine(raw) : raw;
    }
  }

  return out.join(os.EOL);
}

export function loadSystemHosts(): HostLine[] {
  const filePath = getHostsFilePath();
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      console.error(`Refusing to read non-regular hosts file: ${filePath}`);
      return [];
    }
    if (stat.size > MAX_HOSTS_FILE_SIZE) {
      console.error(`Hosts file exceeds maximum allowed size (${MAX_HOSTS_FILE_SIZE} bytes)`);
      return [];
    }
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseHosts(content);
  } catch (err) {
    console.error('Failed to read hosts file', err);
    return [];
  }
}

export function saveSystemHosts(lines: HostLine[]): boolean {
  const filePath = getHostsFilePath();
  try {
    const content = serializeHosts(lines);
    let mode = 0o644;
    let isSymlink = false;

    try {
      const lstat = fs.lstatSync(filePath);
      if (lstat.isSymbolicLink()) {
        isSymlink = true;
        const targetStat = fs.statSync(filePath);
        if (!targetStat.isFile()) {
          throw new Error(`Target hosts path is not a regular file: ${filePath}`);
        }
        mode = targetStat.mode & 0o777;
      } else if (!lstat.isFile()) {
        throw new Error(`Target hosts path is not a regular file: ${filePath}`);
      } else {
        mode = lstat.mode & 0o777;
      }
    } catch (statErr: any) {
      if (statErr?.code !== 'ENOENT') {
        throw statErr;
      }
    }

    if (isSymlink) {
      // Preserve symlink target (e.g., managed/WSL/NixOS hosts) rather than replacing the link
      fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode });
      return true;
    }

    const dir = path.dirname(filePath);
    const tmpName = `.laneway-hosts-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tmpPath = path.join(dir, tmpName);

    try {
      fs.writeFileSync(tmpPath, content, { encoding: 'utf-8', mode, flag: 'wx' });
      try {
        fs.renameSync(tmpPath, filePath);
      } catch (renameErr: any) {
        // Fallback for bind-mounted /etc/hosts (e.g. Docker containers) where rename throws EBUSY/EXDEV
        if (
          renameErr?.code === 'EBUSY' ||
          renameErr?.code === 'EXDEV' ||
          renameErr?.code === 'EPERM'
        ) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            // ignore cleanup error
          }
          fs.writeFileSync(filePath, content, { encoding: 'utf-8', mode });
        } else {
          throw renameErr;
        }
      }
    } catch (writeErr) {
      try {
        fs.unlinkSync(tmpPath);
      } catch {
        // ignore cleanup error
      }
      throw writeErr;
    }

    return true;
  } catch (err) {
    const privMsg = os.platform() === 'win32' ? 'Administrator privileges' : 'sudo privileges';
    console.error(`Failed to write hosts file (do you have ${privMsg}?)`, err);
    return false;
  }
}
