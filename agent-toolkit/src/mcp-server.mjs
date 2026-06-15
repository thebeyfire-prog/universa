#!/usr/bin/env node
import { UNIVERSA_AGENT_TOOLS, runUniversaAgentTool, toolResultToMcp } from './tools.mjs'

let buffer = Buffer.alloc(0)

process.stdin.on('data', (chunk) => {
  buffer = Buffer.concat([buffer, chunk])
  readMessages()
})

process.stdin.on('end', () => {
  process.exit(0)
})

function readMessages() {
  while (buffer.length) {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) return
    const header = buffer.slice(0, headerEnd).toString('utf8')
    const lengthMatch = header.match(/content-length:\s*(\d+)/i)
    if (!lengthMatch) {
      buffer = Buffer.alloc(0)
      return
    }
    const length = Number(lengthMatch[1])
    const messageStart = headerEnd + 4
    const messageEnd = messageStart + length
    if (buffer.length < messageEnd) return
    const raw = buffer.slice(messageStart, messageEnd).toString('utf8')
    buffer = buffer.slice(messageEnd)
    handleRawMessage(raw)
  }
}

async function handleRawMessage(raw) {
  let message
  try {
    message = JSON.parse(raw)
  } catch (error) {
    writeResponse(null, null, rpcError(-32700, 'Parse error', error.message))
    return
  }

  if (!Object.prototype.hasOwnProperty.call(message, 'id')) {
    return
  }

  try {
    const result = await handleRequest(message.method, message.params ?? {})
    writeResponse(message.id, result)
  } catch (error) {
    writeResponse(message.id, null, rpcError(-32000, error.message))
  }
}

async function handleRequest(method, params) {
  switch (method) {
    case 'initialize':
      return {
        protocolVersion: params.protocolVersion ?? '2024-11-05',
        capabilities: {
          tools: { listChanged: false },
        },
        serverInfo: {
          name: 'universa-agent-toolkit',
          version: '0.1.0',
        },
      }
    case 'ping':
      return {}
    case 'tools/list':
      return {
        tools: UNIVERSA_AGENT_TOOLS.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: {
            readOnlyHint: Boolean(tool.readOnly),
            destructiveHint: false,
            idempotentHint: Boolean(tool.readOnly),
            openWorldHint: !tool.readOnly,
          },
        })),
      }
    case 'tools/call': {
      const name = requiredString(params.name, 'name')
      const args = params.arguments ?? {}
      const result = await runUniversaAgentTool(name, args)
      return toolResultToMcp(result)
    }
    case 'resources/list':
      return { resources: [] }
    case 'prompts/list':
      return { prompts: [] }
    default:
      throw new Error(`Unsupported MCP method: ${method}`)
  }
}

function writeResponse(id, result = null, error = null) {
  const payload = JSON.stringify({
    jsonrpc: '2.0',
    id,
    ...(error ? { error } : { result }),
  })
  const header = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n`
  process.stdout.write(header + payload)
}

function rpcError(code, message, data) {
  return {
    code,
    message,
    ...(data ? { data } : {}),
  }
}

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}
