import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://pvuoslgpooqdvedynjok.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dW9zbGdwb29xZHZlZHluam9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTYyNTksImV4cCI6MjA5NjQ3MjI1OX0.BX5Lif91TBu_XAugKiux5aj7QjpUywNTKAmKPQd5r7w'
const API_ENDPOINT =
  'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api'
const DASHBOARD_API_ENDPOINT =
  'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/dashboard-api'

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const phrases = [
  'ACH deposits into USDC.',
  'MXN payouts from one quote.',
  'Base USDC settlement.',
  'KYC-gated money movement.',
]
const quoteRoutes = {
  mxn: {
    label: 'MXN bank payout',
    currency: 'MXN',
    country: 'mx',
    rate: 17.2,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  brl: {
    label: 'BRL PIX payout',
    currency: 'BRL',
    country: 'br',
    rate: 5.32,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  cop: {
    label: 'COP bank payout',
    currency: 'COP',
    country: 'co',
    rate: 3925,
    decimals: 0,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  gbp: {
    label: 'GBP Faster Payments',
    currency: 'GBP',
    country: 'gb',
    rate: 0.78,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Rates update live',
  },
}
const UNIVERSA_FEE_BPS = 30
const PARTNER_FEE_BPS = 75
const DASHBOARD_PATH = '/dashboard'

let phraseIndex = 0
let toastTimer
let activeQuoteRoute = 'mxn'
let dashboardAccessStatus = 'not_started'
let dashboardApiKeys = []
let activateDashboardPanel = () => {}

function isDashboardPage() {
  return window.location.pathname === DASHBOARD_PATH
    || window.location.pathname === `${DASHBOARD_PATH}.html`
}

function animatePhrase() {
  const target = document.querySelector('#rotating-line')
  if (!target) return
  const phrase = phrases[phraseIndex]
  renderTypingText(target, phrase)
  phraseIndex = (phraseIndex + 1) % phrases.length
}

function prepareAnimatedCopy() {
  // Headline reveals stay CSS-only. Typing animation is reserved for values
  // that actually change, matching the Universa dashboard's keyed character behavior.
}

function observeAnimations() {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return
        entry.target.classList.add('is-visible')
        observer.unobserve(entry.target)
      })
    },
    { threshold: 0.16 },
  )
  document.querySelectorAll('.reveal, .animated-copy').forEach((element) => {
    observer.observe(element)
  })
}

async function signIn() {
  const redirectTo = `${window.location.origin}${DASHBOARD_PATH}`
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo },
  })
  if (error) showToast(error.message)
}

async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) {
    showToast(error.message)
    return
  }
  updateSession(null)
}

function updateSession(session) {
  const portal = document.querySelector('#portal')
  const identity = document.querySelector('#portal-identity')
  const authButtons = document.querySelectorAll('[data-auth-button]')
  const isAuthCallback = hasAuthCallbackParams()

  if (session?.user) {
    if (!isDashboardPage()) {
      if (portal) portal.hidden = true
      authButtons.forEach((button) => {
        button.textContent = 'Open dashboard'
        button.onclick = () => window.location.assign(DASHBOARD_PATH)
      })
      if (isAuthCallback) cleanAuthCallbackParams()
      return
    }

    if (portal) portal.hidden = false
    if (identity) identity.textContent = `Signed in as ${session.user.email ?? 'developer'}`
    authButtons.forEach((button) => {
      button.textContent = 'Open sandbox console'
      button.onclick = () => window.location.assign(DASHBOARD_PATH)
    })
    if (portal && isAuthCallback) {
      cleanAuthCallbackParams()
      portal.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
    }
    loadDashboardAccessState(session)
    return
  }

  if (isDashboardPage()) {
    window.location.replace('/')
    return
  }

  if (portal) portal.hidden = true
  authButtons.forEach((button) => {
    button.textContent =
      button.classList.contains('header-auth') ? 'Sign in' : 'Continue with Google'
    button.onclick = signIn
  })
}

function hasAuthCallbackParams() {
  const params = new URLSearchParams(window.location.search)
  return window.location.hash.includes('access_token')
    || params.has('code')
    || params.has('error')
    || params.has('error_description')
}

function cleanAuthCallbackParams() {
  history.replaceState(null, '', isDashboardPage() ? DASHBOARD_PATH : window.location.pathname)
}

