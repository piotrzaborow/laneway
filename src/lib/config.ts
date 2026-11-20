import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { XMLParser, XMLBuilder } from 'fast-xml-parser';
import { nextHostLineId, type HostLine } from './hosts';
import { isValidDomain, isValidIp, parseDomainList } from './validation';

const MAX_CONFIG_FILE_SIZE = 10 * 1024 * 1024; // 10 MB safety cap

const xmlBuilder = new XMLBuilder({
  ignoreAttributes: false,
  format: true,
});

const xmlParser = new XMLParser({
  ignoreAttributes: true,
  processEntities: false,
  htmlEntities: false,
  parseTagValue: false,
  maxNestedTags: 10,
  isArray: (name) => name === 'entry',
});

export function exportToConf(lines: HostLine[], filePath = 'domains.conf'): boolean {
  try {
    const entries: Array<{ ip: string; domain: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      if (line.type === 'entry' && line.ip && line.domains && line.domains.length > 0) {
        entries.push({
          ip: line.ip,
          domain: line.domains.join(' '),
        });
      }
    }

    const obj = {
      '?xml': { '@_version': '1.0', '@_encoding': 'UTF-8' },
      hosts: {
        entry: entries,
      },
    };

    const xmlContent = xmlBuilder.build(obj);
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });

    // Refuse to overwrite a directory or non-regular file
    try {
      const stat = fs.lstatSync(filePath);
      if (!stat.isFile()) {
        throw new Error(`Target path is not a regular file: ${filePath}`);
      }
    } catch (statErr: any) {
      if (statErr?.code !== 'ENOENT') {
        throw statErr;
      }
    }

    const tmpName = `.laneway-export-${process.pid}-${crypto.randomBytes(6).toString('hex')}.tmp`;
    const tmpPath = path.join(dir, tmpName);
    try {
      fs.writeFileSync(tmpPath, xmlContent, { encoding: 'utf-8', mode: 0o600, flag: 'wx' });
      fs.renameSync(tmpPath, filePath);
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
    console.error('Failed to export to XML config', err);
    return false;
  }
}

export function importFromConf(filePath = 'domains.conf'): HostLine[] {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      console.error(`Refusing to import from non-regular file: ${filePath}`);
      return [];
    }
    if (stat.size > MAX_CONFIG_FILE_SIZE) {
      console.error(`Config file exceeds maximum allowed size (${MAX_CONFIG_FILE_SIZE} bytes)`);
      return [];
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const parsed = xmlParser.parse(content);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed, 'hosts') ||
      !parsed.hosts ||
      typeof parsed.hosts !== 'object' ||
      !Object.prototype.hasOwnProperty.call(parsed.hosts, 'entry') ||
      !Array.isArray(parsed.hosts.entry)
    ) {
      return [];
    }

    const rawEntries = parsed.hosts.entry;
    const result: HostLine[] = [];

    for (let i = 0; i < rawEntries.length; i++) {
      const entry = rawEntries[i];
      if (!entry || typeof entry !== 'object') {
        continue;
      }

      const rawIp = entry.ip;
      const rawDomain = entry.domain;
      if (typeof rawIp !== 'string' || typeof rawDomain !== 'string') {
        continue;
      }

      const ip = rawIp.trim();
      const trimmedDomain = rawDomain.trim();

      // Reject embedded newlines, NUL bytes, or inline comments to prevent hosts file injection
      if (/[\r\n\0#]/.test(ip) || /[\r\n\0#]/.test(trimmedDomain)) {
        continue;
      }

      if (!isValidIp(ip)) {
        continue;
      }

      const domains = parseDomainList(trimmedDomain);
      if (domains.length === 0) {
        continue;
      }

      let allDomainsValid = true;
      for (let j = 0; j < domains.length; j++) {
        if (!isValidDomain(domains[j]!)) {
          allDomainsValid = false;
          break;
        }
      }
      if (!allDomainsValid) {
        continue;
      }

      result.push({
        id: nextHostLineId('xml'),
        type: 'entry',
        raw: `${ip}\t${domains.join(' ')}`,
        ip,
        domains,
      });
    }

    return result;
  } catch (err) {
    console.error('Failed to import from XML config', err);
    return [];
  }
}
