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
                className="bg-amber-300/90 dark:bg-amber-400/30 text-amber-950 dark:text-amber-200 font-extrabold px-0.5 py-0.2 rounded-xs shadow-2xs border-b border-amber-500/50"
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