function showToast(message) {
  const toast = document.querySelector('#toast')
  toast.textContent = message
  toast.classList.add('is-visible')
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => toast.classList.remove('is-visible'), 2800)
}

async function initializeAuth() {
  const apiEndpoint = document.querySelector('#api-endpoint')
  const signOutButton = document.querySelector('#sign-out-button')
  if (apiEndpoint) apiEndpoint.textContent = API_ENDPOINT
  if (signOutButton) signOutButton.addEventListener('click', signOut)
  initializeDashboardNavigation()
  initializeFeeControl()

  document.querySelectorAll('[data-copy-target]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = document.querySelector(`#${button.dataset.copyTarget}`)
      if (!target) return
      await copyText(target.textContent.trim(), button.dataset.copyLabel ?? 'Copied')
    })
  })

  document.addEventListener('click', async (event) => {
    const target = event.target
    if (!(target instanceof Element)) return

    const panelButton = target.closest('[data-panel-target]')
    if (panelButton) {
      activateDashboardPanel(panelButton.dataset.panelTarget)
      return
    }

    const copyButton = target.closest('[data-copy-value]')
    if (copyButton) {
      await copyText(copyButton.dataset.copyValue ?? '', copyButton.dataset.copyLabel ?? 'Copied')
      return
    }

    const revokeButton = target.closest('[data-api-key-revoke]')
    if (revokeButton) {
      await revokeDashboardApiKey(revokeButton.dataset.apiKeyRevoke)
    }
  })

  document.querySelectorAll('[data-kyc-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (isKycActive(dashboardAccessStatus)) {
        showToast('Account KYC is active. Create an API key next.')
        return
      }
      await syncDashboardKycStatus()
    })
  })

  document.querySelectorAll('[data-api-key-action]').forEach((button) => {
    button.addEventListener('click', () => handleApiKeyAction(button))
  })

  const {
    data: { session },
  } = await supabase.auth.getSession()
  updateSession(session)

  supabase.auth.onAuthStateChange((_event, nextSession) => {
    updateSession(nextSession)
  })
}

function initializeDashboardNavigation() {
  const shell = document.querySelector('.dashboard-shell')
  const panels = [...document.querySelectorAll('[data-dashboard-panel]')]
  const navLinks = [...document.querySelectorAll('[data-dashboard-nav]')]
  const panelButtons = [...document.querySelectorAll('[data-panel-target]')]
  const menuButton = document.querySelector('[data-dashboard-menu]')
  if (!panels.length) return

  const panelIds = panels.map((panel) => panel.dataset.dashboardPanel)
  const activate = (panelId, updateHash = true) => {
    const nextPanelId = panelIds.includes(panelId) ? panelId : 'home'
    panels.forEach((panel) => {
      const isActive = panel.dataset.dashboardPanel === nextPanelId
      panel.hidden = !isActive
      panel.classList.toggle('is-active', isActive)
    })
    navLinks.forEach((link) => {
      link.classList.toggle('is-active', link.dataset.dashboardNav === nextPanelId)
    })
    if (updateHash) {
      history.replaceState(null, '', `${DASHBOARD_PATH}#${nextPanelId}`)
    }
    shell?.classList.remove('is-sidebar-open')
  }
  activateDashboardPanel = activate

  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault()
      activate(link.dataset.dashboardNav)
    })
  })

  panelButtons.forEach((button) => {
    button.addEventListener('click', () => activate(button.dataset.panelTarget))
  })

  menuButton?.addEventListener('click', () => {
    shell?.classList.toggle('is-sidebar-open')
  })

  document.addEventListener('click', (event) => {
    if (!shell?.classList.contains('is-sidebar-open')) return
    const target = event.target
    if (!(target instanceof Element)) return
    if (target.closest('.dashboard-sidebar') || target.closest('[data-dashboard-menu]')) return
    shell.classList.remove('is-sidebar-open')
  })

  activate(window.location.hash.replace('#', '') || 'home', false)
}

async function loadDashboardAccessState(session) {
  if (!isDashboardPage() || !session?.user) return
  updateDashboardAccessState(statusFromAuthUser(session.user))

  const serverStatus = await readDashboardStatus(session).catch(() => null)
  if (serverStatus) {
    updateDashboardAccessState(serverStatus)
    return
  }

  try {
    const { data, error } = await supabase
      .from('users')
      .select('kyc_status')
      .eq('id', session.user.id)
      .maybeSingle()

    if (!error && data) updateDashboardAccessState(data)
  } catch (_error) {
    // The server status endpoint is the source of truth for account KYC.
  }
}

