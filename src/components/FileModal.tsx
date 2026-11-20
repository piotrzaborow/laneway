import React, { useState, useEffect, useRef, useCallback } from 'react';
import * as fs from 'fs';
import * as path from 'path';
import { expandTilde, sanitizeText } from '../lib/validation';

const VISIBLE_SUGGESTIONS = 8;
const SCROLLBAR_SLOTS = [0, 1, 2, 3, 4, 5, 6, 7] as const;

type FileModalProps = {
  mode: 'export' | 'import';
  fileAction: 'up' | 'down' | 'tab' | 'left' | null;
  onClearAction: () => void;
  onSave: (filePath: string) => void;
  onClose: () => void;
};

type DirCache = {
  dir: string;
  entries: string[];
};

export const FileModal = React.memo(function FileModal({
  mode,
  fileAction,
  onClearAction,
  onSave,
  onClose,
}: FileModalProps) {
  const [dirPath, setDirPath] = useState(() => process.cwd() + '/');
  const [fileName, setFileName] = useState('domains.conf');
  const [focusField, setFocusField] = useState<'dir' | 'file'>('dir');
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const dirCacheRef = useRef<DirCache | null>(null);

  useEffect(() => {
    let isActive = true;
    (async () => {
      try {
        const expandedPath = expandTilde(dirPath);
        let searchDir = process.cwd();
        let searchPrefix = expandedPath;

        const isAbs = path.isAbsolute(expandedPath);

        if (isAbs) {
          if (expandedPath.endsWith('/')) {
            searchDir = expandedPath;
            searchPrefix = '';
          } else {
            searchDir = path.dirname(expandedPath);
            searchPrefix = path.basename(expandedPath);
          }
        } else if (expandedPath.includes('/')) {
          const absolute = path.resolve(expandedPath);
          if (expandedPath.endsWith('/')) {
            searchDir = absolute;
            searchPrefix = '';
          } else {
            searchDir = path.dirname(absolute);
            searchPrefix = path.basename(absolute);
          }
        }

        const resolvedSearchDir = path.resolve(searchDir);
        let processed: string[];

        if (dirCacheRef.current && dirCacheRef.current.dir === resolvedSearchDir) {
          processed = dirCacheRef.current.entries;
        } else {
          try {
            const stats = await fs.promises.stat(resolvedSearchDir);
            if (!stats.isDirectory()) {
              if (isActive) {
                setSuggestions([]);
                setSelectedIndex(0);
                setScrollTop(0);
              }
              return;
            }
            const dirents = await fs.promises.readdir(resolvedSearchDir, { withFileTypes: true });
            if (!isActive) return;

            processed = [];
            for (let i = 0; i < dirents.length; i++) {
              const d = dirents[i]!;
              if (d.isDirectory()) {
                processed.push(d.name + '/');
              }
            }
            processed.sort((a, b) => a.localeCompare(b));
            dirCacheRef.current = { dir: resolvedSearchDir, entries: processed };
          } catch {
            if (isActive) {
              setSuggestions([]);
              setSelectedIndex(0);
              setScrollTop(0);
            }
            return;
          }
        }

        if (!isActive) return;

        let matches = processed;
        if (searchPrefix) {
          const lowerPrefix = searchPrefix.toLowerCase();
          matches = processed.filter((f) => f.toLowerCase().includes(lowerPrefix));
        }

        setSuggestions(matches);
        setSelectedIndex(0);
        setScrollTop(0);
      } catch {
        if (isActive) {
          setSuggestions([]);
          setSelectedIndex(0);
          setScrollTop(0);
        }
      }
    })();
    return () => {
      isActive = false;
    };
  }, [dirPath]);

  useEffect(() => {
    if (!fileAction) return;

    if (fileAction === 'down' && suggestions.length > 0) {
      const next = Math.min(suggestions.length - 1, selectedIndex + 1);
      setSelectedIndex(next);
      setScrollTop(Math.max(0, Math.min(next - 3, suggestions.length - VISIBLE_SUGGESTIONS)));
    }
    if (fileAction === 'up') {
      if (focusField === 'file') {
        setFocusField('dir');
      } else if (suggestions.length > 0) {
        const next = Math.max(0, selectedIndex - 1);
        setSelectedIndex(next);
        setScrollTop(Math.max(0, Math.min(next - 3, suggestions.length - VISIBLE_SUGGESTIONS)));
      }
    }
    if (fileAction === 'tab' && suggestions.length > 0) {
      const selected = suggestions[selectedIndex];
      if (selected) {
        let dir = '';
        if (dirPath.startsWith('~/') || path.isAbsolute(dirPath) || dirPath.includes('/')) {
          dir = dirPath.endsWith('/') ? dirPath : path.dirname(dirPath) + '/';
        }
        const targetPath = dir + selected;
        setDirPath(targetPath);
      }
    }
    if (fileAction === 'left') {
      const parent = path.dirname(expandTilde(dirPath));
      setDirPath(parent === '/' ? '/' : parent + '/');
    }
    onClearAction();
  }, [fileAction, suggestions, selectedIndex, dirPath, focusField, onClearAction]);

  const handleFocusFile = useCallback(() => {
    setFocusField('file');
  }, []);

  const handleSave = useCallback(() => {
    const cleanDir = dirPath.trim();
    const cleanFile = fileName.trim();
    if (cleanDir && cleanFile && !cleanDir.includes('\0') && !cleanFile.includes('\0')) {
      onSave(path.join(expandTilde(cleanDir), cleanFile));
    }
  }, [dirPath, fileName, onSave]);

  const maxScroll = Math.max(1, suggestions.length - VISIBLE_SUGGESTIONS);
  const thumbPosition = Math.round((scrollTop / maxScroll) * (VISIBLE_SUGGESTIONS - 1));

  return (
    <box
      title={mode === 'export' ? 'Export Configuration' : 'Import Configuration'}
      position="absolute"
      top="25%"
      left="25%"
      width="50%"
      height={20}
      backgroundColor="black"
      borderStyle="double"
      borderColor="yellow"
      flexDirection="column"
      padding={1}
      zIndex={10}
    >
      <box flexDirection="column" marginY={1}>
        <box flexDirection="row" marginTop={1}>
          <box width={14}><text>Directory:</text></box>
          <box flexGrow={1}>
            <input
              value={dirPath}
              onInput={setDirPath}
              onChange={setDirPath}
              placeholder="/etc/"
              focused={focusField === 'dir'}
              onSubmit={handleFocusFile}
            />
          </box>
        </box>
        {focusField === 'dir' && (
          <box flexDirection="row" marginTop={1} height={10} border={true} borderStyle="single">
            <box flexDirection="column" flexGrow={1} overflow="hidden">
              {suggestions.slice(scrollTop, scrollTop + VISIBLE_SUGGESTIONS).map((s, i) => {
                const actualIndex = i + scrollTop;
                return (
                  <text key={actualIndex}>
                    {actualIndex === selectedIndex ? '> ' : '  '}{sanitizeText(s)}
                  </text>
                );
              })}
              {suggestions.length === 0 && <text>  (No matches)</text>}
            </box>
            {suggestions.length > VISIBLE_SUGGESTIONS && (
              <box flexDirection="column" width={1}>
                {SCROLLBAR_SLOTS.map((slot) => (
                  <text key={slot}>{slot === thumbPosition ? '█' : '│'}</text>
                ))}
              </box>
            )}
          </box>
        )}

        <box flexDirection="row" marginTop={1}>
          <box width={14}><text>File Name:</text></box>
          <box flexGrow={1}>
            <input
              value={fileName}
              onInput={setFileName}
              onChange={setFileName}
              placeholder="domains.conf"
              focused={focusField === 'file'}
              onSubmit={handleSave}
            />
          </box>
        </box>
      </box>

      <box flexGrow={1} />
      <box border={['top']} borderStyle="single" paddingY={0}>
        <text>Up/Down: Select | Tab/Right: Open | Enter: {mode === 'export' ? 'Export' : 'Import'} | Esc: Cancel</text>
      </box>
    </box>
  );
});
