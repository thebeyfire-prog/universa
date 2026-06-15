import assert from 'node:assert/strict'
import { UNIVERSA_AGENT_TOOLS, runUniversaAgentTool, toolResultToMcp } from '../src/index.mjs'

assert.ok(UNIVERSA_AGENT_TOOLS.length >= 10)
assert.ok(UNIVERSA_AGENT_TOOLS.some((tool) => tool.name === 'universa_prepare_usdc_payout_account'))

const health = await runUniversaAgentTool('universa_healthcheck')
assert.equal(health.ok, true)
assert.equal(health.safety.live_mutations_require_execute_true, true)

const dryRun = await runUniversaAgentTool('universa_prepare_usdc_payout_account', {
  customer_id: 'cus_demo',
})
assert.equal(dryRun.mode, 'dry_run')
assert.equal(dryRun.requires_approval, true)
assert.equal(dryRun.request.method, 'POST')
assert.equal(dryRun.request.path, '/v1/customers/cus_demo/virtual-accounts')
assert.deepEqual(dryRun.request.body.destination, {
  currency: 'usdc',
  payment_rail: 'solana',
})

const mcp = toolResultToMcp(dryRun)
assert.equal(mcp.content[0].type, 'text')
assert.equal(mcp.structuredContent.mode, 'dry_run')

console.log('agent-toolkit smoke ok')