async function readDashboardStatus(session) {
  const payload = await requestDashboardApi('/status', {
    method: 'GET',
    accessToken: session.access_token,
  })
  const account = payload.account ?? payload.kyc ?? payload
  const apiKeys = Array.isArray(payload.api_keys) ? payload.api_keys : []
  const firstKey = apiKeys.find((key) => key.status === 'active') ?? apiKeys[0] ?? null
  return {
    account_kyc_status: account.account_kyc_status ?? account.status,
    provider_customer_id: account.provider_customer_id,
    kyc_status: account.kyc_status,
    api_keys: apiKeys,
    api_key_prefix: payload.api_key_prefix ?? firstKey?.key_prefix,
  }
}

async function syncDashboardKycStatus() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before syncing KYC.')
    return
  }

  try {
    const payload = await requestDashboardApi('/status/sync', {
      method: 'POST',
      accessToken: session.access_token,
      body: {},
    })
    updateDashboardAccessState({
      account_kyc_status: payload.account?.account_kyc_status,
      provider_customer_id: payload.account?.provider_customer_id,
      kyc_status: payload.account?.kyb_status,
      api_keys: payload.api_keys,
      api_key_prefix: payload.api_keys?.[0]?.key_prefix,
    })
    showToast(
      isKycActive(payload.account?.account_kyc_status)
        ? 'Account KYC is active. API keys are unlocked.'
        : 'Account KYC is still pending.',
    )
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Account KYC sync failed.')
  }
}

async function createDashboardApiKey() {
  if (!isKycActive(dashboardAccessStatus)) {
    showToast('Complete Account KYC before creating API keys.')
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before creating an API key.')
    return
  }

  try {
    const payload = await requestDashboardApi('/api-keys', {
      method: 'POST',
      accessToken: session.access_token,
      body: { name: 'Default server key' },
    })
    const key = payload.api_key ?? payload.key ?? payload
    dashboardApiKeys = [key, ...dashboardApiKeys.filter((existing) => existing.id !== key.id)]
    updateDashboardAccessState({
      account_kyc_status: 'active',
      api_keys: dashboardApiKeys,
      api_key_prefix: key.key_prefix ?? key.prefix ?? key.id,
    })
    showCreatedApiKey(key)
    showToast(
      key.secret
        ? 'API key created. Copy the key and signing secret now; the secret will not be shown again.'
        : 'API key ready.',
    )
  } catch (error) {
    if (error?.code === 'api_key_limit_reached') {
      activateDashboardPanel('api')
      showToast('You already have 10 active keys. Revoke an old key first.')
      return
    }
    showToast(error instanceof Error ? error.message : 'API key creation failed.')
  }
}

async function handleApiKeyAction(button) {
  const activeKeys = dashboardApiKeys.filter((key) => key.status === 'active')
  if (button.dataset.apiKeyAction === 'manage') {
    activateDashboardPanel('api')
    showToast(
      activeKeys.length
        ? 'Existing keys are listed here. Revoke old keys before creating another.'
        : 'Create your first API key from this panel.',
    )
    return
  }
  await createDashboardApiKey()
}

function showCreatedApiKey(key) {
  if (!key.api_key && !key.secret) return
  document.querySelectorAll('[data-created-api-key]').forEach((element) => {
    if (key.api_key) element.textContent = key.api_key
  })
  document.querySelectorAll('[data-created-api-secret]').forEach((element) => {
    if (key.secret) element.textContent = key.secret
  })
  document.querySelectorAll('[data-api-key-output]').forEach((element) => {
    element.hidden = false
  })
}

