import { createCliRenderer } from "@opentui/core";
import { createRoot } from "@opentui/react";
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as path from 'path';
import { loadSystemHosts, nextHostLineId, saveSystemHosts } from './lib/hosts';
import type { HostLine } from './lib/hosts';
import { flushDns } from './lib/dns';
import { exportToConf, importFromConf } from './lib/config';
import { expandTilde, parseDomainList, sanitizeText, validateHostEntry } from './lib/validation';
import { DomainList } from './components/DomainList';
import { DomainInfo } from './components/DomainInfo';
import { DomainForm } from './components/DomainForm';
import { FileModal } from './components/FileModal';
import { TopNav } from './components/TopNav';

type AppProps = {
  onExit: () => void;
};

function App({ onExit }: AppProps) {
  const [lines, setLines] = useState<HostLine[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [modalState, setModalState] = useState<'none' | 'add' | 'edit' | 'export' | 'import'>('none');
  const [formFocus, setFormFocus] = useState<'ip' | 'domain'>('ip');
  const [fileAction, setFileAction] = useState<'up' | 'down' | 'tab' | 'left' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>('Ready');
  const isSavingRef = useRef(false);

  useEffect(() => {
    const loaded = loadSystemHosts();

    // Check for --import-config flag
    const args = process.argv;
    const importIndex = args.indexOf('--import-config');
    const importArg = importIndex !== -1 ? args[importIndex + 1] : undefined;
    let imported: HostLine[] = [];

    if (importArg && !importArg.startsWith('--')) {
      const absolutePath = path.resolve(expandTilde(importArg));
      const parsedImport = importFromConf(absolutePath);
      if (parsedImport.length > 0) {
        imported = parsedImport.map((l) => ({ ...l, isDirty: true }));
      }
    }

    if (imported.length > 0) {
      setLines([...loaded, ...imported]);
      setStatusMessage('Unsaved (Imported Configuration)');
    } else {
      setLines(loaded);
      if (importArg) {
        setStatusMessage(`Failed to import from ${sanitizeText(importArg)}`);
      }
    }
  }, []);

  const entryLines = useMemo(
    () => lines.filter((l: HostLine) => l.type === 'entry'),
    [lines]
  );
  const selectedEntry = entryLines[selectedIndex];

  const handleCloseModal = useCallback(() => {
    setModalState('none');
  }, []);

  const handleClearAction = useCallback(() => {
    setFileAction(null);
  }, []);

  const handleSaveDomain = useCallback(
    (ip: string, domain: string) => {
      const trimmedIp = ip.trim();
      const parsedDomains = parseDomainList(domain);
      const validation = validateHostEntry(trimmedIp, parsedDomains);
      if (!validation.valid) {
        setStatusMessage(`Error: ${validation.error || 'Invalid entry'}`);
        return;
      }

      const domainsJoined = parsedDomains.join(' ');

      if (modalState === 'add') {
        const newEntry: HostLine = {
          id: nextHostLineId('entry'),
          type: 'entry',
          raw: `${trimmedIp}\t${domainsJoined}`,
          ip: trimmedIp,
          domains: parsedDomains,
          isDirty: true,
        };
        setLines((prev) => [...prev, newEntry]);
        // Select the newly added entry in O(1)
        setSelectedIndex(entryLines.length);
      } else if (modalState === 'edit' && selectedEntry) {
        const targetId = selectedEntry.id;
        setLines((prev) =>
          prev.map((l) => {
            if (l.id === targetId) {
              const commentSuffix = l.comment ? ` ${l.comment}` : '';
              return {
                ...l,
                ip: trimmedIp,
                domains: parsedDomains,
                raw: `${trimmedIp}\t${domainsJoined}${commentSuffix}`,
                isDirty: true,
              };
            }
            return l;
          })
        );
      }
      setModalState('none');
      setStatusMessage('Unsaved');
    },
    [modalState, entryLines.length, selectedEntry]
  );

  const handleRemoveSelected = useCallback(() => {
    if (entryLines.length > 0 && selectedIndex >= 0 && selectedIndex < entryLines.length) {
      const toRemove = entryLines[selectedIndex];
      if (toRemove) {
        const removeId = toRemove.id;
        setLines((prev) => prev.filter((l: HostLine) => l.id !== removeId));
        if (selectedIndex >= entryLines.length - 1 && selectedIndex > 0) {
          setSelectedIndex(selectedIndex - 1);
        }
        setStatusMessage('Unsaved');
      }
    }
  }, [entryLines, selectedIndex]);

  const handleSaveToHosts = useCallback(async () => {
    if (isSavingRef.current) return;
    isSavingRef.current = true;
    try {
      const snapshot = lines;
      if (saveSystemHosts(snapshot)) {
        const savedById = new Map<string, HostLine>();
        for (let i = 0; i < snapshot.length; i++) {
          const item = snapshot[i]!;
          savedById.set(item.id, item);
        }
        // Only clear dirty flags on entries that have not been modified again since the save snapshot
        setLines((prev) =>
          prev.map((l) => (savedById.get(l.id) === l ? { ...l, isDirty: false } : l))
        );
        setStatusMessage('Saved');

        const flushed = await flushDns();
        if (flushed) {
          setStatusMessage('Ready');
        } else {
          setStatusMessage('Ready (DNS Flush Failed)');
        }
      } else {
        setStatusMessage('Save Failed');
      }
    } finally {
      isSavingRef.current = false;
    }
  }, [lines]);

  const handleExportConf = useCallback(
    (filePath: string) => {
      const absolutePath = path.resolve(expandTilde(filePath));
      if (exportToConf(lines, absolutePath)) {
        setStatusMessage(`Exported to ${sanitizeText(absolutePath)}`);
      } else {
        setStatusMessage(`Failed to export to ${sanitizeText(absolutePath)}`);
      }
      setModalState('none');
    },
    [lines]
  );

  const handleImportConf = useCallback((filePath: string) => {
    const absolutePath = path.resolve(expandTilde(filePath));
    const imported = importFromConf(absolutePath);
    if (imported.length > 0) {
      // Mark imported entries as dirty since they are not in /etc/hosts yet
      const dirtyImported = imported.map((l) => ({ ...l, isDirty: true }));
      setLines((prev) => [...prev, ...dirtyImported]);
      setStatusMessage('Unsaved');
    } else {
      setStatusMessage(`Failed to import from ${sanitizeText(absolutePath)}`);
    }
    setModalState('none');
  }, []);

  // Keep latest state and callbacks in a ref so the raw stdin listener mounts only once
  const keyContextRef = useRef({
    modalState,
    selectedIndex,
    entryCount: entryLines.length,
    hasSelectedEntry: Boolean(selectedEntry),
    handleRemoveSelected,
    handleSaveToHosts,
    onExit,
  });
  keyContextRef.current = {
    modalState,
    selectedIndex,
    entryCount: entryLines.length,
    hasSelectedEntry: Boolean(selectedEntry),
    handleRemoveSelected,
    handleSaveToHosts,
    onExit,
  };

  useEffect(() => {
    const handleGlobalKey = (name: string) => {
      const ctx = keyContextRef.current;

      // If modal is open, let modal components handle specific logic or handle Esc here.
      if (ctx.modalState !== 'none') {
        if (name === 'escape') {
          setModalState('none');
        }
        if (ctx.modalState === 'add' || ctx.modalState === 'edit') {
          if (name === 'up' || name === 'down') {
            setFormFocus((prev) => (prev === 'ip' ? 'domain' : 'ip'));
          }
        }
        if (ctx.modalState === 'export' || ctx.modalState === 'import') {
          if (name === 'up') setFileAction('up');
          if (name === 'down') setFileAction('down');
          if (name === 'tab' || name === 'right') setFileAction('tab');
          if (name === 'left') setFileAction('left');
        }
        return;
      }

      // Main view shortcuts
      if (name === 'up' && ctx.selectedIndex > 0) {
        setSelectedIndex(ctx.selectedIndex - 1);
      }
      if (name === 'down' && ctx.selectedIndex < ctx.entryCount - 1) {
        setSelectedIndex(ctx.selectedIndex + 1);
      }

      // Actions
      if (name === 'a') {
        setModalState('add');
        setFormFocus('ip');
      }
      if (name === 'e' && ctx.hasSelectedEntry) {
        setModalState('edit');
        setFormFocus('ip');
      }
      if (name === 'd' || name === 'delete' || name === 'backspace') ctx.handleRemoveSelected();
      if (name === 's') ctx.handleSaveToHosts();
      if (name === 'x') setModalState('export');
      if (name === 'i') setModalState('import');

      if (name === 'q') ctx.onExit();
    };

    const onData = (data: Buffer) => {
      const str = data.toString();
      if (str === '\u0003') {
        keyContextRef.current.onExit();
        return;
      }

      let name = str.toLowerCase();
      if (str === '\u001b[A') name = 'up';
      else if (str === '\u001b[B') name = 'down';
      else if (str === '\u001b[C') name = 'right';
      else if (str === '\u001b[D') name = 'left';
      else if (str === '\u001b') name = 'escape';
      else if (str === '\u007f' || str === '\b') name = 'backspace';
      else if (str === '\t') name = 'tab';

      handleGlobalKey(name);
    };

    const shouldListen = process.stdin.isTTY || process.env.LANEWAY_TEST_MODE;
    if (shouldListen) {
      if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(true);
      }
      process.stdin.resume();
      process.stdin.on('data', onData);
    }

    return () => {
      if (shouldListen) {
        process.stdin.removeListener('data', onData);
        if (typeof process.stdin.setRawMode === 'function') {
          try {
            process.stdin.setRawMode(false);
          } catch {
            // ignore if TTY already closed
          }
        }
      }
    };
  }, []);

  let statusBarColor = 'gray';
  const lowerStatus = statusMessage.toLowerCase();
  if (statusMessage === 'Ready') statusBarColor = 'green';
  else if (statusMessage === 'Saved') statusBarColor = 'blue';
  else if (statusMessage === 'Unsaved') statusBarColor = 'gray';
  else if (lowerStatus.includes('fail') || lowerStatus.includes('error')) statusBarColor = 'red';
  else if (lowerStatus.includes('exported') || lowerStatus.includes('imported')) statusBarColor = 'green';

  return (
    <box flexDirection="column" width="100%" height="100%">
      <TopNav />

      <box flexGrow={1} flexDirection="row">
        <DomainList
          entries={entryLines}
          selectedIndex={selectedIndex}
        />

        {modalState === 'add' || modalState === 'edit' ? (
          <DomainForm
            initialData={modalState === 'edit' ? selectedEntry : undefined}
            focusField={formFocus}
            onSave={handleSaveDomain}
            onCancel={handleCloseModal}
            onFocusChange={setFormFocus}
          />
        ) : (
          <DomainInfo entry={selectedEntry} />
        )}
      </box>

      {(modalState === 'export' || modalState === 'import') && (
        <FileModal
          mode={modalState}
          fileAction={fileAction}
          onClearAction={handleClearAction}
          onSave={modalState === 'export' ? handleExportConf : handleImportConf}
          onClose={handleCloseModal}
        />
      )}
      <box width="100%" backgroundColor={statusBarColor as any} paddingX={1} justifyContent="space-between">
        <text>Status: {statusMessage}</text>
      </box>
    </box>
  );
}

(async () => {
  const renderer = await createCliRenderer();
  const handleExit = () => {
    try {
      if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
      }
    } catch {
      // ignore terminal restore errors during exit
    }
    try {
      (renderer as any)?.destroy?.();
    } catch {
      // ignore renderer cleanup errors
    }
    process.exit(0);
  };
  createRoot(renderer).render(<App onExit={handleExit} />);
})();
