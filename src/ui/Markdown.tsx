import { useMemo } from "react"
import type { JSX } from "react"
import { marked, type Tokens, type TokensList } from "marked"
import { TextAttributes } from "@opentui/core"

import { theme } from "./theme"

marked.use({
  gfm: true,
  breaks: true,
  headerIds: false,
  mangle: false,
})

interface MarkdownProps {
  content: string
  textColor?: string
}

interface RenderOptions {
  textColor: string
}

const HORIZONTAL_RULE = "─".repeat(40)

const headingSizeToAttributes: Record<number, number> = {
  1: TextAttributes.BOLD,
  2: TextAttributes.BOLD,
  3: TextAttributes.BOLD,
  4: TextAttributes.BOLD,
  5: TextAttributes.BOLD,
  6: TextAttributes.BOLD,
}

function renderPlainText(text: string, keyPrefix: string) {
  if (!text.includes("\n")) {
    return [text] as const
  }

  const nodes: (string | JSX.Element)[] = []
  const parts = text.split(/\n/g)
  parts.forEach((part, index) => {
    if (index > 0) {
      nodes.push(<br key={`${keyPrefix}-br-${index}`} />)
    }
    if (part.length > 0) {
      nodes.push(part)
    }
  })
  return nodes
}

function renderInline(tokens: Tokens.Token[] | undefined, keyPrefix: string): (string | JSX.Element)[] {
  if (!tokens?.length) {
    return []
  }

  const nodes: (string | JSX.Element)[] = []

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-inline-${index}`

    switch (token.type) {
      case "text":
      case "escape": {
        nodes.push(...renderPlainText(token.text, key))
        break
      }
      case "strong": {
        nodes.push(<b key={key}>{renderInline(token.tokens, key)}</b>)
        break
      }
      case "em": {
        nodes.push(<i key={key}>{renderInline(token.tokens, key)}</i>)
        break
      }
      case "del": {
        nodes.push(
          <span key={key} attributes={TextAttributes.STRIKETHROUGH}>
            {renderInline(token.tokens, key)}
          </span>,
        )
        break
      }
      case "codespan": {
        nodes.push(
          <span
            key={key}
            bg={theme.codeInlineBg}
            fg={theme.codeInlineFg}
            attributes={TextAttributes.DIM}
          >
            {token.text}
          </span>,
        )
        break
      }
      case "br": {
        nodes.push(<br key={key} />)
        break
      }
      case "link": {
        const children = token.tokens?.length ? renderInline(token.tokens, key) : renderPlainText(token.text, key)
        nodes.push(
          <span key={key} fg={theme.linkFg} attributes={TextAttributes.UNDERLINE}>
            {children}
          </span>,
        )
        if (token.href) {
          nodes.push(
            <span key={`${key}-href`} fg={theme.linkSecondaryFg} attributes={TextAttributes.DIM}>
              {` <${token.href}>`}
            </span>,
          )
        }
        break
      }
      case "image": {
        const alt = token.text || "image"
        nodes.push(
          <span key={key} attributes={TextAttributes.DIM}>
            {`[${alt}]`}
          </span>,
        )
        break
      }
      default: {
        if ("tokens" in token && token.tokens) {
          nodes.push(...renderInline(token.tokens, key))
        } else if (token.raw) {
          nodes.push(token.raw)
        }
      }
    }
  })

  return nodes
}

function renderTable(token: Tokens.Table, key: string): JSX.Element {
  const headerRow = token.header.map((cell) => cell.text)
  const dataRows = token.rows.map((row) => row.map((cell) => cell.text))

  const columnWidths = headerRow.map((cell, index) => {
    const dataWidth = Math.max(...dataRows.map((row) => (row[index]?.length ?? 0)))
    return Math.max(cell.length, dataWidth)
  })

  const formatRow = (row: string[]) =>
    row
      .map((cell, index) => {
        const width = columnWidths[index] ?? cell.length
        return cell.padEnd(width, " ")
      })
      .join(" │ ")

  const lines = [formatRow(headerRow), columnWidths.map((width) => "─".repeat(width)).join("─┼─"), ...dataRows.map(formatRow)]

  return (
    <box
      key={key}
      flexDirection="column"
      gap={0}
      style={{
        border: ["left"],
        borderColor: theme.divider,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.tableBg,
      }}
    >
      {lines.map((line, index) => (
        <text key={`${key}-line-${index}`} content={line.length > 0 ? line : " "} wrap={false} fg={theme.tableFg} />
      ))}
    </box>
  )
}

function renderListItem(
  item: Tokens.ListItem,
  key: string,
  symbol: string,
  depth: number,
  options: RenderOptions,
): JSX.Element {
  let inlineTokens: Tokens.Token[] | undefined
  const nestedTokens: Tokens.Token[] = []

  for (const child of item.tokens) {
    if (!inlineTokens && (child.type === "text" || child.type === "paragraph")) {
      inlineTokens = child.type === "paragraph" ? child.tokens : child.tokens ?? [child]
      continue
    }
    nestedTokens.push(child)
  }

  const inlineContent = inlineTokens?.length ? renderInline(inlineTokens, `${key}-inline`) : []
  const nestedContent = nestedTokens.length
    ? renderBlocks(nestedTokens as unknown as TokensList, `${key}-nested`, depth + 1, options)
    : null

  return (
    <box key={key} flexDirection="row" gap={1} alignItems="flex-start">
      <text wrap={false} content={symbol} fg={theme.listBulletFg} />
      <box flexDirection="column" gap={0} flexGrow={1}>
        {inlineContent.length ? (
          <text wrap wrapMode="word" fg={options.textColor}>
            {inlineContent}
          </text>
        ) : null}
        {nestedContent}
      </box>
    </box>
  )
}

function renderBlocks(tokens: TokensList, keyPrefix: string, depth: number, options: RenderOptions): JSX.Element[] {
  const elements: JSX.Element[] = []

  tokens.forEach((token, index) => {
    const key = `${keyPrefix}-block-${index}`

    switch (token.type) {
      case "space": {
        elements.push(<text key={`${key}-space`} content=" " />)
        break
      }
      case "paragraph": {
        elements.push(
          <text key={key} wrap wrapMode="word" fg={options.textColor}>
            {renderInline(token.tokens, key)}
          </text>,
        )
        break
      }
      case "heading": {
        const attributes = headingSizeToAttributes[token.depth] ?? TextAttributes.BOLD
        elements.push(
          <text key={key} attributes={attributes} fg={theme.headingFg} wrap wrapMode="word">
            {renderInline(token.tokens, key)}
          </text>,
        )
        elements.push(<text key={`${key}-after`} content=" " />)
        break
      }
      case "code": {
        const lines = token.text.replace(/\n$/u, "").split("\n")
        elements.push(
          <box
            key={key}
            flexDirection="column"
            gap={0}
            style={{
              border: ["left"],
              borderColor: theme.codeBlockBorder,
              paddingLeft: 1,
              paddingRight: 1,
              backgroundColor: theme.codeBlockBg,
            }}
          >
            {token.lang ? (
              <text fg={theme.codeBlockAccent} attributes={TextAttributes.DIM} wrap={false} content={`// ${token.lang}`} />
            ) : null}
            {lines.map((line, lineIndex) => (
              <text key={`${key}-line-${lineIndex}`} wrap={false} content={line.length > 0 ? line : " "} fg={theme.codeBlockFg} />
            ))}
          </box>,
        )
        elements.push(<text key={`${key}-gap`} content=" " />)
        break
      }
      case "blockquote": {
        elements.push(
          <box
            key={key}
            flexDirection="column"
            gap={0}
            style={{
              border: ["left"],
              borderColor: theme.blockquoteBorder,
              paddingLeft: 2,
              backgroundColor: theme.blockquoteBg,
            }}
          >
            {renderBlocks(token.tokens as TokensList, `${key}-quote`, depth + 1, options)}
          </box>,
        )
        elements.push(<text key={`${key}-after-quote`} content=" " />)
        break
      }
      case "list": {
        const start = token.start === "" ? 1 : Number(token.start || 1)
        const symbols = token.items.map((item, itemIndex) =>
          item.task ? (item.checked ? "[x]" : "[ ]") : token.ordered ? `${start + itemIndex}.` : "•",
        )

        elements.push(
          <box key={key} flexDirection="column" gap={0} style={{ paddingLeft: depth > 0 ? 2 : 0 }}>
            {token.items.map((item, itemIndex) =>
              renderListItem(item, `${key}-item-${itemIndex}`, symbols[itemIndex] ?? "•", depth, options),
            )}
          </box>,
        )
        elements.push(<text key={`${key}-after-list`} content=" " />)
        break
      }
      case "hr": {
        elements.push(
          <text key={key} fg={theme.divider} attributes={TextAttributes.DIM} content={HORIZONTAL_RULE} />,
        )
        break
      }
      case "table": {
        elements.push(renderTable(token, key))
        elements.push(<text key={`${key}-after-table`} content=" " />)
        break
      }
      case "html":
      case "tag": {
        elements.push(
          <text key={key} wrap wrapMode="word" fg={options.textColor}>
            {token.text ?? token.raw}
          </text>,
        )
        break
      }
      case "text": {
        const inlineTokens = token.tokens?.length ? token.tokens : [token]
        elements.push(
          <text key={key} wrap wrapMode="word" fg={options.textColor}>
            {renderInline(inlineTokens, key)}
          </text>,
        )
        break
      }
      default: {
        elements.push(
          <text key={key} wrap wrapMode="word" fg={options.textColor}>
            {token.raw ?? ""}
          </text>,
        )
      }
    }
  })

  return elements
}

export function Markdown({ content, textColor }: MarkdownProps) {
  const sanitizedContent = content.trimEnd()
  const tokens = useMemo(() => marked.lexer(sanitizedContent), [sanitizedContent])
  const resolvedColor = textColor ?? theme.assistantFg

  if (!tokens.length) {
    return <text content={content.length ? content : " "} />
  }

  return (
    <box flexDirection="column" gap={0}>
      {renderBlocks(tokens, "md", 0, { textColor: resolvedColor })}
    </box>
  )
}
