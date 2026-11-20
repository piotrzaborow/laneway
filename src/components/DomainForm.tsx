import React, { useState, useEffect, useCallback } from 'react';
import type { HostLine } from '../lib/hosts';
import { parseDomainList, validateHostEntry } from '../lib/validation';

type DomainFormProps = {
  initialData?: HostLine;
  focusField: 'ip' | 'domain';
  onSave: (ip: string, domain: string) => void;
  onCancel: () => void;
  onFocusChange: (field: 'ip' | 'domain') => void;
};

export const DomainForm = React.memo(function DomainForm({
  initialData,
  focusField,
  onSave,
  onCancel,
  onFocusChange,
}: DomainFormProps) {
  // Re-initialize state when initialData changes (e.g. selecting different items to edit)
  const [ip, setIp] = useState(initialData?.ip || '127.0.0.1');
  const [domain, setDomain] = useState(initialData?.domains?.join(' ') || '');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIp(initialData?.ip || '127.0.0.1');
    setDomain(initialData?.domains?.join(' ') || '');
    setError(null);
  }, [initialData]);

  const handleIpChange = useCallback((value: string) => {
    setIp(value);
    setError(null);
  }, []);

  const handleDomainChange = useCallback((value: string) => {
    setDomain(value);
    setError(null);
  }, []);

  const handleIpSubmit = useCallback(() => {
    onFocusChange('domain');
  }, [onFocusChange]);

  const handleSave = useCallback(() => {
    const trimmedIp = ip.trim();
    const trimmedDomain = domain.trim();
    const parsedDomains = parseDomainList(trimmedDomain);
    const validation = validateHostEntry(trimmedIp, parsedDomains);
    if (!validation.valid) {
      setError(validation.error || 'Invalid IP or domain');
      return;
    }
    setError(null);
    onSave(trimmedIp, parsedDomains.join(' '));
  }, [ip, domain, onSave]);

  return (
    <box
      flexDirection="column"
      padding={1}
      width={40}
      borderStyle="single"
      borderColor={error ? 'red' : 'green'}
    >
      <text>{initialData ? 'Edit Domain' : 'Add New Domain'}</text>
      <text>--------------------------------</text>

      <box flexDirection="row" marginY={1}>
        <box width={10}><text>IP:</text></box>
        <box flexGrow={1}>
          <input
            value={ip}
            onChange={handleIpChange}
            placeholder="127.0.0.1"
            focused={focusField === 'ip'}
            onSubmit={handleIpSubmit}
          />
        </box>
      </box>
      <box flexDirection="row" marginY={1}>
        <box width={10}><text>Domain:</text></box>
        <box flexGrow={1}>
          <input
            value={domain}
            onChange={handleDomainChange}
            placeholder="example.local"
            focused={focusField === 'domain'}
            onSubmit={handleSave}
          />
        </box>
      </box>

      {error && (
        <box marginY={1}>
          <text fg="red">{error}</text>
        </box>
      )}

      <box flexGrow={1} />
      <text>Enter: Save | Esc: Cancel</text>
    </box>
  );
});
