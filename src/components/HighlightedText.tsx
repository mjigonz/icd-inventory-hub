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
  if (text === null || text === undefined || text === '') return null;
  const strText = String(text);
  const trimmed = highlight?.trim();
  if (!trimmed) {
    return <span className={className}>{strText}</span>;
  }

  // Tokenize search keywords by whitespace, filtering out empty strings
  const rawTokens = trimmed
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  if (rawTokens.length === 0) {
    return <span className={className}>{strText}</span>;
  }

  const escapedTokens = rawTokens.map((token) =>
    token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );

  try {
    const regex = new RegExp(`(${escapedTokens.join('|')})`, 'gi');
    const parts = strText.split(regex);

    return (
      <span className={className}>
        {parts.map((part, i) => {
          const partLower = part.toLowerCase();
          const isMatch = rawTokens.some((token) => token === partLower);

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
    return <span className={className}>{strText}</span>;
  }
});
