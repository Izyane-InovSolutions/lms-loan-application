import React from 'react'

/**
 * Renders the plain text used for the terms and privacy notice: blank lines separate
 * paragraphs, "## " starts a heading, "- " starts a list item. Nothing else is
 * interpreted, and the text is never inserted as HTML.
 */
export function SimpleText({ text, className = '' }) {
  const blocks = String(text || '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return (
    <div className={`space-y-3 ${className}`}>
      {blocks.map((block, index) => {
        const lines = block.split('\n')
        if (lines[0].startsWith('## ')) {
          const [heading, ...rest] = lines
          return (
            <section key={index} className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">{heading.slice(3)}</h3>
              {rest.length ? <SimpleLines lines={rest} /> : null}
            </section>
          )
        }
        return <SimpleLines key={index} lines={lines} />
      })}
    </div>
  )
}

function SimpleLines({ lines }) {
  if (lines.every((line) => line.startsWith('- '))) {
    return (
      <ul className="list-disc space-y-1.5 pl-5">
        {lines.map((line, index) => (
          <li key={index}>{line.slice(2)}</li>
        ))}
      </ul>
    )
  }
  return <p>{lines.join(' ')}</p>
}
