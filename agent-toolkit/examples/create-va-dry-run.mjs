#!/usr/bin/env node
import { runUniversaAgentTool } from '../src/index.mjs'

const customerId = process.argv[2] ?? 'cus_demo_active_customer'

const result = await runUniversaAgentTool('universa_prepare_usdc_payout_account', {
  customer_id: customerId,
  source_currency: 'usd',
})

console.log(JSON.stringify(result, null, 2))