async function revokeDashboardApiKey(keyId) {
  if (!keyId) return
  if (!window.confirm('Revoke this API key? Requests signed with this key will stop working.')) {
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before revoking an API key.')
    return
  }

  try {
    await requestDashboardApi(`/api-keys/${encodeURIComponent(keyId)}`, {
      method: 'DELETE',
      accessToken: session.access_token,
    })
    const status = await readDashboardStatus(session)
    updateDashboardAccessState(status)
    showToast('API key revoked.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'API key revoke failed.')
  }
}

async function requestDashboardApi(path, options) {
  const response = await fetch(`${DASHBOARD_API_ENDPOINT}${path}`, {
    method: options.method,
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
      apikey: SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(payload.error?.message ?? 'Dashboard API request failed')
    error.code = payload.error?.code
    throw error
  }
  return payload
}

function statusFromAuthUser(user) {
  const metadata = {
    ...(user?.app_metadata ?? {}),
    ...(user?.user_metadata ?? {}),
  }
  return {
    account_kyc_status: metadata.account_kyc_status ?? metadata.kyc_status,
    provider_customer_id: metadata.provider_customer_id,
    kyc_status: metadata.kyc_status,
    api_key_prefix: metadata.api_key_prefix,
  }
}

function updateDashboardAccessState(record = {}) {
  const status = normalizeKycStatus(record.account_kyc_status ?? record.kyc_status)
  dashboardAccessStatus = status
  if (Array.isArray(record.api_keys)) {
    dashboardApiKeys = record.api_keys
    renderApiKeyList(dashboardApiKeys)
    renderHomeApiKeySummary(dashboardApiKeys)
    updateHomeApiKeyAction(dashboardApiKeys)
  }

  const card = document.querySelector('[data-kyc-state-card]')
  const statusLabel = document.querySelector('[data-kyc-status-label]')
  const statusCopy = document.querySelector('[data-kyc-status-copy]')
  const apiStatus = document.querySelector('[data-api-key-status]')
  const apiCopy = document.querySelector('[data-api-key-copy]')
  const apiPreview = document.querySelector('[data-api-key-preview]')
  const kycStep = document.querySelector('[data-kyc-step="kyc"]')
  const vaStep = document.querySelector('[data-kyc-step="va"]')
  const keyStep = document.querySelector('[data-kyc-step="key"]')
  if (!card || !statusLabel || !statusCopy || !apiStatus || !apiCopy || !apiPreview) return

  card.classList.remove('is-active', 'is-pending', 'is-rejected')

  if (isKycActive(status)) {
    const activeKeyCount = dashboardApiKeys.filter((key) => key.status === 'active').length
    card.classList.add('is-active')
    statusLabel.textContent = 'Account KYC active'
    statusCopy.textContent =
      'The provider has approved this account. Universa can issue your virtual account right away and unlock API keys for signed server requests.'
    apiStatus.textContent = activeKeyCount
      ? `${activeKeyCount} active API ${activeKeyCount === 1 ? 'key' : 'keys'}`
      : 'Ready to create'
    apiCopy.textContent = activeKeyCount
      ? 'Existing key prefixes are shown below. Revoke old keys in API docs before creating another one.'
      : 'Create a server key, copy the one-time signing secret into your backend, and use the key prefix for request logs and support.'
    apiPreview.textContent = record.api_key_prefix || record.key_prefix || 'Create a key to reveal prefix'
    if (kycStep) kycStep.textContent = 'KYC active'
    if (vaStep) vaStep.textContent = 'VA ready'
    if (keyStep) keyStep.textContent = 'API keys unlocked'
    return
  }

  if (status === 'rejected' || status === 'denied') {
    card.classList.add('is-rejected')
    statusLabel.textContent = 'Account KYC needs review'
    statusCopy.textContent =
      'The provider did not approve this account yet. Virtual accounts and API keys stay locked until the account is remediated and marked active.'
    apiStatus.textContent = 'Locked'
    apiCopy.textContent = 'Resolve Account KYC before creating server keys or moving live funds.'
    apiPreview.textContent = 'No key issued yet'
    if (kycStep) kycStep.textContent = 'KYC review required'
    if (vaStep) vaStep.textContent = 'VA locked'
    if (keyStep) keyStep.textContent = 'API keys locked'
    return
  }

  if (['pending', 'in_progress', 'manual_review', 'submitted', 'created'].includes(status)) {
    card.classList.add('is-pending')
    statusLabel.textContent = 'Account KYC in review'
    statusCopy.textContent =
      'Waiting for the provider to mark this account active. When the webhook or sync job writes active status, your VA and API key controls unlock here.'
    apiStatus.textContent = 'Locked during review'
    apiCopy.textContent = 'API keys unlock automatically after Account KYC becomes active.'
    apiPreview.textContent = 'No key issued yet'
    if (kycStep) kycStep.textContent = 'KYC in review'
    if (vaStep) vaStep.textContent = 'VA pending'
    if (keyStep) keyStep.textContent = 'API keys locked'
    return
  }

  statusLabel.textContent = 'Account KYC required'
  statusCopy.textContent =
    'Universa uses the same provider-hosted KYC flow . Once the provider marks this account active, your virtual account and API key access unlock together.'
  apiStatus.textContent = 'Locked until Account KYC'
  apiCopy.textContent =
    'After Account KYC is active, create a server key, copy the one-time signing secret into your backend, and use the key prefix for request logs.'
  apiPreview.textContent = 'No key issued yet'
  if (kycStep) kycStep.textContent = 'KYC not started'
  if (vaStep) vaStep.textContent = 'VA locked'
  if (keyStep) keyStep.textContent = 'API keys locked'
}

function renderApiKeyList(keys = dashboardApiKeys) {
  document.querySelectorAll('[data-api-key-list]').forEach((list) => {
    if (!keys.length) {
      list.innerHTML = `<div class="dashboard-empty-row">
        <strong>No API keys yet</strong>
        <span>Create a key after Account KYC is active. Copy credentials directly into a backend secret manager. The full signing secret is shown once.</span>
      </div>`
      return
    }

    list.innerHTML = keys.map((key) => {
      const isActive = key.status === 'active'
      const scopes = Array.isArray(key.scopes) ? key.scopes.join(', ') : 'default scopes'
      return `<article class="api-key-row${isActive ? '' : ' is-revoked'}">
        <div>
          <span class="portal-label">${escapeHtml(key.status ?? 'unknown')}</span>
          <h3>${escapeHtml(key.name ?? 'Server key')}</h3>
          <code>${escapeHtml(key.key_prefix ?? 'No prefix')}</code>
          <p>Created ${escapeHtml(formatDashboardDate(key.created_at))}. Scopes: ${escapeHtml(scopes)}.</p>
          <p class="api-key-secret-note">Signing secrets are shown once at creation and cannot be viewed later. Keep API credentials in backend env vars or a secret manager, never in frontend code, chat, email, or screenshots.</p>
        </div>
        <div class="api-key-row-actions">
          <button type="button" data-copy-value="${escapeAttribute(key.key_prefix ?? '')}" data-copy-label="Key prefix copied">Copy prefix</button>
          ${isActive ? `<button type="button" data-api-key-revoke="${escapeAttribute(key.id)}">Revoke</button>` : ''}
        </div>
      </article>`
    }).join('')
  })
}

function renderHomeApiKeySummary(keys = dashboardApiKeys) {
  const list = document.querySelector('[data-home-api-key-list]')
  if (!list) return
  const activeKeys = keys.filter((key) => key.status === 'active')
  if (!activeKeys.length) {
    list.hidden = true
    list.innerHTML = ''
    return
  }

  const visibleKeys = activeKeys.slice(0, 3)
  const remaining = activeKeys.length - visibleKeys.length
  list.hidden = false
  list.innerHTML = `<p class="portal-label">${activeKeys.length} active API ${activeKeys.length === 1 ? 'key' : 'keys'}</p>
    ${visibleKeys.map((key) => `<div class="home-api-key-row">
      <code>${escapeHtml(key.key_prefix ?? 'No prefix')}</code>
      <button type="button" data-copy-value="${escapeAttribute(key.key_prefix ?? '')}" data-copy-label="Key prefix copied">Copy prefix</button>
    </div>`).join('')}
    ${remaining > 0 ? `<p>${remaining} more ${remaining === 1 ? 'key' : 'keys'} in API docs.</p>` : ''}
    <button class="dashboard-action-secondary" type="button" data-panel-target="api">Manage / revoke keys</button>`
}

function updateHomeApiKeyAction(keys = dashboardApiKeys) {
  const button = document.querySelector('[data-home-api-key-action]')
  if (!button) return
  const activeCount = keys.filter((key) => key.status === 'active').length
  if (activeCount > 0) {
    button.textContent = 'Manage API keys'
    button.dataset.apiKeyAction = 'manage'
    return
  }
  button.textContent = 'Create API key'
  button.dataset.apiKeyAction = 'create'
}

async function copyText(text, label = 'Copied') {
  if (!text) return
  await navigator.clipboard.writeText(text)
  showToast(label)
}

function normalizeKycStatus(status) {
  if (!status) return 'not_started'
  return String(status).trim().toLowerCase().replace(/\s+/g, '_')
}

function isKycActive(status) {
  return ['active', 'approved'].includes(normalizeKycStatus(status))
}

function initializeFeeControl() {
  const input = document.querySelector('#tenant-fee-bps')
  const tenantLabel = document.querySelector('#tenant-fee-label')
  const totalLabel = document.querySelector('#total-fee-label')
  if (!input || !tenantLabel || !totalLabel) return
  const update = () => {
    const tenantBps = Number(input.value)
    tenantLabel.textContent = `${tenantBps} bps`
    totalLabel.textContent = `${tenantBps + UNIVERSA_FEE_BPS} bps`
    updateDashboardFeeDocs(tenantBps)
    updateQuote()
  }
  input.addEventListener('input', update)
  update()
}

function updateDashboardFeeDocs(tenantBps) {
  document.querySelectorAll('[data-tenant-fee-value]').forEach((element) => {
    element.textContent = `${tenantBps} bps`
  })

  const quoteSnippet = document.querySelector('#copy-create-quote')
  if (quoteSnippet) quoteSnippet.textContent = quoteRequestSnippet(tenantBps)

  const llmBrief = document.querySelector('#llm-integration-brief')
  if (llmBrief) llmBrief.textContent = llmIntegrationBrief(tenantBps)
}

function quoteRequestSnippet(tenantBps) {
  return `curl -X POST "$UNIVERSA_API_URL/v1/quotes" \\
  -H "content-type: application/json" \\
  -H "idempotency-key: quote-cus-001" \\
  -H "x-universa-api-key: $UNIVERSA_API_KEY" \\
  -H "x-universa-timestamp: $TIMESTAMP_MS" \\
  -H "x-universa-nonce: $NONCE" \\
  -H "x-universa-signature: $SIGNATURE" \\
  -d '{
    "customer_id": "cus_...",
    "kind": "onramp",
    "amount": "1000.00",
    "tenant_fee_bps": ${tenantBps},
    "source": {
      "currency": "usd",
      "payment_rail": "ach"
    },
    "destination": {
      "currency": "usdc",
      "payment_rail": "base"
    }
  }'`
}

function llmIntegrationBrief(tenantBps) {
  return `Universa API integration brief

Base URL:
${API_ENDPOINT}

Core model:
- Google OAuth only authenticates the dashboard user.
- Server-to-server API calls use Universa API keys and HMAC signatures.
- Partner/provider credentials stay inside Universa and are never sent to the browser or developer client.
- provider-hosted account KYC is the approval gate for the API account, matching the account status model.
- When account_kyc_status is active or kyc_status is approved, Universa can unlock the account virtual account and API key controls.
- Create customers, launch hosted customer KYC, then issue virtual accounts only after customer KYC is active.
- Quotes lock the route and fee breakdown. Transfers consume a quote once.
- Mutating requests should include an idempotency-key.

Authentication:
Headers:
content-type: application/json
idempotency-key: unique-operation-key
x-universa-api-key: $UNIVERSA_API_KEY
x-universa-timestamp: $TIMESTAMP_MS
x-universa-nonce: $NONCE
x-universa-signature: $SIGNATURE

Canonical string:
$TIMESTAMP_MS + "\\n" +
$NONCE + "\\n" +
$METHOD + "\\n" +
$PATH_WITH_QUERY + "\\n" +
sha256($RAW_BODY)

Signature:
hex(hmac_sha256($UNIVERSA_API_SECRET, canonical_string))

Fees:
- Universa platform fee: ${UNIVERSA_FEE_BPS} bps.
- Developer tenant fee from dashboard slider: ${tenantBps} bps.
- Quote requests should send "tenant_fee_bps": ${tenantBps}.
- Quote responses return partner/provider fee, Universa fee, tenant fee, platform fee, network fee, fee currency, and fee bps.
- Persisted tenant fee settings require a dashboard/server API; until then pass tenant_fee_bps per quote.

Recommended flow:
1. Complete account KYC. Treat account_kyc_status = active as the source of truth.
2. Create the server API key after account KYC is active.
3. Create a customer with POST /v1/customers.
4. Start hosted customer KYC with POST /v1/customers/{customer_id}/kyc-sessions.
5. Wait for customer.status = active and provider_kyc_status = active.
6. Create a virtual account with POST /v1/customers/{customer_id}/virtual-accounts.
7. Create a quote with POST /v1/quotes and include tenant_fee_bps.
8. Create a transfer with POST /v1/transfers using the open quote_id.
9. Use GET endpoints for support/reconciliation.
10. Configure webhooks for KYC, virtual account, quote, transfer, payout, and return events.

Endpoints:

POST /v1/customers
Scope: customers:write
Purpose: create individual or business customer records. Money movement stays locked until hosted KYC approval.
Body:
{
  "external_id": "user_123",
  "type": "individual",
  "full_name": "Jane Customer",
  "email": "jane@example.com",
  "country_code": "US",
  "metadata": {}
}

GET /v1/customers/{customer_id}
Scope: customers:read
Purpose: read customer status, provider KYC status, provider reference, metadata, and timestamps.

POST /v1/customers/{customer_id}/kyc-sessions
Scope: kyc:write
Purpose: create provider-hosted KYC session for the customer.
Body: {}
Returns: kyc_session with kyc_url, tos_url, status, expires_at, and updated customer.

POST /v1/customers/{customer_id}/virtual-accounts
Scope: virtual_accounts:write
Purpose: issue reusable fiat deposit details for an approved customer.
Requires: customer.status = active and provider_kyc_status = active.
Body:
{
  "source_currency": "usd",
  "destination": {
    "currency": "usdc",
    "payment_rail": "base",
    "address": "0xYourTreasuryWallet"
  }
}

GET /v1/customers/{customer_id}/virtual-accounts
Scope: virtual_accounts:read
Purpose: list virtual accounts for a customer.

POST /v1/quotes
Scope: quotes:write
Purpose: lock route, amount, fee breakdown, and expiry before transfer execution.
Body:
{
  "customer_id": "cus_...",
  "kind": "onramp",
  "amount": "1000.00",
  "tenant_fee_bps": ${tenantBps},
  "source": {
    "currency": "usd",
    "payment_rail": "ach"
  },
  "destination": {
    "currency": "usdc",
    "payment_rail": "base"
  }
}

POST /v1/transfers
Scope: transfers:write
Purpose: consume an open quote once and create the provider transfer.
Body:
{
  "quote_id": "quo_...",
  "external_id": "transfer_123",
  "source": {
    "currency": "usd",
    "payment_rail": "ach"
  },
  "destination": {
    "currency": "usdc",
    "payment_rail": "base",
    "address": "0xRecipientWallet"
  }
}

GET /v1/transfers/{transfer_id}
Scope: transfers:read
Purpose: retrieve transfer status, amounts, fees, source instructions, and timestamps.

Webhook guidance:
- Store webhook endpoint URL and signing secret server-side.
- Verify event signatures before processing events.
- Treat webhook delivery as the source of truth for async status changes.
- Keep GET transfer/customer lookups for reconciliation and support tooling.
`
}

function initializeQuoteWidget() {
  const amountInput = document.querySelector('#quote-amount')
  const receiveInput = document.querySelector('#quote-to-amount')
  const cycleButtons = document.querySelectorAll('[data-quote-cycle]')
  if (!amountInput || !receiveInput) return

  amountInput.addEventListener('input', () => updateQuote('from'))
  receiveInput.addEventListener('input', () => updateQuote('to'))
  cycleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const keys = Object.keys(quoteRoutes)
      const index = keys.indexOf(activeQuoteRoute)
      activeQuoteRoute = keys[(index + 1) % keys.length]
      updateQuote('from')
    })
  })
  updateQuote('from')
}

