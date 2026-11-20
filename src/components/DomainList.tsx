import React, { useMemo } from 'react';
import type { HostLine } from '../lib/hosts';
import { sanitizeText } from '../lib/validation';

type DomainRowProps = {
  entry: HostLine;
  isSelected: boolean;
};

const DomainRow = React.memo(function DomainRow({ entry, isSelected }: DomainRowProps) {
  const bg = isSelected ? 'blue' : 'transparent';
  const safeIp = entry.ip ? sanitizeText(entry.ip) : '';
  const domainsStr = entry.domains ? sanitizeText(entry.domains.join(', ')) : '';
  const dirtyMarker = entry.isDirty ? '*' : ' ';

  return (
    <box flexDirection="row" backgroundColor={bg} paddingX={1}>
      <box width={32} flexShrink={0}>
        <text>{isSelected ? '> ' : '  '}{dirtyMarker} {safeIp}</text>
      </box>
      <box width={32} overflow="hidden">
        <text wrapMode="none" truncate={true}>{domainsStr}</text>
      </box>
    </box>
  );
});

type DomainListProps = {
  entries: HostLine[];
  selectedIndex: number;
};

export const DomainList = React.memo(function DomainList({ entries, selectedIndex }: DomainListProps) {
  // Accept either pre-filtered entry lines or raw lines without re-filtering on selection changes
  const domainEntries = useMemo(() => {
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]!.type !== 'entry') {
        return entries.filter((e: HostLine) => e.type === 'entry');
      }
    }
    return entries;
  }, [entries]);

  return (
    <box flexDirection="column" paddingLeft={1} flexGrow={1} height="100%">
      <text>Managed Domains ({domainEntries.length})</text>
      <text>--------------------------------</text>
      <scrollbox flexGrow={1} flexDirection="column">
        {domainEntries.map((entry, index) => (
          <DomainRow
            key={entry.id}
            entry={entry}
            isSelected={index === selectedIndex}
          />
        ))}
      </scrollbox>
    </box>
  );
});
