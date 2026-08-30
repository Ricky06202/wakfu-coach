import { Fragment } from "react";
import type { ReactNode } from "react";

/**
 * Renderizador de markdown mínimo (sin librerías, sin dangerouslySetInnerHTML).
 * Soporta: títulos, listas, negrita/cursiva, código en línea, enlaces, citas y HR.
 */

function inline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)|_([^_]+)_)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const [, , bold, italic, code, linkText, linkUrl, underline] = m;
    if (bold) parts.push(<strong key={key++}>{bold}</strong>);
    else if (italic) parts.push(<em key={key++}>{italic}</em>);
    else if (underline) parts.push(<u key={key++}>{underline}</u>);
    else if (code) parts.push(<code key={key++} className="rounded bg-panel-2 px-1.5 py-0.5 text-teal">{code}</code>);
    else if (linkText)
      parts.push(
        <a key={key++} href={linkUrl} target="_blank" rel="noopener noreferrer" className="text-teal underline decoration-teal-dim underline-offset-2 hover:text-ember">
          {linkText}
        </a>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function renderBlock(lines: string[], i: number): ReactNode {
  const line = lines[i] as string;

  if (line.startsWith("### ")) return <h3 className="mt-4 text-base font-semibold text-teal">{line.slice(4)}</h3>;
  if (line.startsWith("## ")) return <h2 className="mt-5 text-lg font-bold text-paper">{line.slice(3)}</h2>;
  if (line.startsWith("> ")) return <blockquote className="my-2 border-l-2 border-ember pl-3 text-muted">{inline(line.slice(2))}</blockquote>;
  if (/^\s*[-*•]\s+/.test(line)) return <li className="ml-5 list-disc">{inline(line.replace(/^\s*[-*•]\s+/, ""))}</li>;
  if (/^\s*\d+[.)]\s+/.test(line)) return <li className="ml-5 list-decimal">{inline(line.replace(/^\s*\d+[.)]\s+/, ""))}</li>;
  if (/^\s*---+\s*$/.test(line)) return <hr className="my-3 border-edge" />;
  if (line.trim() === "") return null;
  return <p className="my-1.5 leading-relaxed">{inline(line)}</p>;
}

export function Markdown({ text }: { text: string }): ReactNode {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let inList = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    const isBullet = /^\s*[-*•]\s+/.test(line);
    const isNum = /^\s*\d+[.)]\s+/.test(line);
    if ((isBullet || isNum) && !inList) {
      inList = true;
      blocks.push(<ul key={i} className="my-2 space-y-0.5">{renderBlock(lines, i)}</ul>);
    } else if (!isBullet && !isNum && inList) {
      inList = false;
      blocks.push(renderBlock(lines, i));
    } else {
      blocks.push(<Fragment key={i}>{renderBlock(lines, i)}</Fragment>);
    }
  }

  return <div className="whitespace-pre-wrap">{blocks}</div>;
}
