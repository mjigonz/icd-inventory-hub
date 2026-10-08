import React, { memo } from 'react';

interface HighlightedTextProps {
  text: string | null | undefined;
  highlight: string;
  className?: string;
}

export const HighlightedText: React.FC<HighlightedTextProps> = memo(({
  text,
  highlight,
  className = '',
}) => {
  if (!text) return null;
  const trimmed = highlight?.trim();
  if (!trimmed) {
    return <span className={className}>{text}</span>;
  }

  // Tokenize search keywords by whitespace, filtering out empty strings
  // and escaping special regex characters
  const tokens = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (tokens.length === 0) {
    return <span className={className}>{text}</span>;
  }

  try {
    const regex = new RegExp(`(${tokens.join('|')})`, 'gi');
    const parts = text.split(regex);

    return (
      <span className={className}>
        {parts.map((part, i) => {
          const isMatch = tokens.some(
            (token) => token.toLowerCase() === part.toLowerCase()
          );

          if (isMatch) {
            return (
              <mark
                key={i}
                className="bg-blue-100 dark:bg-blue-900/50 text-blue-950 dark:text-blue-100 font-bold px-0.5 py-0.2 rounded-xs border-b border-blue-500/40"
              >
                {part}
              </mark>
            );
          }

          return <React.Fragment key={i}>{part}</React.Fragment>;
        })}
      </span>
    );
  } catch {
    return <span className={className}>{text}</span>;
  }
});