function updateQuote(source = 'from') {
  const amountInput = document.querySelector('#quote-amount')
  const receiveInput = document.querySelector('#quote-to-amount')
  const rate = document.querySelector('#quote-rate')
  const topFlag = document.querySelector('#quote-top-flag')
  const inlineFlag = document.querySelector('#quote-inline-flag')
  const topCurrency = document.querySelector('#quote-top-currency')
  const inlineCurrency = document.querySelector('#quote-inline-currency')
  const arrival = document.querySelector('#quote-arrival')
  const totalFees = document.querySelector('#quote-total-fees')
  const liveNote = document.querySelector('#quote-live-note')
  const cta = document.querySelector('.quote-add-recipient')
  const tenantFeeInput = document.querySelector('#tenant-fee-bps')
  if (!amountInput || !receiveInput || !rate || !topFlag || !inlineFlag || !topCurrency || !inlineCurrency) return

  const route = quoteRoutes[activeQuoteRoute] ?? quoteRoutes.mxn
  const tenantBps = Number(tenantFeeInput?.value ?? 20)
  const totalBps = PARTNER_FEE_BPS + UNIVERSA_FEE_BPS + tenantBps

  let gross = clamp(Number(amountInput.value || 0), 0, 10000)
  if (source === 'to') {
    const localTarget = clamp(Number(receiveInput.value || 0), 0, 999999999)
    gross = route.rate > 0
      ? localTarget / route.rate / Math.max(0.0001, 1 - totalBps / 10000)
      : 0
    amountInput.value = formatRawAmount(gross, 2)
  }

  const partner = feeFromBps(gross, PARTNER_FEE_BPS)
  const universa = feeFromBps(gross, UNIVERSA_FEE_BPS)
  const tenant = feeFromBps(gross, tenantBps)
  const total = partner + universa + tenant
  const net = Math.max(gross - total, 0)
  const localAmount = net * route.rate

  if (source !== 'to') {
    receiveInput.value = formatRawAmount(localAmount, route.decimals)
  }

  const flagUrl = `https://flagcdn.com/w160/${route.country}.png`
  topFlag.setAttribute('src', flagUrl)
  inlineFlag.setAttribute('src', flagUrl)
  topCurrency.textContent = route.currency
  inlineCurrency.textContent = route.currency
  renderTypingText(rate, formatFxRate(route))
  if (arrival) arrival.textContent = route.arrival
  if (totalFees) renderTypingText(totalFees, formatUsd(total))
  if (liveNote) liveNote.textContent = route.note
  if (cta) {
    cta.classList.toggle('is-disabled', gross <= 0)
    cta.textContent = gross > 0 ? 'Add recipient' : 'Enter amount'
  }
}

