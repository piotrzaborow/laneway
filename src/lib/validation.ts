import * as net from 'net';
import * as os from 'os';
import * as path from 'path';

const IPV6_ZONE_RE = /^[a-zA-Z0-9._-]{1,64}$/;
const DOMAIN_LABEL_RE = /^[a-zA-Z0-9_](?:[a-zA-Z0-9_-]{0,61}[a-zA-Z0-9_])?$/;
const PRINTABLE_ASCII_RE = /^[\x20-\x7e]*$/;
// Matches CSI (\x1b[...), OSC (\x1b]...BEL/ST), and two-byte ESC sequences
const ANSI_ESCAPE_RE = /\x1b(?:\[[0-9;?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;
const CONTROL_CHARS_RE = /[\x00-\x1f\x7f-\x9f]/g;
const NEWLINE_OR_NUL_RE = /[\r\n\0]/g;

/**
 * Validates an IPv4 or IPv6 address (including optional IPv6 zone IDs such as fe80::1%lo0).
 */
export function isValidIp(ip: string): boolean {
  if (!ip || ip.length > 128) return false;
  if (net.isIP(ip) !== 0) return true;

  const zoneIdx = ip.indexOf('%');
  if (zoneIdx !== -1 && ip.indexOf('%', zoneIdx + 1) === -1) {
    const base = ip.slice(0, zoneIdx);
    const zone = ip.slice(zoneIdx + 1);
    return net.isIP(base) === 6 && IPV6_ZONE_RE.test(zone);
  }

  return false;
}

/**
 * Validates a hostname/domain token suitable for /etc/hosts entries.
 * Rejects whitespace, control characters, comments (#), and malformed labels.
 */
export function isValidDomain(domain: string): boolean {
  if (!domain || domain.length > 253) return false;

  const normalized = domain.endsWith('.') ? domain.slice(0, -1) : domain;
  if (!normalized) return false;

  const labels = normalized.split('.');
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    if (!label || !DOMAIN_LABEL_RE.test(label)) {
      return false;
    }
  }
  return true;
}

/**
 * Splits a whitespace-separated domain input string into individual non-empty tokens.
 */
export function parseDomainList(input: string): string[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  return trimmed.split(/\s+/);
}

/**
 * Validates an IP address and list of domains for a host entry.
 */
export function validateHostEntry(
  ip: string,
  domains: string[]
): { valid: boolean; error?: string } {
  if (!isValidIp(ip)) {
    return { valid: false, error: `Invalid IP address: "${sanitizeText(ip)}"` };
  }
  if (!domains || domains.length === 0) {
    return { valid: false, error: 'At least one domain is required' };
  }
  for (let i = 0; i < domains.length; i++) {
    const d = domains[i];
    if (!d || !isValidDomain(d)) {
      return { valid: false, error: `Invalid domain: "${sanitizeText(d ?? '')}"` };
    }
  }
  return { valid: true };
}

/**
 * Strips ANSI terminal escape sequences and control characters before displaying untrusted text.
 */
export function sanitizeText(value: string): string {
  if (!value || PRINTABLE_ASCII_RE.test(value)) {
    return value;
  }
  return value.replace(ANSI_ESCAPE_RE, '').replace(CONTROL_CHARS_RE, '');
}

/**
 * Strips CR, LF, and NUL bytes to guarantee a value cannot inject extra lines into /etc/hosts.
 */
export function sanitizeSingleLine(value: string): string {
  if (!value) return '';
  if (!value.includes('\n') && !value.includes('\r') && !value.includes('\0')) {
    return value;
  }
  return value.replace(NEWLINE_OR_NUL_RE, '');
}

/**
 * Expands a leading "~" to the current user's home directory.
 */
export function expandTilde(p: string): string {
  if (p === '~') {
    return os.homedir();
  }
  if (p.startsWith('~/') || p.startsWith('~\\')) {
    return path.join(os.homedir(), p.slice(2));
  }
  return p;
}