function renderTypingText(element, text) {
  if (element.dataset.value === text) return
  if (reducedMotion) {
    element.dataset.value = text
    element.textContent = text
    return
  }

  const previous = element.dataset.value ?? ''
  const previousIds = parseIds(element.dataset.charIds)
  let nextId = Number(element.dataset.nextCharId ?? '0')
  const ids = new Array(text.length)
  let prefix = 0

  while (prefix < text.length && prefix < previous.length && text[prefix] === previous[prefix]) {
    ids[prefix] = previousIds[prefix]
    prefix += 1
  }

  let nextEnd = text.length - 1
  let prevEnd = previous.length - 1
  while (nextEnd >= prefix && prevEnd >= prefix && text[nextEnd] === previous[prevEnd]) {
    ids[nextEnd] = previousIds[prevEnd]
    nextEnd -= 1
    prevEnd -= 1
  }

  for (let index = prefix; index <= nextEnd; index += 1) {
    ids[index] = nextId
    nextId += 1
  }

  element.dataset.value = text
  element.dataset.charIds = JSON.stringify(ids)
  element.dataset.nextCharId = String(nextId)
  element.replaceChildren(
    ...text.split('').map((character, index) => {
      const span = document.createElement('span')
      const isNew = ids[index] >= Number(element.dataset.nextCharId ?? '0') - (nextEnd - prefix + 1)
      span.className = `typing-char${isNew ? ' is-new' : ''}`
      span.textContent = character === ' ' ? '\u00a0' : character
      span.style.animationDelay = `${Math.min(index * 12, 160)}ms`
      return span
    }),
  )
}

function parseIds(value) {
  if (!value) return []
  try {
    const ids = JSON.parse(value)
    return Array.isArray(ids) ? ids.map((id) => Number(id)) : []
  } catch {
    return []
  }
}

function feeFromBps(amount, bps) {
  return Math.ceil(amount * bps) / 10000
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min
  return Math.min(Math.max(value, min), max)
}

function formatDashboardDate(value) {
  if (!value) return 'unknown date'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return 'unknown date'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}

function formatUsd(value) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

function formatLocal(value, route) {
  return `${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: route.decimals,
    maximumFractionDigits: route.decimals,
  }).format(value)} ${route.currency}`
}

function formatFxRate(route) {
  const decimals = route.rate >= 100 ? 2 : route.rate >= 10 ? 4 : 5
  return `$1 = ${route.rate.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} ${route.currency}`
}

function formatRawAmount(value, decimals) {
  if (!Number.isFinite(value) || value <= 0) return ''
  const fixed = value.toFixed(decimals)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

prepareAnimatedCopy()
animatePhrase()
observeAnimations()
initializeQuoteWidget()
initializeAuth()

if (!reducedMotion) {
  window.setInterval(animatePhrase, 3200)
}
