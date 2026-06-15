import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm'

const SUPABASE_URL = 'https://pvuoslgpooqdvedynjok.supabase.co'
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2dW9zbGdwb29xZHZlZHluam9rIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA4OTYyNTksImV4cCI6MjA5NjQ3MjI1OX0.BX5Lif91TBu_XAugKiux5aj7QjpUywNTKAmKPQd5r7w'
const MONET_SUPABASE_URL = 'https://ldskrqjoueglruyficfa.supabase.co'
const MONET_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxkc2tycWpvdWVnbHJ1eWZpY2ZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ0MTY3MzUsImV4cCI6MjA4OTk5MjczNX0.lY8GZ-JPYNvI0CHpf1D_Zh4d-fLhffp359BsetSQrL0'
const API_ENDPOINT =
  'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/platform-api'
const DASHBOARD_API_ENDPOINT =
  'https://pvuoslgpooqdvedynjok.supabase.co/functions/v1/dashboard-api'
const UNV_VAULT_ENDPOINT = '/api/unv-vault'
const UNV_MINT = '9Z5r1ifXHw8aoMHxYsQavghxjHLMPQK9sjrwDjDR9sQq'
const UNV_VAULT_TOKEN_ACCOUNT = '6DnZQZEgLAFeEBvF2BX4f523uhfsRDSoXyMPcEWWUG36'
const UNV_VAULT_FALLBACK_BALANCE = 5_000_000
const TOKEN_PRICE_TOPIC = 'token-prices'
const TOKEN_PRICE_WATCH_HEARTBEAT_MS = 25_000
const UNV_VAULT_SNAPSHOT_POLL_MS = 15_000

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
const monetSupabase = createClient(MONET_SUPABASE_URL, MONET_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
const phrases = [
  'ACH deposits into USDC.',
  'MXN payouts from one quote.',
  'Solana USDC settlement.',
  'KYC-gated money movement.',
]
const quoteRoutes = {
  mxn: {
    label: 'MXN bank payout',
    currency: 'MXN',
    country: 'mx',
    countryName: 'Mexico',
    locale: 'es-MX',
    rail: 'SPEI',
    rate: 17.2,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  brl: {
    label: 'BRL PIX payout',
    currency: 'BRL',
    country: 'br',
    countryName: 'Brazil',
    locale: 'pt-BR',
    rail: 'PIX',
    rate: 5.32,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  cop: {
    label: 'COP bank payout',
    currency: 'COP',
    country: 'co',
    countryName: 'Colombia',
    locale: 'es-CO',
    rail: 'Bank',
    rate: 3925,
    decimals: 0,
    arrival: 'Usually within 30 minutes',
    note: 'Exchange cost included in the rate',
  },
  gbp: {
    label: 'GBP Faster Payments',
    currency: 'GBP',
    country: 'gb',
    countryName: 'United Kingdom',
    locale: 'en-GB',
    rail: 'Faster Payments',
    rate: 0.78,
    decimals: 2,
    arrival: 'Usually within 30 minutes',
    note: 'Rates update live',
  },
}
const COUNTRY_CURRENCY_MAP = {
  US: 'USD',
  MX: 'MXN',
  BR: 'BRL',
  CO: 'COP',
  GB: 'GBP',
}
const UNIVERSA_FEE_BPS = 30
const PARTNER_FEE_BPS = 75
const DASHBOARD_PATH = '/dashboard'
const DASHBOARD_THEME_STORAGE_KEY = 'universa-dashboard-theme'
const DEFAULT_WEBHOOK_SUBSCRIPTIONS = [
  'customer.*',
  'customer_wallet.*',
  'kyc_session.*',
  'virtual_account.*',
  'quote.*',
  'transfer.*',
  'webhook.test',
]
const ONRAMP_VISIBILITY_STORAGE_KEY = 'universa:onramp-visibility:v1'
const GOOGLE_ICON_SVG = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"></path>
  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"></path>
  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"></path>
  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"></path>
</svg>`

let phraseIndex = 0
let toastTimer
let activeQuoteRoute = 'mxn'
let dashboardAnimationFrame
let dashboardAccount = null
let dashboardAccessStatus = 'not_started'
let dashboardApiKeys = []
let dashboardMetrics = null
let dashboardResources = {
  customers: [],
  virtual_accounts: [],
  transfers: [],
}
let dashboardSelectedCustomerId = ''
let dashboardPaymentQuote = null
let dashboardPaymentTransfer = null
let dashboardPaymentKind = 'onramp'
let dashboardPaymentFlowMode = 'quote'
let dashboardPaymentInFlight = false
let dashboardOnrampVisibility = loadOnrampVisibilityState()
let dashboardRewards = null
let dashboardHoldings = null
let dashboardHoldingsInFlight = false
let activeHoldingsAsset = 'usdc'
let rewardWalletAssignmentInFlight = false
let dashboardWebhookEndpoints = []
let dashboardWebhookDeliveries = []
let oneTimeSecretModalState = {
  key: '',
  secret: '',
  secretViewed: false,
}
let unvLiveVaultState = {
  vaultBalance: UNV_VAULT_FALLBACK_BALANCE,
  priceUsd: null,
}
let activateDashboardPanel = () => {}

function updateVisualViewportWidth() {
  const layoutWidth = Math.ceil(document.documentElement.clientWidth || window.innerWidth || 0)
  const screenWidth = Math.ceil(window.screen?.width || layoutWidth || 0)
  const visualWidth = Math.ceil(Math.max(
    window.innerWidth || 0,
    window.visualViewport?.width || 0,
    document.documentElement.clientWidth || 0,
    screenWidth || 0,
  ))
  const shellWidth = Math.max(
    320,
    Math.min(layoutWidth || visualWidth || screenWidth, screenWidth || layoutWidth || visualWidth),
  )
  if (!visualWidth) return
  document.documentElement.style.setProperty('--universa-visual-width', `${Math.max(visualWidth, shellWidth)}px`)
  document.documentElement.style.setProperty('--universa-visual-shell-width', `${Math.max(shellWidth - 28, 292)}px`)
}

function initializeVisualViewportGuard() {
  updateVisualViewportWidth()
  let queued = false
  const schedule = () => {
    if (queued) return
    queued = true
    window.requestAnimationFrame(() => {
      queued = false
      updateVisualViewportWidth()
    })
  }
  window.addEventListener('resize', schedule, { passive: true })
  window.addEventListener('orientationchange', schedule, { passive: true })
  window.visualViewport?.addEventListener('resize', schedule, { passive: true })
  window.visualViewport?.addEventListener('scroll', schedule, { passive: true })
}

function isDashboardPage() {
  return window.location.pathname === DASHBOARD_PATH
    || window.location.pathname === `${DASHBOARD_PATH}/`
    || window.location.pathname === `${DASHBOARD_PATH}.html`
}

function dashboardRoutePath() {
  if (window.location.pathname === `${DASHBOARD_PATH}/`) return `${DASHBOARD_PATH}/`
  if (window.location.pathname.endsWith('.html')) return window.location.pathname
  return DASHBOARD_PATH
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

function renderAuthButton(button, label, options = {}) {
  button.classList.toggle('google-auth-button', Boolean(options.google))
  if (options.google) {
    button.innerHTML = `${GOOGLE_ICON_SVG}<span>${label}</span>`
    return
  }
  button.textContent = label
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
        renderAuthButton(button, 'Open dashboard')
        button.onclick = () => window.location.assign(DASHBOARD_PATH)
      })
      if (isAuthCallback) cleanAuthCallbackParams()
      return
    }

    if (portal) portal.hidden = false
    if (identity) identity.textContent = `Signed in as ${session.user.email ?? 'developer'}`
    authButtons.forEach((button) => {
      renderAuthButton(button, 'Open sandbox console')
      button.onclick = () => window.location.assign(DASHBOARD_PATH)
    })
    if (portal && isAuthCallback) {
      cleanAuthCallbackParams()
      portal.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
    }
    loadDashboardAccessState(session)
    loadRewardsState(session)
    loadWebhooksState(session)
    return
  }

  if (isDashboardPage()) {
    window.location.replace('/')
    return
  }

  if (portal) portal.hidden = true
  authButtons.forEach((button) => {
    renderAuthButton(button, 'Sign in with Google', { google: true })
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

function initializeOneTimeSecretModal() {
  const modal = document.querySelector('[data-one-time-secret-modal]')
  if (!modal) return

  modal.querySelectorAll('[data-one-time-secret-close]').forEach((button) => {
    button.addEventListener('click', closeOneTimeSecretModal)
  })

  modal.querySelector('[data-one-time-secret-view]')?.addEventListener('click', () => {
    revealOneTimeSecret()
  })

  modal.querySelectorAll('[data-one-time-secret-copy]').forEach((button) => {
    button.addEventListener('click', async () => {
      const target = button.dataset.oneTimeSecretCopy
      if (target === 'secret' && !oneTimeSecretModalState.secretViewed) {
        showToast('Click View secret first.')
        return
      }
      const value = target === 'key'
        ? oneTimeSecretModalState.key
        : oneTimeSecretModalState.secret
      await copyText(
        value,
        target === 'key'
          ? 'API key copied. Store it server-side.'
          : 'Signing secret copied. Store it now.',
      )
    })
  })
}

function openOneTimeSecretModal(options) {
  const modal = document.querySelector('[data-one-time-secret-modal]')
  if (!modal || !options?.secretValue) return

  oneTimeSecretModalState = {
    key: options.keyValue ?? '',
    secret: options.secretValue,
    secretViewed: false,
  }

  const keyField = modal.querySelector('[data-one-time-secret-key-field]')
  const keyValue = modal.querySelector('[data-one-time-secret-key]')
  const keyLabel = modal.querySelector('[data-one-time-secret-key-label]')
  const secretValue = modal.querySelector('[data-one-time-secret-secret]')
  const secretLabel = modal.querySelector('[data-one-time-secret-secret-label]')
  const secretCopyButton = modal.querySelector('[data-one-time-secret-copy="secret"]')
  const viewButton = modal.querySelector('[data-one-time-secret-view]')

  modal.querySelector('[data-one-time-secret-kicker]').textContent = options.kicker ?? 'One-time secret'
  modal.querySelector('[data-one-time-secret-title]').textContent = options.title ?? 'Save this credential now'
  modal.querySelector('[data-one-time-secret-description]').textContent =
    options.description
      ?? 'This secret can only be viewed once. Store it in a backend secret manager before closing this modal.'

  if (options.keyValue) {
    keyField.hidden = false
    keyLabel.textContent = options.keyLabel ?? 'API key'
    keyValue.textContent = options.keyValue
  } else {
    keyField.hidden = true
    keyValue.textContent = ''
  }

  secretLabel.textContent = options.secretLabel ?? 'Signing secret'
  secretValue.textContent = 'Hidden until viewed'
  secretValue.classList.add('is-hidden-secret')
  secretCopyButton.disabled = true
  viewButton.disabled = false
  viewButton.textContent = 'View secret'

  modal.hidden = false
  document.body.classList.add('modal-open')
  viewButton.focus()
}

function revealOneTimeSecret() {
  const modal = document.querySelector('[data-one-time-secret-modal]')
  if (!modal || !oneTimeSecretModalState.secret) return
  const secretValue = modal.querySelector('[data-one-time-secret-secret]')
  const secretCopyButton = modal.querySelector('[data-one-time-secret-copy="secret"]')
  const viewButton = modal.querySelector('[data-one-time-secret-view]')
  oneTimeSecretModalState.secretViewed = true
  secretValue.textContent = oneTimeSecretModalState.secret
  secretValue.classList.remove('is-hidden-secret')
  secretCopyButton.disabled = false
  viewButton.disabled = true
  viewButton.textContent = 'Secret visible'
  secretCopyButton.focus()
}

function closeOneTimeSecretModal() {
  const modal = document.querySelector('[data-one-time-secret-modal]')
  if (!modal) return
  const keyField = modal.querySelector('[data-one-time-secret-key-field]')
  const keyValue = modal.querySelector('[data-one-time-secret-key]')
  const secretValue = modal.querySelector('[data-one-time-secret-secret]')
  const secretCopyButton = modal.querySelector('[data-one-time-secret-copy="secret"]')
  const viewButton = modal.querySelector('[data-one-time-secret-view]')
  modal.hidden = true
  document.body.classList.remove('modal-open')
  if (keyField) keyField.hidden = true
  if (keyValue) keyValue.textContent = ''
  if (secretValue) {
    secretValue.textContent = 'Hidden until viewed'
    secretValue.classList.add('is-hidden-secret')
  }
  if (secretCopyButton) secretCopyButton.disabled = true
  if (viewButton) {
    viewButton.disabled = false
    viewButton.textContent = 'View secret'
  }
  oneTimeSecretModalState = {
    key: '',
    secret: '',
    secretViewed: false,
  }
}

function initializeHoldingsModal() {
  const modal = document.querySelector('[data-holdings-modal]')
  if (!modal) return

  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeHoldingsModal()
  })
  modal.querySelectorAll('[data-holdings-close]').forEach((button) => {
    button.addEventListener('click', closeHoldingsModal)
  })
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !modal.hidden) closeHoldingsModal()
  })
}

function initializePaymentFlowModal() {
  const modal = document.querySelector('[data-payment-flow-modal]')
  if (!modal) return

  modal.addEventListener('click', (event) => {
    const target = event.target
    if (target instanceof Element) {
      const visibilityButton = target.closest('[data-payment-visibility-action]')
      if (visibilityButton) {
        event.preventDefault()
        handlePaymentVisibilityAction(visibilityButton)
        return
      }
    }
    if (event.target === modal) closePaymentFlowModal()
  })

  document.querySelectorAll('[data-payment-kind]').forEach((button) => {
    button.addEventListener('click', () => {
      setDashboardPaymentKind(button.dataset.paymentKind ?? 'onramp')
    })
  })

  document.querySelector('[data-payment-create-quote]')?.addEventListener('click', () => {
    createDashboardPaymentQuote()
  })
  document.querySelector('[data-payment-review-transfer]')?.addEventListener('click', () => {
    reviewDashboardPaymentTransfer()
  })
  const confirmModal = document.querySelector('[data-payment-confirm-modal]')
  confirmModal?.addEventListener('click', (event) => {
    if (event.target === confirmModal) closePaymentConfirmModal()
  })
  document.querySelectorAll('[data-payment-confirm-close]').forEach((button) => {
    button.addEventListener('click', closePaymentConfirmModal)
  })
  document.querySelector('[data-payment-confirm-send]')?.addEventListener('click', () => {
    confirmDashboardPaymentTransfer()
  })
  document.querySelector('[data-payment-customer-select]')?.addEventListener('change', () => {
    dashboardPaymentQuote = null
    dashboardPaymentTransfer = null
    closePaymentConfirmModal()
    renderRecentPaymentBankOptions()
    renderPaymentVirtualAccount()
    updatePaymentFlowRoute()
    renderPaymentFlowResult()
    updatePaymentFlowActions()
  })
  document.querySelector('[data-payment-bank-select]')?.addEventListener('change', applySelectedPaymentBank)
  document.querySelectorAll('[data-payment-bank-account-name], [data-payment-bank-name], [data-payment-bank-routing], [data-payment-bank-account]').forEach((input) => {
    input.addEventListener('input', () => {
      dashboardPaymentQuote = null
      dashboardPaymentTransfer = null
      closePaymentConfirmModal()
      updatePaymentFlowActions()
    })
  })

  renderPaymentCustomerOptions()
  renderPaymentSourceWallet()
  renderPaymentFlowGuide()
  updatePaymentBankPanel()
  updatePaymentFlowRoute()
  renderPaymentVirtualAccount()
  updatePaymentFlowActions()
}

function openPaymentFlowModal(mode = 'onramp') {
  const modal = document.querySelector('[data-payment-flow-modal]')
  if (!modal) return
  const normalizedMode = mode === 'offramp' || mode === 'transfer'
    ? 'transfer'
    : 'quote'
  dashboardPaymentQuote = null
  dashboardPaymentTransfer = null
  setDashboardPaymentKind(normalizedMode === 'transfer' ? 'offramp' : 'onramp')
  setPaymentFlowMode(normalizedMode)
  renderPaymentCustomerOptions()
  renderPaymentFlowResult()
  modal.hidden = false
  document.body.classList.add('modal-open')
  updateQuote('from')
  const focusTarget = normalizedMode === 'transfer'
    ? modal.querySelector('[data-payment-review-transfer]')
    : dashboardPaymentKind === 'onramp'
      ? modal.querySelector('[data-payment-customer-select]')
    : modal.querySelector('[data-payment-create-quote]')
  focusTarget?.focus()
}

function closePaymentFlowModal() {
  const modal = document.querySelector('[data-payment-flow-modal]')
  if (!modal) return
  closePaymentConfirmModal()
  modal.hidden = true
  document.body.classList.remove('modal-open')
}

function setPaymentFlowMode(mode) {
  const normalized = mode === 'transfer' ? 'transfer' : 'quote'
  dashboardPaymentFlowMode = normalized
  document.querySelector('[data-payment-flow-modal]')
    ?.setAttribute('data-payment-active-kind', dashboardPaymentKind)
  const title = document.querySelector('[data-payment-flow-title]')
  const kicker = document.querySelector('[data-payment-flow-kicker]')
  const description = document.querySelector('[data-payment-flow-description]')
  const isOnramp = dashboardPaymentKind === 'onramp'
  if (kicker) {
    kicker.textContent = normalized === 'transfer'
      ? 'Off-ramp'
      : isOnramp
        ? 'On-ramp'
        : 'Quote'
  }
  if (title) {
    title.textContent = normalized === 'transfer'
      ? 'Offramp'
      : isOnramp
        ? 'Virtual account details'
        : 'Create quote'
  }
  if (description) {
    description.textContent = normalized === 'transfer'
      ? 'Send settled USDC from the assigned Universa Solana wallet to a supported destination bank.'
      : isOnramp
        ? 'Show bank routing and account details for inbound fiat funding into the assigned Universa wallet.'
        : 'Price the route and lock fee details before transfer creation.'
  }
  renderPaymentFlowGuide()
  renderPaymentFlowResult()
  renderPaymentSupportList()
  updatePaymentFlowActions()
}

function setDashboardPaymentKind(kind) {
  dashboardPaymentKind = kind === 'offramp' ? 'offramp' : 'onramp'
  dashboardPaymentFlowMode = dashboardPaymentKind === 'offramp' ? 'transfer' : 'quote'
  dashboardPaymentQuote = null
  dashboardPaymentTransfer = null
  closePaymentConfirmModal()
  document.querySelectorAll('[data-payment-kind]').forEach((button) => {
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.paymentKind === dashboardPaymentKind),
    )
  })
  setPaymentFlowMode(dashboardPaymentFlowMode)
  updatePaymentBankPanel()
  updatePaymentFlowRoute()
  renderPaymentVirtualAccount()
  renderPaymentFlowResult()
  updatePaymentFlowActions()
  updateQuote('from')
}

function renderPaymentCustomerOptions() {
  const select = document.querySelector('[data-payment-customer-select]')
  if (!select) return
  const previous = select.value
  const activeCustomers = dashboardResources.customers.filter((customer) =>
    customer.status === 'active'
      && ['active', 'approved'].includes(String(customer.provider_kyc_status ?? '').toLowerCase())
  )
  if (!activeCustomers.length) {
    select.innerHTML = '<option value="">No active KYC customers</option>'
    select.disabled = true
    renderPaymentVirtualAccount()
    updatePaymentFlowActions()
    return
  }
  select.disabled = false
  select.innerHTML = activeCustomers.map((customer) => {
    const label = customer.full_name || customer.email || customer.id
    return `<option value="${escapeAttribute(customer.id)}">${escapeHtml(label)}</option>`
  }).join('')
  if (activeCustomers.some((customer) => customer.id === previous)) {
    select.value = previous
  }
  renderRecentPaymentBankOptions()
  renderPaymentVirtualAccount()
  updatePaymentFlowActions()
}

function updatePaymentBankPanel() {
  const panel = document.querySelector('[data-payment-bank-panel]')
  if (!panel) return
  panel.hidden = dashboardPaymentKind !== 'offramp'
  if (dashboardPaymentKind === 'offramp') {
    renderRecentPaymentBankOptions()
  }
  renderPaymentSourceWallet()
  renderPaymentVirtualAccount()
}

function activePaymentSourceWallet() {
  const wallet = dashboardRewards?.reward_wallet ?? null
  if (
    wallet?.wallet_address
    && wallet.status === 'active'
    && wallet.wallet_provider === 'universa'
    && wallet.custody_model === 'server_wallet'
    && wallet.chain === 'solana'
  ) {
    return wallet
  }
  return null
}

function isBaseSettlementPlaceholder(account) {
  const rail = String(account?.destination_rail ?? '').toLowerCase()
  const address = String(account?.destination_address ?? '').toLowerCase()
  return rail === 'base' || address.startsWith('base_') || address.includes('pending')
}

function dashboardSettlementWalletForAccount(account) {
  const wallet = activePaymentSourceWallet()
  const address = String(account?.destination_address ?? '').trim()
  if (wallet?.wallet_address && (!address || isBaseSettlementPlaceholder(account))) {
    return wallet.wallet_address
  }
  return address
}

function dashboardSettlementLabelForAccount(account) {
  const wallet = activePaymentSourceWallet()
  const currency = String(account?.destination_currency ?? 'usdc').toUpperCase()
  const rail = wallet?.chain === 'solana' || isBaseSettlementPlaceholder(account)
    ? 'Solana'
    : account?.destination_rail
      ? formatRail(account.destination_rail)
      : 'Solana'
  return [currency, rail].filter(Boolean).join(' ')
}

function hasPaymentSourceWallet() {
  return Boolean(activePaymentSourceWallet())
}

function renderPaymentSourceWallet() {
  const wallet = activePaymentSourceWallet()
  const label = document.querySelector('[data-payment-source-wallet]')
  const address = document.querySelector('[data-payment-source-wallet-address]')
  if (label) {
    label.textContent = wallet ? 'Universa Solana wallet' : 'Assigned after Account KYC'
  }
  if (address) {
    address.textContent = wallet ? shortAddress(wallet.wallet_address, 5, 5) : 'No wallet assigned'
    address.title = wallet?.wallet_address ?? ''
  }
  updatePaymentFlowActions()
}

function activePaymentVirtualAccount() {
  const customerId = selectedPaymentCustomerId()
  const activeAccounts = dashboardResources.virtual_accounts.filter((account) =>
    isIssuedPaymentVirtualAccount(account)
  )
  if (!activeAccounts.length) return null
  const wallet = activePaymentSourceWallet()
  const walletAddress = String(wallet?.wallet_address ?? '').toLowerCase()
  const selectedCustomerAccounts = activeAccounts.filter((account) =>
    !customerId || account.customer_id === customerId
  )
  const byBestOnrampRoute = (account) =>
    String(account.source_currency ?? '').toLowerCase() === 'usd'
      && String(account.source_rail ?? '').toLowerCase().startsWith('ach')
  const byAssignedWallet = (account) =>
    walletAddress && String(account.destination_address ?? '').toLowerCase() === walletAddress
  const byProviderBacked = (account) =>
    Boolean(account.provider_virtual_account_id)
      && String(account.provider ?? '').toLowerCase() !== 'mock'
  const byBridge = (account) => String(account.provider ?? '').toLowerCase() === 'bridge'

  return selectedCustomerAccounts.find((account) => byBridge(account) && byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? selectedCustomerAccounts.find((account) => byBridge(account) && byBestOnrampRoute(account))
    ?? selectedCustomerAccounts.find((account) => byProviderBacked(account) && byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? selectedCustomerAccounts.find((account) => byProviderBacked(account) && byBestOnrampRoute(account))
    ?? selectedCustomerAccounts.find((account) => byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? selectedCustomerAccounts.find(byBestOnrampRoute)
    ?? activeAccounts.find((account) => byBridge(account) && byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? activeAccounts.find((account) => byBridge(account) && byBestOnrampRoute(account))
    ?? activeAccounts.find((account) => byProviderBacked(account) && byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? activeAccounts.find((account) => byProviderBacked(account) && byBestOnrampRoute(account))
    ?? activeAccounts.find((account) => byBestOnrampRoute(account) && byAssignedWallet(account))
    ?? activeAccounts.find(byBestOnrampRoute)
    ?? selectedCustomerAccounts[0]
    ?? activeAccounts[0]
}

function hasPaymentVirtualAccount() {
  return Boolean(activePaymentVirtualAccount())
}

function isIssuedPaymentVirtualAccount(account) {
  const status = String(account?.status ?? '').toLowerCase()
  const hasProviderId = Boolean(account?.provider_virtual_account_id)
  const deposit = plainObject(account?.deposit_instructions)
  const hasDepositInstructions = Object.keys(deposit).length > 0
  if (['closed', 'canceled', 'cancelled', 'failed', 'rejected', 'returned', 'suspended'].includes(status)) {
    return false
  }
  return ['active', 'activated', 'approved', 'issued', 'open', 'pending'].includes(status)
    || hasDepositInstructions
    || hasProviderId
}

function renderPaymentVirtualAccount() {
  const card = document.querySelector('[data-payment-virtual-account]')
  if (!card) return
  card.hidden = dashboardPaymentKind !== 'onramp'
  if (card.hidden) return

  const account = activePaymentVirtualAccount()
  const title = card.querySelector('[data-payment-virtual-account-title]')
  const id = card.querySelector('[data-payment-virtual-account-id]')
  const details = card.querySelector('[data-payment-virtual-account-details]')

  if (!account) {
    if (title) title.textContent = 'Issued after customer KYC'
    if (id) {
      id.textContent = 'VA pending sync'
      id.title = ''
    }
    if (details) {
      details.innerHTML = '<span>Issued virtual account details will appear here. On-ramp is inbound fiat deposits into provider-issued account details; there is no dashboard transfer to confirm.</span>'
    }
    return
  }

  const deposit = plainObject(account.deposit_instructions)
  const sourceCurrency = String(account.source_currency ?? deposit.currency ?? 'usd').toUpperCase()
  const rail = formatRail(account.source_rail ?? depositInstructionValue(deposit, [
    'payment_rail',
    'rail',
  ]) ?? firstArrayValue(deposit.payment_rails))
  const country = onrampVirtualAccountCountry(account, deposit, sourceCurrency, rail)
  const bankName = depositInstructionValue(deposit, ['bank_name', 'bankName', 'bank', 'institution_name'])
  const accountName = depositInstructionValue(deposit, [
    'account_holder_name',
    'account_name',
    'bank_account_holder_name',
    'bank_beneficiary_name',
    'beneficiary_name',
    'recipient_name',
    'beneficiary',
  ])
  const accountNumber = depositInstructionValue(deposit, [
    'account_number',
    'accountNumber',
    'bank_account_number',
    'bankAccountNumber',
    'beneficiary_account_number',
    'beneficiaryAccountNumber',
    'account_identifier',
    'accountIdentifier',
    'account_id',
    'account',
    'iban',
    'clabe',
  ])
  const routingNumber = depositInstructionValue(deposit, [
    'routing_number',
    'routingNumber',
    'bank_routing_number',
    'bankRoutingNumber',
    'ach_routing_number',
    'achRoutingNumber',
    'wire_routing_number',
    'wireRoutingNumber',
    'routing',
  ])
  const settlement = dashboardSettlementLabelForAccount(account)
  const accountId = account.provider_virtual_account_id ?? account.id ?? ''
  const wallet = activePaymentSourceWallet()
  const walletAddress = dashboardSettlementWalletForAccount(account) || wallet?.wallet_address || ''

  const depositLabel = [country, sourceCurrency, rail].filter(Boolean).join(' ')
  const accountIdHidden = Boolean(accountId) && isOnrampFieldHidden('virtual-account-id')
  if (title) title.textContent = `${depositLabel} deposit account`
  if (id) {
    id.textContent = accountIdHidden
      ? hiddenOnrampFieldValue(accountId)
      : accountId || 'Virtual account active'
    id.title = accountIdHidden ? '' : accountId
  }
  if (details) {
    const rows = [
      { key: 'bank', label: 'Bank', value: bankName || 'Bank details ready' },
      { key: 'account-holder', label: 'Account holder', value: accountName },
      { key: 'routing', label: 'Routing', value: routingNumber, copyLabel: 'Copy routing' },
      { key: 'account', label: 'Account', value: accountNumber, copyLabel: 'Copy account' },
      { key: 'settlement', label: 'Settles to', value: settlement },
      { key: 'wallet', label: 'Wallet', value: walletAddress ? shortAddress(walletAddress, 5, 5) : 'Assigned wallet' },
    ].filter((row) => Boolean(row.value))
    details.innerHTML = `
      ${onrampVisibilityControlsHtml()}
      <div class="payment-onramp-explainer">
        Use these ${escapeHtml(depositLabel)} details to receive incoming bank deposits. After KYC, Universa assigns the Solana wallet shown here, tracks the deposit, and settles the funded balance to that wallet. No quote, manual exchange, or transfer confirmation is needed for on-ramp funding.
      </div>
      ${rows.map(onrampDetailRowHtml).join('')}`
  }
}

function renderPaymentFlowGuide() {
  const guide = document.querySelector('[data-payment-flow-guide]')
  if (!guide) return
  const isOnramp = dashboardPaymentKind === 'onramp'
  const title = isOnramp ? 'How on-ramp works' : 'How off-ramp works'
  const points = isOnramp
    ? [
        'When Account KYC is approved, Universa generates and assigns a Solana wallet for the customer.',
        'The virtual account gives the customer country-specific bank details for inbound fiat deposits.',
        'Deposits are tracked by Universa and settle to the assigned Solana wallet; there is no exchange screen or outbound transfer to confirm.',
      ]
    : [
        'Off-ramp starts from the Universa-provided Solana wallet assigned after KYC.',
        'Choose a recent bank or enter destination bank details, then quote and review before sending.',
        'Universa handles the route from wallet balance to the supported bank rail, so the user can send out from the dashboard without using a separate exchange.',
      ]
  guide.innerHTML = `
    <span>${escapeHtml(title)}</span>
    <ul>
      ${points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}
    </ul>`
}

function loadOnrampVisibilityState() {
  try {
    const raw = window.localStorage?.getItem(ONRAMP_VISIBILITY_STORAGE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return {
      allHidden: Boolean(parsed?.allHidden),
      hiddenFields: plainObject(parsed?.hiddenFields),
      visibleFields: plainObject(parsed?.visibleFields),
    }
  } catch {
    return {
      allHidden: false,
      hiddenFields: {},
      visibleFields: {},
    }
  }
}

function saveOnrampVisibilityState() {
  try {
    window.localStorage?.setItem(
      ONRAMP_VISIBILITY_STORAGE_KEY,
      JSON.stringify(dashboardOnrampVisibility),
    )
  } catch {
    // Visibility controls still work for the current page view if storage is blocked.
  }
}

function isOnrampFieldHidden(field) {
  if (dashboardOnrampVisibility.allHidden) {
    return dashboardOnrampVisibility.visibleFields[field] !== true
  }
  return dashboardOnrampVisibility.hiddenFields[field] === true
}

function setOnrampAllFieldsHidden(hidden) {
  dashboardOnrampVisibility = {
    allHidden: hidden,
    hiddenFields: {},
    visibleFields: {},
  }
  saveOnrampVisibilityState()
  renderPaymentVirtualAccount()
}

function setOnrampFieldHidden(field, hidden) {
  if (!field) return
  const next = {
    allHidden: dashboardOnrampVisibility.allHidden,
    hiddenFields: { ...dashboardOnrampVisibility.hiddenFields },
    visibleFields: { ...dashboardOnrampVisibility.visibleFields },
  }
  if (next.allHidden) {
    if (hidden) {
      delete next.visibleFields[field]
    } else {
      next.visibleFields[field] = true
    }
  } else if (hidden) {
    next.hiddenFields[field] = true
  } else {
    delete next.hiddenFields[field]
  }
  dashboardOnrampVisibility = next
  saveOnrampVisibilityState()
  renderPaymentVirtualAccount()
}

function handlePaymentVisibilityAction(button) {
  const action = button.dataset.paymentVisibilityAction
  if (action === 'hide-all') {
    setOnrampAllFieldsHidden(true)
    return
  }
  if (action === 'show-all') {
    setOnrampAllFieldsHidden(false)
    return
  }
  if (action === 'field') {
    const field = button.dataset.paymentVisibilityField
    setOnrampFieldHidden(field, !isOnrampFieldHidden(field))
  }
}

function onrampVisibilityControlsHtml() {
  return `
    <div class="payment-virtual-account-visibility" aria-label="On-ramp detail visibility">
      <button type="button" data-payment-visibility-action="hide-all">Hide all</button>
      <button type="button" data-payment-visibility-action="show-all">Show all</button>
    </div>`
}

function onrampDetailRowHtml(row) {
  const hidden = isOnrampFieldHidden(row.key)
  const value = String(row.value ?? '')
  const displayValue = hidden ? hiddenOnrampFieldValue(value) : value
  const title = hidden ? '' : value
  const copyButton = row.copyLabel
    ? hidden
      ? '<button type="button" disabled>Hidden</button>'
      : `<button type="button" data-copy-value="${escapeAttribute(value)}" data-copy-label="${escapeAttribute(`${row.label} copied`)}">${escapeHtml(row.copyLabel)}</button>`
    : ''
  return `
    <div class="payment-virtual-account-detail">
      <span>${escapeHtml(row.label)}</span>
      <code class="${hidden ? 'is-hidden-sensitive' : ''}" title="${escapeAttribute(title)}">${escapeHtml(displayValue)}</code>
      <div class="payment-virtual-account-detail-actions">
        ${copyButton}
        <button type="button" data-payment-visibility-action="field" data-payment-visibility-field="${escapeAttribute(row.key)}" aria-pressed="${String(!hidden)}">${hidden ? 'Show' : 'Hide'}</button>
      </div>
    </div>`
}

function hiddenOnrampFieldValue(value) {
  const compact = String(value ?? '').replace(/\s+/g, '')
  if (!compact) return 'Hidden'
  const tail = compact.slice(-4)
  return tail ? `Hidden **** ${tail}` : 'Hidden'
}

function renderRecentPaymentBankOptions() {
  const select = document.querySelector('[data-payment-bank-select]')
  if (!select) return
  const previous = select.value
  const banks = recentPaymentBanks()
  select.innerHTML = '<option value="">Manual bank details</option>'
    + banks.map((bank, index) => `<option value="${index}">${escapeHtml(bank.label)}</option>`).join('')
  if (previous && banks[Number(previous)]) {
    select.value = previous
  }
  select.disabled = banks.length === 0
}

function paymentSupportListHtml() {
  const rows = dashboardPaymentKind === 'onramp'
    ? onrampSupportRows()
    : offrampSupportRows()
  const title = dashboardPaymentKind === 'onramp'
    ? 'Supported on-ramp accounts'
    : 'Supported off-ramp payouts'
  return `
    <span>${escapeHtml(title)}</span>
    <div class="payment-support-chips">
      ${rows.map((row) => `<b>${escapeHtml(row)}</b>`).join('')}
    </div>`
}

function onrampSupportRows() {
  const rows = dashboardResources.virtual_accounts
    .filter(isIssuedPaymentVirtualAccount)
    .map((account) => {
      const deposit = plainObject(account.deposit_instructions)
      const currency = String(account.source_currency ?? deposit.currency ?? '').toUpperCase()
      const rail = formatRail(account.source_rail ?? depositInstructionValue(deposit, [
        'payment_rail',
        'rail',
      ]) ?? firstArrayValue(deposit.payment_rails))
      const country = onrampVirtualAccountCountry(account, deposit, currency, rail)
      return [country, currency, rail].filter(Boolean).join(' ')
    })
    .filter(Boolean)
  const uniqueRows = [...new Set(rows)]
  return uniqueRows.length ? uniqueRows : ['United States USD ACH']
}

function offrampSupportRows() {
  return Object.values(quoteRoutes).map((route) =>
    `${route.countryName ?? countryLabel(route.country)} ${route.currency} ${route.rail ?? formatRail(payoutRailForRoute(route.currency))}`,
  )
}

function onrampVirtualAccountCountry(account, deposit = plainObject(account?.deposit_instructions), currency = '', rail = '') {
  const rawCountry = depositInstructionValue(deposit, [
    'country',
    'country_code',
    'countryCode',
    'bank_country',
    'bankCountry',
    'bank_country_code',
    'bankCountryCode',
    'beneficiary_country',
    'beneficiaryCountry',
  ])
  const explicitCountry = countryLabel(rawCountry)
  if (explicitCountry) return explicitCountry
  const sourceCurrency = String(currency || account?.source_currency || deposit.currency || '').toUpperCase()
  const sourceRail = String(rail || account?.source_rail || '').toLowerCase()
  if (sourceCurrency === 'USD' && sourceRail.includes('ach')) return 'United States'
  return ''
}

function renderPaymentSupportList() {
  const target = document.querySelector('[data-payment-support-list]')
  if (!target) return
  target.innerHTML = paymentSupportListHtml()
}

function recentPaymentBanks() {
  const customerId = selectedPaymentCustomerId()
  const seen = new Set()
  return dashboardResources.transfers
    .filter((transfer) => !customerId || transfer.customer_id === customerId)
    .map((transfer) => bankFromTransferDestination(transfer.destination))
    .filter(Boolean)
    .filter((bank) => {
      const key = bank.external_account_id
        || `${bank.routing_number || ''}:${bank.account_number || ''}:${bank.bank_name || ''}`.toLowerCase()
      if (!key.trim() || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)
}

function bankFromTransferDestination(destination) {
  const object = plainObject(destination)
  const rail = String(object.payment_rail ?? object.rail ?? '').toLowerCase()
  const externalAccountId = typeof object.external_account_id === 'string' ? object.external_account_id.trim() : ''
  const bankName = bankFieldValue(object, ['bank_name', 'bankName', 'bank', 'institution_name'])
  const accountName = bankFieldValue(object, ['account_holder_name', 'account_name', 'beneficiary_name', 'recipient_name'])
  const routingNumber = bankFieldValue(object, ['routing_number', 'routingNumber', 'ach_routing_number', 'wire_routing_number', 'bank_routing_number', 'clabe', 'sort_code'])
  const accountNumber = bankFieldValue(object, ['account_number', 'accountNumber', 'account', 'iban', 'clabe'])
  if (!externalAccountId && !bankName && !accountName && !routingNumber && !accountNumber) return null
  const ending = accountNumber ? ` ending ${String(accountNumber).slice(-4)}` : ''
  return {
    label: [bankName || (rail ? formatRail(rail) : 'Bank account'), accountName, ending].filter(Boolean).join(' · '),
    external_account_id: externalAccountId,
    bank_name: bankName,
    account_holder_name: accountName,
    routing_number: routingNumber,
    account_number: accountNumber,
  }
}

function bankFieldValue(object, keys) {
  for (const key of keys) {
    const value = object[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
    if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  }
  return ''
}

function applySelectedPaymentBank() {
  const select = document.querySelector('[data-payment-bank-select]')
  const bank = recentPaymentBanks()[Number(select?.value)]
  if (!bank) return
  setPaymentBankInput('[data-payment-bank-account-name]', bank.account_holder_name)
  setPaymentBankInput('[data-payment-bank-name]', bank.bank_name)
  setPaymentBankInput('[data-payment-bank-routing]', bank.routing_number)
  setPaymentBankInput('[data-payment-bank-account]', bank.account_number)
  dashboardPaymentQuote = null
  dashboardPaymentTransfer = null
  updatePaymentFlowActions()
}

function setPaymentBankInput(selector, value) {
  const input = document.querySelector(selector)
  if (input) input.value = value ?? ''
}

function updatePaymentFlowRoute() {
  const route = dashboardPaymentRoute()
  const routeLabel = document.querySelector('[data-payment-flow-route]')
  if (routeLabel) {
    const isOnramp = dashboardPaymentKind === 'onramp'
    routeLabel.hidden = isOnramp
    routeLabel.textContent = isOnramp
      ? ''
      : `${formatRouteObject(route.source)} wallet to ${formatRouteObject(route.destination)} bank`
  }
  renderPaymentVirtualAccount()
  renderPaymentSupportList()
}

function updatePaymentFlowActions() {
  const hasCustomer = Boolean(selectedPaymentCustomerId())
  const hasSourceWallet = hasPaymentSourceWallet()
  const hasVirtualAccount = dashboardPaymentKind !== 'onramp' || hasPaymentVirtualAccount()
  const hasBank = dashboardPaymentKind !== 'offramp' || hasPaymentBankDestination()
  const isOnramp = dashboardPaymentKind === 'onramp'
  const transferRequiresOfframp = dashboardPaymentFlowMode === 'transfer' && isOnramp
  const quotePanel = document.querySelector('[data-payment-quote-panel]')
  const actionRow = document.querySelector('[data-payment-flow-actions]')
  const quoteButton = document.querySelector('[data-payment-create-quote]')
  const transferButton = document.querySelector('[data-payment-review-transfer]')
  if (quotePanel) quotePanel.hidden = isOnramp
  if (actionRow) actionRow.hidden = isOnramp
  if (quoteButton) {
    quoteButton.disabled = isOnramp
      || transferRequiresOfframp
      || !hasCustomer
      || !hasSourceWallet
      || !hasVirtualAccount
      || dashboardPaymentInFlight
    quoteButton.textContent = dashboardPaymentInFlight
      ? 'Working...'
      : transferRequiresOfframp
        ? 'VA details shown'
        : 'Create quote'
  }
  if (transferButton) {
    transferButton.disabled = isOnramp
      || !hasCustomer
      || !hasSourceWallet
      || !hasVirtualAccount
      || !hasBank
      || dashboardPaymentInFlight
    transferButton.textContent = dashboardPaymentInFlight
      ? 'Working...'
      : isOnramp
        ? 'No transfer to send'
        : dashboardPaymentQuote
          ? 'Review offramp'
          : 'Quote + review'
  }
}

async function createDashboardPaymentQuote(options = {}) {
  if (dashboardPaymentInFlight && !options.skipBusy) return null
  if (dashboardPaymentKind === 'onramp') {
    renderPaymentFlowResult()
    return null
  }
  if (!selectedPaymentCustomerId()) {
    renderPaymentFlowResult({
      error: 'An active KYC customer is required before creating a quote.',
    })
    return null
  }
  if (!hasPaymentSourceWallet()) {
    renderPaymentFlowResult({
      error: 'The assigned Universa Solana wallet is required before creating a quote.',
    })
    return null
  }
  if (!options.skipBusy) setPaymentFlowBusy(true)

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    if (!options.skipBusy) setPaymentFlowBusy(false)
    showToast('Sign in again before creating a quote.')
    return null
  }

  try {
    const payload = await requestDashboardApi('/payments/quotes', {
      method: 'POST',
      accessToken: session.access_token,
      body: dashboardQuoteRequestBody(),
    })
    dashboardPaymentQuote = payload.quote
    dashboardPaymentTransfer = null
    syncDashboardQuoteInputs(payload.quote)
    renderPaymentFlowResult(payload)
    updatePaymentFlowActions()
    if (!options.silent) showToast('Quote created.')
    return payload.quote
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Quote creation failed.'
    renderPaymentFlowResult({ error: message })
    showToast(message)
    return null
  } finally {
    if (!options.skipBusy) setPaymentFlowBusy(false)
  }
}

async function reviewDashboardPaymentTransfer() {
  if (dashboardPaymentInFlight) return
  if (dashboardPaymentKind !== 'offramp') {
    closePaymentConfirmModal()
    renderPaymentFlowResult({
      error: 'On-ramp is virtual account deposit instructions only. Use Offramp for wallet-to-bank transfers.',
    })
    return
  }
  if (dashboardPaymentQuote && dashboardPaymentQuote.kind !== 'offramp') {
    dashboardPaymentQuote = null
    closePaymentConfirmModal()
    renderPaymentFlowResult()
    return
  }
  if (!validatePaymentTransferInputs()) return

  setPaymentFlowBusy(true)
  try {
    if (!dashboardPaymentQuote) {
      const quote = await createDashboardPaymentQuote({ skipBusy: true, silent: true })
      if (!quote) return
    }
    openPaymentConfirmModal()
  } finally {
    setPaymentFlowBusy(false)
  }
}

function validatePaymentTransferInputs() {
  if (!selectedPaymentCustomerId()) {
    renderPaymentFlowResult({
      error: 'An active KYC customer is required before creating a transfer.',
    })
    return false
  }
  if (!hasPaymentSourceWallet()) {
    renderPaymentFlowResult({
      error: 'The assigned Universa Solana wallet is required before creating a transfer.',
    })
    return false
  }
  if (dashboardPaymentKind !== 'offramp') {
    closePaymentConfirmModal()
    renderPaymentFlowResult({
      error: 'On-ramp is virtual account deposit instructions only. Use Offramp to create a bank transfer.',
    })
    return false
  }
  if (dashboardPaymentKind === 'offramp' && !hasPaymentBankDestination()) {
    renderPaymentFlowResult({
      error: 'A destination bank is required before creating an offramp transfer.',
    })
    return false
  }
  return true
}

function openPaymentConfirmModal() {
  const modal = document.querySelector('[data-payment-confirm-modal]')
  if (!modal) return
  if (dashboardPaymentKind !== 'offramp' || dashboardPaymentQuote?.kind !== 'offramp') {
    closePaymentConfirmModal()
    renderPaymentFlowResult()
    return
  }
  renderPaymentConfirmSummary()
  modal.hidden = false
  document.body.classList.add('modal-open')
  updatePaymentConfirmActions()
  modal.querySelector('[data-payment-confirm-send]')?.focus()
}

function closePaymentConfirmModal() {
  const modal = document.querySelector('[data-payment-confirm-modal]')
  if (!modal || modal.hidden) return
  modal.hidden = true
  const paymentModalOpen = document.querySelector('[data-payment-flow-modal]')?.hidden === false
  if (!paymentModalOpen) document.body.classList.remove('modal-open')
}

function renderPaymentConfirmSummary() {
  const summary = document.querySelector('[data-payment-confirm-summary]')
  if (!summary) return
  const route = dashboardTransferRoute()
  const wallet = activePaymentSourceWallet()
  const destination = selectedPaymentBankDestination()
  const quote = dashboardPaymentQuote
  const amount = quote?.source?.amount ?? document.querySelector('#quote-amount')?.value ?? '0'
  const sourceCurrency = quote?.source?.currency ?? route.source.currency ?? 'usd'
  const walletLabel = wallet ? shortAddress(wallet.wallet_address, 5, 5) : 'Missing wallet'
  const sourceLabel = walletLabel
  const destinationLabel = paymentBankSummary(destination)
  const destinationAmount = quote?.destination?.amount
  const destinationCurrency = quote?.destination?.currency ?? route.destination.currency
  summary.innerHTML = `
    <div>
      <span>You send</span>
      <strong>${escapeHtml(formatMoneyAmount(amount, sourceCurrency))}</strong>
    </div>
    <div>
      <span>Recipient gets</span>
      <strong>${escapeHtml(formatMoneyAmount(destinationAmount, destinationCurrency))}</strong>
    </div>
    <div>
      <span>Route</span>
      <strong>${escapeHtml(formatRouteObject(route.source))} to ${escapeHtml(formatRouteObject(route.destination))}</strong>
    </div>
    <div>
      <span>Source wallet</span>
      <strong>${escapeHtml(sourceLabel)}</strong>
    </div>
    <div>
      <span>Destination bank</span>
      <strong>${escapeHtml(destinationLabel)}</strong>
    </div>
    <div>
      <span>Execution</span>
      <strong>Pending provider submission</strong>
    </div>`
}

function paymentVirtualAccountSummary(account) {
  if (!account) return 'Missing virtual account'
  const deposit = plainObject(account.deposit_instructions)
  const bankName = depositInstructionValue(deposit, ['bank_name', 'bankName', 'bank', 'institution_name'])
  const accountNumber = depositInstructionValue(deposit, [
    'account_number',
    'accountNumber',
    'bank_account_number',
    'bankAccountNumber',
    'beneficiary_account_number',
    'beneficiaryAccountNumber',
    'account_identifier',
    'accountIdentifier',
    'account_id',
    'account',
    'iban',
    'clabe',
  ])
  const routingNumber = depositInstructionValue(deposit, [
    'routing_number',
    'routingNumber',
    'bank_routing_number',
    'bankRoutingNumber',
    'ach_routing_number',
    'achRoutingNumber',
    'wire_routing_number',
    'wireRoutingNumber',
    'routing',
  ])
  return [
    bankName || 'Virtual account',
    accountNumber ? `acct ${maskedBankIdentifier(accountNumber)}` : '',
    routingNumber ? `routing ${maskedBankIdentifier(routingNumber)}` : '',
  ].filter(Boolean).join(' · ')
}

function paymentBankSummary(destination) {
  if (destination.external_account_id) {
    return `External account ${shortAddress(destination.external_account_id, 8, 4)}`
  }
  const ending = maskedBankIdentifier(destination.account_number || destination.routing_number)
  return [
    destination.bank_name || 'Bank account',
    destination.account_holder_name,
    ending,
  ].filter(Boolean).join(' · ')
}

function maskedBankIdentifier(value) {
  const text = String(value ?? '').replace(/\s+/g, '')
  if (!text) return ''
  return `ending ${text.slice(-4)}`
}

async function confirmDashboardPaymentTransfer() {
  if (dashboardPaymentInFlight) return
  if (dashboardPaymentKind !== 'offramp' || dashboardPaymentQuote?.kind !== 'offramp') {
    closePaymentConfirmModal()
    renderPaymentFlowResult()
    return
  }
  await createDashboardPaymentTransfer({ confirmed: true })
}

async function createDashboardPaymentTransfer(options = {}) {
  if (dashboardPaymentInFlight) return
  if (dashboardPaymentKind !== 'offramp' || dashboardPaymentQuote?.kind !== 'offramp') {
    closePaymentConfirmModal()
    renderPaymentFlowResult()
    return
  }
  if (!validatePaymentTransferInputs()) return

  setPaymentFlowBusy(true)
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    setPaymentFlowBusy(false)
    showToast('Sign in again before creating a transfer.')
    return
  }

  try {
    if (!dashboardPaymentQuote) {
      const quote = await createDashboardPaymentQuote({ skipBusy: true, silent: true })
      if (!quote) return
    }
    const payload = await requestDashboardApi('/payments/transfers', {
      method: 'POST',
      accessToken: session.access_token,
      body: dashboardTransferRequestBody({ confirmed: options.confirmed === true }),
    })
    dashboardPaymentTransfer = payload.transfer
    dashboardPaymentQuote = null
    renderPaymentFlowResult(payload)
    if (payload.status) updateDashboardAccessState(payload.status)
    closePaymentConfirmModal()
    showToast('Transfer prepared.')
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Transfer creation failed.'
    renderPaymentFlowResult({ error: message })
    showToast(message)
  } finally {
    setPaymentFlowBusy(false)
  }
}

function setPaymentFlowBusy(isBusy) {
  dashboardPaymentInFlight = Boolean(isBusy)
  updatePaymentFlowActions()
  updatePaymentConfirmActions()
}

function updatePaymentConfirmActions() {
  const sendButton = document.querySelector('[data-payment-confirm-send]')
  if (!sendButton) return
  sendButton.disabled = dashboardPaymentInFlight
  sendButton.textContent = dashboardPaymentInFlight ? 'Confirming...' : 'Send offramp'
}

function renderPaymentFlowResult(payload = null) {
  const result = document.querySelector('[data-payment-flow-result]')
  if (!result) return
  if (payload?.error) {
    result.innerHTML = `<strong>Payment action failed</strong><span>${escapeHtml(payload.error)}</span>`
    return
  }
  const transfer = payload?.transfer ?? dashboardPaymentTransfer
  const quote = payload?.quote ?? dashboardPaymentQuote
  if (transfer) {
    const executionStatus = transfer.execution_status
      ? formatStatusLabel(transfer.execution_status)
      : formatStatusLabel(transfer.status)
    result.innerHTML = `<strong>Transfer prepared</strong>
      <span>${escapeHtml(formatMoneyAmount(transfer.gross_amount, transfer.fees?.currency ?? 'usd'))} ${escapeHtml(executionStatus)}</span>
      <code>${escapeHtml(transfer.id)}</code>
      <button type="button" data-copy-value="${escapeAttribute(transfer.id)}" data-copy-label="Transfer ID copied">Copy transfer ID</button>`
    return
  }
  if (quote) {
    result.innerHTML = `<strong>Quote created</strong>
      <span>${escapeHtml(formatMoneyAmount(quote.source?.amount, quote.source?.currency ?? 'usd'))} to ${escapeHtml(formatMoneyAmount(quote.destination?.amount, quote.destination?.currency ?? 'usd'))} expires ${escapeHtml(formatDashboardDate(quote.expires_at))}</span>
      <code>${escapeHtml(quote.id)}</code>
      <button type="button" data-copy-value="${escapeAttribute(quote.id)}" data-copy-label="Quote ID copied">Copy quote ID</button>`
    return
  }
  if (dashboardPaymentKind === 'onramp') {
    result.innerHTML = hasPaymentVirtualAccount()
      ? '<strong>On-ramp deposit account</strong><span>Use the issued virtual account details above for inbound fiat deposits. No quote or transfer confirmation is created on on-ramp.</span>'
      : '<strong>Issued VA pending sync</strong><span>Provider-issued bank/routing/account details appear above as soon as this tenant has a mapped virtual account.</span>'
    return
  }
  result.innerHTML = '<strong>No quote yet</strong><span>Select a customer and create a quote.</span>'
}

function dashboardQuoteRequestBody() {
  const amountInput = document.querySelector('#quote-amount')
  const amount = String(amountInput?.value || '0')
  const route = dashboardPaymentRoute()
  return {
    customer_id: selectedPaymentCustomerId(),
    kind: dashboardPaymentKind,
    amount,
    tenant_fee_bps: Number(document.querySelector('#tenant-fee-bps')?.value ?? 0),
    source: route.source,
    destination: route.destination,
  }
}

function syncDashboardQuoteInputs(quote) {
  const source = plainObject(quote?.source)
  const destination = plainObject(quote?.destination)
  const amountInput = document.querySelector('#quote-amount')
  const receiveInput = document.querySelector('#quote-to-amount')
  const sourceCurrency = document.querySelector('[data-quote-source-currency]')
  const sourcePrefix = document.querySelector('[data-quote-source-prefix]')
  const inlineCurrency = document.querySelector('#quote-inline-currency')
  const topCurrency = document.querySelector('#quote-top-currency')
  const inlineFlag = document.querySelector('#quote-inline-flag')
  const topFlag = document.querySelector('#quote-top-flag')
  const totalFees = document.querySelector('#quote-total-fees')

  if (amountInput && source.amount != null) {
    amountInput.value = formatQuoteInputAmount(source.amount, source.currency)
  }
  if (receiveInput && destination.amount != null) {
    receiveInput.value = formatQuoteInputAmount(destination.amount, destination.currency)
  }
  const sourceCurrencyCode = String(source.currency ?? '').toUpperCase()
  const destinationCurrencyCode = String(destination.currency ?? '').toUpperCase()
  if (sourceCurrency && sourceCurrencyCode) sourceCurrency.textContent = sourceCurrencyCode
  if (sourcePrefix && sourceCurrencyCode) sourcePrefix.textContent = sourceCurrencyCode === 'USD' ? '$' : sourceCurrencyCode
  if (inlineCurrency && destinationCurrencyCode) inlineCurrency.textContent = destinationCurrencyCode
  if (topCurrency && destinationCurrencyCode) topCurrency.textContent = destinationCurrencyCode

  const route = Object.values(quoteRoutes).find((candidate) =>
    candidate.currency.toUpperCase() === destinationCurrencyCode
  )
  if (route) {
    const flagUrl = `https://flagcdn.com/w160/${route.country}.png`
    inlineFlag?.setAttribute('src', flagUrl)
    topFlag?.setAttribute('src', flagUrl)
  }
  const feeTotal = Number(quote?.fees?.provider ?? 0)
    + Number(quote?.fees?.universa ?? 0)
    + Number(quote?.fees?.tenant ?? 0)
    + Number(quote?.fees?.network ?? 0)
  if (totalFees && Number.isFinite(feeTotal)) {
    totalFees.textContent = formatMoneyAmount(feeTotal, quote?.fees?.currency ?? source.currency ?? 'usd')
  }
}

function formatQuoteInputAmount(value, currency) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return ''
  return formatRawAmount(number, currencyFractionDigits(currency))
}

function dashboardTransferRequestBody(options = {}) {
  const route = dashboardTransferRoute()
  return {
    quote_id: dashboardPaymentQuote?.id,
    confirmed: options.confirmed === true,
    external_id: `dashboard_${Date.now()}`,
    source: route.source,
    destination: route.destination,
  }
}

function dashboardTransferRoute() {
  const route = dashboardPaymentRoute()
  if (dashboardPaymentKind !== 'offramp') return route
  return {
    ...route,
    destination: {
      ...route.destination,
      ...selectedPaymentBankDestination(),
    },
  }
}

function dashboardPaymentRoute() {
  const route = quoteRoutes[activeQuoteRoute] ?? quoteRoutes.mxn
  const wallet = activePaymentSourceWallet()
  const virtualAccount = activePaymentVirtualAccount()
  if (dashboardPaymentKind === 'offramp') {
    return {
      source: {
        currency: 'usdc',
        payment_rail: 'solana',
        from_address: wallet?.wallet_address ?? '',
      },
      destination: {
        currency: route.currency.toLowerCase(),
        payment_rail: payoutRailForRoute(activeQuoteRoute),
        country: route.country,
      },
    }
  }
  const deposit = plainObject(virtualAccount?.deposit_instructions)
  return {
    source: {
      currency: String(virtualAccount?.source_currency ?? deposit.currency ?? 'usd').toLowerCase(),
      payment_rail: String(virtualAccount?.source_rail ?? depositInstructionValue(deposit, [
        'payment_rail',
        'rail',
      ]) ?? firstArrayValue(deposit.payment_rails) ?? 'ach').toLowerCase(),
      ...(virtualAccount?.id ? { virtual_account_id: virtualAccount.id } : {}),
      ...(virtualAccount?.provider_virtual_account_id
        ? { provider_virtual_account_id: virtualAccount.provider_virtual_account_id }
        : {}),
    },
    destination: {
      currency: String(virtualAccount?.destination_currency ?? 'usdc').toLowerCase(),
      payment_rail: 'solana',
      to_address: virtualAccount
        ? dashboardSettlementWalletForAccount(virtualAccount)
        : wallet?.wallet_address ?? '',
    },
  }
}

function payoutRailForRoute(routeKey) {
  const rails = {
    mxn: 'spei',
    brl: 'pix',
    cop: 'bank',
    gbp: 'faster_payments',
  }
  return rails[routeKey] ?? 'bank'
}

function selectedPaymentCustomerId() {
  const select = document.querySelector('[data-payment-customer-select]')
  return select?.value || ''
}

function selectedPaymentBankDestination() {
  const selectedBank = recentPaymentBanks()[Number(document.querySelector('[data-payment-bank-select]')?.value)]
  const accountHolderName = paymentBankInputValue('[data-payment-bank-account-name]')
  const bankName = paymentBankInputValue('[data-payment-bank-name]')
  const routingNumber = paymentBankInputValue('[data-payment-bank-routing]')
  const accountNumber = paymentBankInputValue('[data-payment-bank-account]')
  return {
    ...(selectedBank?.external_account_id ? { external_account_id: selectedBank.external_account_id } : {}),
    ...(accountHolderName ? { account_holder_name: accountHolderName } : {}),
    ...(bankName ? { bank_name: bankName } : {}),
    ...(routingNumber ? { routing_number: routingNumber } : {}),
    ...(accountNumber ? { account_number: accountNumber } : {}),
  }
}

function hasPaymentBankDestination() {
  const destination = selectedPaymentBankDestination()
  return Boolean(
    destination.external_account_id
      || (destination.routing_number && destination.account_number)
      || destination.account_number,
  )
}

function paymentBankInputValue(selector) {
  const input = document.querySelector(selector)
  return typeof input?.value === 'string' ? input.value.trim() : ''
}

function selectedVirtualAccountDestination() {
  const customerId = selectedPaymentCustomerId()
  const account = dashboardResources.virtual_accounts.find((virtualAccount) =>
    virtualAccount.customer_id === customerId && virtualAccount.status === 'active'
  )
  return account ? dashboardSettlementWalletForAccount(account) : ''
}

async function initializeAuth() {
  const apiEndpoint = document.querySelector('#api-endpoint')
  const signOutButton = document.querySelector('#sign-out-button')
  if (apiEndpoint) apiEndpoint.textContent = API_ENDPOINT
  if (signOutButton) signOutButton.addEventListener('click', signOut)
  initializeDashboardThemeToggle()
  initializeDashboardNavigation()
  initializeFeeControl()
  initializeOneTimeSecretModal()
  initializePaymentFlowModal()
  initializeHoldingsModal()

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

    const paymentFlowButton = target.closest('[data-payment-flow-open]')
    if (paymentFlowButton) {
      openPaymentFlowModal(paymentFlowButton.dataset.paymentFlowOpen ?? 'quote')
      return
    }

    const paymentFlowClose = target.closest('[data-payment-flow-close]')
    if (paymentFlowClose) {
      closePaymentFlowModal()
      return
    }

    const holdingsButton = target.closest('[data-holdings-open]')
    if (holdingsButton) {
      await openHoldingsModal(holdingsButton.dataset.holdingsOpen)
      return
    }

    const copyButton = target.closest('[data-copy-value]')
    if (copyButton) {
      await copyText(copyButton.dataset.copyValue ?? '', copyButton.dataset.copyLabel ?? 'Copied')
      return
    }

    const customerOpenButton = target.closest('[data-customer-open]')
    if (customerOpenButton) {
      dashboardSelectedCustomerId = customerOpenButton.dataset.customerOpen ?? ''
      renderCustomerPanel()
      return
    }

    const panelButton = target.closest('[data-panel-target]')
    if (panelButton) {
      activateDashboardPanel(panelButton.dataset.panelTarget)
      return
    }

    const revokeButton = target.closest('[data-api-key-revoke]')
    if (revokeButton) {
      await revokeDashboardApiKey(revokeButton.dataset.apiKeyRevoke)
      return
    }

    const rewardClaimButton = target.closest('[data-reward-claim]')
    if (rewardClaimButton instanceof HTMLButtonElement) {
      await submitRewardClaim(rewardClaimButton)
      return
    }

    const webhookTestButton = target.closest('[data-webhook-test-endpoint]')
    if (webhookTestButton instanceof HTMLButtonElement) {
      await sendWebhookTestEvent(webhookTestButton.dataset.webhookTestEndpoint)
      return
    }

    const webhookRotateButton = target.closest('[data-webhook-rotate]')
    if (webhookRotateButton instanceof HTMLButtonElement) {
      await rotateWebhookSecret(webhookRotateButton.dataset.webhookRotate)
      return
    }

    const webhookDisableButton = target.closest('[data-webhook-disable]')
    if (webhookDisableButton instanceof HTMLButtonElement) {
      await disableWebhookEndpoint(webhookDisableButton.dataset.webhookDisable)
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

  document.querySelector('[data-reward-wallet-assign]')?.addEventListener('click', assignRewardWallet)
  document.querySelector('[data-reward-wallet-export]')?.addEventListener('click', exportRewardWalletKey)
  document.querySelector('[data-webhook-form]')?.addEventListener('submit', createWebhookEndpoint)
  document.querySelector('[data-rewards-refresh]')?.addEventListener('click', async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    await loadRewardsState(session, true)
  })
  document.querySelector('[data-webhook-refresh]')?.addEventListener('click', async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession()
    await loadWebhooksState(session, true)
  })
  document.querySelector('[data-webhook-test]')?.addEventListener('click', () => sendWebhookTestEvent())

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
  const routePath = dashboardRoutePath()
  const activate = (panelId, updateHash = true) => {
    const nextPanelId = panelIds.includes(panelId) ? panelId : 'home'
    panels.forEach((panel) => {
      const isActive = panel.dataset.dashboardPanel === nextPanelId
      panel.hidden = !isActive
      panel.classList.toggle('is-active', isActive)
      panel.classList.remove('is-unv-runway-animating')
    })
    const activePanel = panels.find((panel) => panel.dataset.dashboardPanel === nextPanelId)
    restartDashboardPanelAnimations(activePanel)
    navLinks.forEach((link) => {
      link.classList.toggle('is-active', link.dataset.dashboardNav === nextPanelId)
    })
    if (updateHash) {
      history.replaceState(null, '', `${routePath}#${nextPanelId}`)
    }
    shell?.classList.remove('is-sidebar-open')
  }
  activateDashboardPanel = activate
  const activateFromHash = () => {
    activate(window.location.hash.replace('#', '') || 'home', false)
  }

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

  window.addEventListener('hashchange', activateFromHash)
  activateFromHash()
  window.requestAnimationFrame(activateFromHash)
}

function initializeDashboardThemeToggle() {
  if (!isDashboardPage()) return
  const toggles = [...document.querySelectorAll('[data-dashboard-theme-toggle]')]
  if (!toggles.length) return

  applyDashboardTheme(readDashboardThemePreference())

  toggles.forEach((toggle) => {
    toggle.addEventListener('click', () => {
      const nextTheme = document.documentElement.dataset.dashboardTheme === 'dark'
        ? 'light'
        : 'dark'
      storeDashboardThemePreference(nextTheme)
      applyDashboardTheme(nextTheme)
    })
  })
}

function readDashboardThemePreference() {
  try {
    return localStorage.getItem(DASHBOARD_THEME_STORAGE_KEY) === 'dark' ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

function storeDashboardThemePreference(theme) {
  try {
    localStorage.setItem(DASHBOARD_THEME_STORAGE_KEY, theme)
  } catch {
    // Theme switching should still work for the current session if storage is blocked.
  }
}

function applyDashboardTheme(theme) {
  const resolvedTheme = theme === 'dark' ? 'dark' : 'light'
  const isDark = resolvedTheme === 'dark'
  document.documentElement.dataset.dashboardTheme = resolvedTheme
  document.querySelectorAll('[data-dashboard-theme-toggle]').forEach((toggle) => {
    toggle.setAttribute('aria-pressed', String(isDark))
    toggle.setAttribute('aria-label', isDark ? 'Switch to light mode' : 'Switch to dark mode')
    toggle.title = isDark ? 'Light mode' : 'Dark mode'
  })
}

function restartDashboardPanelAnimations(panel) {
  if (reducedMotion || !panel) return
  if (!panel.querySelector('.unv-emission-chart, .unv-runway-track, .runway-model-chart')) return
  if (dashboardAnimationFrame) window.cancelAnimationFrame(dashboardAnimationFrame)
  void panel.offsetWidth
  dashboardAnimationFrame = window.requestAnimationFrame(() => {
    panel.classList.add('is-unv-runway-animating')
  })
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
    account,
    account_kyc_status: account.account_kyc_status ?? account.status,
    provider_customer_id: account.provider_customer_id,
    kyc_status: account.kyc_status,
    country_code: account.country_code,
    display_currency: account.display_currency,
    api_keys: apiKeys,
    api_key_prefix: payload.api_key_prefix ?? firstKey?.key_prefix,
    metrics: payload.metrics ?? null,
    resources: payload.resources ?? {},
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
      account: payload.account,
      account_kyc_status: payload.account?.account_kyc_status,
      provider_customer_id: payload.account?.provider_customer_id,
      kyc_status: payload.account?.kyb_status,
      country_code: payload.account?.country_code,
      display_currency: payload.account?.display_currency,
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
    if (key.api_key && key.secret) {
      openOneTimeSecretModal({
        kicker: 'API key created',
        title: 'Save this API key now',
        description:
          'The full API key and signing secret are only available in this modal. Copy them into your backend secret manager before closing it.',
        keyLabel: 'API key',
        keyValue: key.api_key,
        secretLabel: 'Signing secret',
        secretValue: key.secret,
      })
      return
    }
    showToast('API key ready.')
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

async function loadRewardsState(session, announce = false) {
  if (!isDashboardPage() || !session?.access_token) return
  try {
    const payload = await requestDashboardApi('/rewards', {
      method: 'GET',
      accessToken: session.access_token,
    })
    dashboardRewards = payload
    renderRewards(payload)
    if (shouldAutoAssignRewardWallet(payload)) {
      await autoAssignRewardWallet(session.access_token)
    }
    await loadHoldingsState(session)
    if (announce) showToast('Rewards refreshed.')
  } catch (error) {
    renderRewardsError(error instanceof Error ? error.message : 'Rewards could not be loaded.')
  }
}

async function loadHoldingsState(session, announce = false) {
  if (!isDashboardPage() || !session?.access_token) return null
  if (dashboardHoldingsInFlight) return dashboardHoldings
  dashboardHoldingsInFlight = true
  renderHoldingsDock()
  renderHoldingsModal()

  try {
    const payload = await requestDashboardApi('/holdings', {
      method: 'GET',
      accessToken: session.access_token,
    })
    dashboardHoldings = payload.holdings ?? payload
    renderHoldingsDock()
    renderHoldingsModal()
    if (announce) showToast('Holdings refreshed.')
    return dashboardHoldings
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Holdings could not be loaded.'
    dashboardHoldings = {
      ...(dashboardHoldings ?? {}),
      status: 'stale',
      errors: { solana: message },
    }
    renderHoldingsDock()
    renderHoldingsModal()
    if (announce) showToast(message)
    return null
  } finally {
    dashboardHoldingsInFlight = false
    renderHoldingsDock()
    renderHoldingsModal()
  }
}

function shouldAutoAssignRewardWallet(payload) {
  const accountKycActive = payload?.account?.account_kyc_status === 'active'
    || payload?.account?.kyb_status === 'approved'
  return accountKycActive && !payload?.reward_wallet?.wallet_address
}

async function autoAssignRewardWallet(accessToken) {
  if (rewardWalletAssignmentInFlight) return
  rewardWalletAssignmentInFlight = true
  dashboardRewards = { ...(dashboardRewards ?? {}), wallet_assignment_pending: true }
  renderRewards(dashboardRewards)
  try {
    const payload = await requestDashboardApi('/rewards/wallet', {
      method: 'POST',
      accessToken,
      body: {},
    })
    dashboardRewards = payload.rewards ?? payload
    renderRewards(dashboardRewards)
    await loadHoldingsState({ access_token: accessToken })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Reward wallet could not be assigned.'
    dashboardRewards = {
      ...(dashboardRewards ?? {}),
      wallet_assignment_pending: false,
      wallet_assignment_error: message,
    }
    renderRewards(dashboardRewards)
  } finally {
    rewardWalletAssignmentInFlight = false
  }
}

async function assignRewardWallet(event) {
  const button = event?.currentTarget
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before assigning a reward wallet.')
    return
  }

  const originalText = button?.textContent
  if (button) {
    button.disabled = true
    button.textContent = 'Assigning...'
  }
  try {
    const payload = await requestDashboardApi('/rewards/wallet', {
      method: 'POST',
      accessToken: session.access_token,
      body: {},
    })
    dashboardRewards = payload.rewards ?? payload
    renderRewards(dashboardRewards)
    await loadHoldingsState(session)
    showToast(payload.duplicate ? 'Reward wallet already assigned.' : 'Solana reward wallet assigned.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Reward wallet could not be assigned.')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

async function exportRewardWalletKey(event) {
  const button = event?.currentTarget
  if (!window.confirm('Export this wallet private key? Anyone with this key can control the wallet.')) {
    return
  }
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before exporting the wallet key.')
    return
  }

  const originalText = button?.textContent
  if (button) {
    button.disabled = true
    button.textContent = 'Exporting...'
  }
  try {
    const payload = await requestDashboardApi('/rewards/wallet/export', {
      method: 'POST',
      accessToken: session.access_token,
      body: {},
    })
    const privateKey = payload?.export?.private_key_base58
    if (!privateKey) throw new Error('Wallet key export returned no key.')
    showRewardWalletKey(privateKey)
    showToast('Reward wallet private key exported.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Reward wallet key export failed.')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

function showRewardWalletKey(privateKey) {
  const output = document.querySelector('[data-reward-wallet-key-output]')
  const keyElement = document.querySelector('[data-reward-wallet-key]')
  const copyButton = document.querySelector('[data-reward-wallet-key-copy]')
  if (keyElement) {
    keyElement.textContent = privateKey
    keyElement.title = privateKey
  }
  if (copyButton) {
    copyButton.dataset.copyValue = privateKey
  }
  if (output) {
    output.hidden = false
  }
}

async function submitRewardClaim(button) {
  const allocationId = button?.dataset?.rewardClaim
  if (!allocationId) return
  if (button.disabled) return
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before claiming UNV.')
    return
  }

  const originalText = button.textContent
  button.disabled = true
  button.textContent = 'Submitting...'
  try {
    const payload = await requestDashboardApi('/rewards/claims', {
      method: 'POST',
      accessToken: session.access_token,
      body: { allocation_id: allocationId },
    })
    dashboardRewards = payload.rewards ?? dashboardRewards
    renderRewards(dashboardRewards)
    showToast(payload.duplicate ? 'Claim already submitted.' : 'UNV claim submitted.')
  } catch (error) {
    button.disabled = false
    button.textContent = originalText
    showToast(error instanceof Error ? error.message : 'UNV claim could not be submitted.')
  }
}

async function loadWebhooksState(session, announce = false) {
  if (!isDashboardPage() || !session?.access_token) return
  try {
    const payload = await requestDashboardApi('/webhooks', {
      method: 'GET',
      accessToken: session.access_token,
    })
    applyWebhooksPayload(payload)
    if (announce) showToast('Webhook deliveries refreshed.')
  } catch (error) {
    renderWebhooksError(error instanceof Error ? error.message : 'Webhooks could not be loaded.')
  }
}

async function createWebhookEndpoint(event) {
  event.preventDefault()
  const form = event.currentTarget
  const input = document.querySelector('[data-webhook-url-input]')
  const url = input?.value?.trim()
  if (!url) {
    showToast('Enter a webhook endpoint URL first.')
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before adding a webhook endpoint.')
    return
  }

  const button = form?.querySelector('button[type="submit"]')
  const originalText = button?.textContent
  if (button) {
    button.disabled = true
    button.textContent = 'Adding...'
  }
  try {
    const payload = await requestDashboardApi('/webhooks/endpoints', {
      method: 'POST',
      accessToken: session.access_token,
      body: {
        url,
        subscribed_events: DEFAULT_WEBHOOK_SUBSCRIPTIONS,
      },
    })
    applyWebhooksPayload(payload.webhooks ?? payload)
    if (input) input.value = ''
    if (payload.webhook_secret) {
      openOneTimeSecretModal({
        kicker: 'Webhook endpoint added',
        title: 'Save this webhook secret now',
        description:
          'This signing secret is required to verify Universa webhook deliveries. Copy it into your backend before closing this modal.',
        secretLabel: 'Webhook signing secret',
        secretValue: payload.webhook_secret,
      })
    } else {
      showToast('Webhook endpoint added.')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Webhook endpoint could not be added.')
  } finally {
    if (button) {
      button.disabled = false
      button.textContent = originalText
    }
  }
}

async function sendWebhookTestEvent(endpointId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before sending a test webhook.')
    return
  }

  try {
    const payload = await requestDashboardApi('/webhooks/test', {
      method: 'POST',
      accessToken: session.access_token,
      body: endpointId ? { endpoint_id: endpointId } : {},
    })
    applyWebhooksPayload(payload.webhooks ?? payload)
    showToast('Webhook test event queued.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Webhook test event could not be queued.')
  }
}

async function rotateWebhookSecret(endpointId) {
  if (!endpointId) return
  if (!window.confirm('Rotate this webhook signing secret? The old secret will stop verifying future deliveries.')) {
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before rotating a webhook secret.')
    return
  }

  try {
    const payload = await requestDashboardApi(`/webhooks/endpoints/${encodeURIComponent(endpointId)}/rotate`, {
      method: 'POST',
      accessToken: session.access_token,
      body: {},
    })
    applyWebhooksPayload(payload.webhooks ?? payload)
    if (payload.webhook_secret) {
      openOneTimeSecretModal({
        kicker: 'Webhook secret rotated',
        title: 'Save this webhook secret now',
        description:
          'The previous webhook secret no longer verifies future deliveries. Copy the new secret into your backend before closing this modal.',
        secretLabel: 'Webhook signing secret',
        secretValue: payload.webhook_secret,
      })
    } else {
      showToast('Webhook secret rotated.')
    }
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Webhook secret could not be rotated.')
  }
}

async function disableWebhookEndpoint(endpointId) {
  if (!endpointId) return
  if (!window.confirm('Disable this webhook endpoint? Pending deliveries to this endpoint will stop.')) {
    return
  }

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session?.access_token) {
    showToast('Sign in again before disabling a webhook endpoint.')
    return
  }

  try {
    const payload = await requestDashboardApi(`/webhooks/endpoints/${encodeURIComponent(endpointId)}`, {
      method: 'DELETE',
      accessToken: session.access_token,
    })
    applyWebhooksPayload(payload.webhooks ?? payload)
    showToast('Webhook endpoint disabled.')
  } catch (error) {
    showToast(error instanceof Error ? error.message : 'Webhook endpoint could not be disabled.')
  }
}

function applyWebhooksPayload(payload) {
  dashboardWebhookEndpoints = Array.isArray(payload?.endpoints) ? payload.endpoints : []
  dashboardWebhookDeliveries = Array.isArray(payload?.deliveries) ? payload.deliveries : []
  renderWebhookPanel()
}

function renderWebhookPanel() {
  const endpointList = document.querySelector('[data-webhook-endpoint-list]')
  const deliveryList = document.querySelector('[data-webhook-delivery-list]')
  const endpointCount = document.querySelector('[data-webhook-endpoint-count]')
  const activeEndpoints = dashboardWebhookEndpoints.filter((endpoint) => endpoint.status === 'active')

  if (endpointCount) {
    endpointCount.textContent = `${activeEndpoints.length} active`
  }
  if (endpointList) {
    endpointList.innerHTML = dashboardWebhookEndpoints.length
      ? dashboardWebhookEndpoints.map(webhookEndpointHtml).join('')
      : `<div class="dashboard-empty-row">
          <strong>No webhook endpoint connected</strong>
          <span>Add an endpoint to receive signed status events from Universa.</span>
        </div>`
  }
  if (deliveryList) {
    deliveryList.innerHTML = dashboardWebhookDeliveries.length
      ? dashboardWebhookDeliveries.map(webhookDeliveryHtml).join('')
      : `<div class="dashboard-empty-row">
          <strong>No deliveries yet</strong>
          <span>Test events and API-generated events will appear here with status, attempts, and retry timing.</span>
        </div>`
  }
}

function renderWebhooksError(message) {
  const endpointList = document.querySelector('[data-webhook-endpoint-list]')
  if (!endpointList) return
  endpointList.innerHTML = `<div class="dashboard-empty-row">
    <strong>Webhooks unavailable</strong>
    <span>${escapeHtml(message)}</span>
  </div>`
}

function webhookEndpointHtml(endpoint) {
  const isActive = endpoint.status === 'active'
  return `<article class="api-key-row${isActive ? '' : ' is-revoked'}">
    <div>
      <span class="portal-label">${escapeHtml(endpoint.status ?? 'unknown')}</span>
      <h3>${escapeHtml(webhookEndpointTitle(endpoint.url))}</h3>
      <code>${escapeHtml(endpoint.url ?? '')}</code>
      <p>Events: ${escapeHtml(formatWebhookEvents(endpoint.subscribed_events))}.</p>
      <p class="api-key-secret-note">Created ${escapeHtml(formatDashboardDate(endpoint.created_at))}. Signing secrets are shown once at creation or rotation.</p>
    </div>
    <div class="api-key-row-actions">
      <button type="button" data-copy-value="${escapeAttribute(endpoint.id ?? '')}" data-copy-label="Webhook ID copied">Copy ID</button>
      ${isActive ? `<button type="button" data-webhook-test-endpoint="${escapeAttribute(endpoint.id)}">Send test</button>` : ''}
      ${isActive ? `<button type="button" data-webhook-rotate="${escapeAttribute(endpoint.id)}">Rotate secret</button>` : ''}
      ${isActive ? `<button type="button" data-webhook-disable="${escapeAttribute(endpoint.id)}">Disable</button>` : ''}
    </div>
  </article>`
}

function webhookDeliveryHtml(delivery) {
  const status = String(delivery.status ?? 'pending')
  const timing = delivery.delivered_at
    ? `Delivered ${formatDashboardDate(delivery.delivered_at)}`
    : delivery.next_attempt_at
      ? `Next attempt ${formatDashboardDate(delivery.next_attempt_at)}`
      : `Created ${formatDashboardDate(delivery.created_at)}`
  const error = delivery.last_error
    ? `<p class="api-key-secret-note">${escapeHtml(delivery.last_error)}</p>`
    : ''
  return `<article class="api-key-row${status === 'delivered' ? '' : ' is-revoked'}">
    <div>
      <span class="portal-label">${escapeHtml(status)}</span>
      <h3>${escapeHtml(delivery.event_type ?? 'webhook.event')}</h3>
      <code>${escapeHtml(delivery.event_id ?? delivery.id ?? '')}</code>
      <p>${escapeHtml(timing)}. Attempts: ${escapeHtml(delivery.attempts ?? 0)}.</p>
      ${error}
    </div>
    <div class="api-key-row-actions">
      <button type="button" data-copy-value="${escapeAttribute(delivery.id ?? '')}" data-copy-label="Delivery ID copied">Copy delivery ID</button>
    </div>
  </article>`
}

function formatWebhookEvents(events) {
  if (!Array.isArray(events) || !events.length) return 'all events'
  return events.join(', ')
}

function webhookEndpointTitle(value) {
  try {
    const url = new URL(value)
    return url.hostname
  } catch {
    return 'Webhook endpoint'
  }
}

function renderRewards(payload = dashboardRewards) {
  const wallet = payload?.reward_wallet ?? null
  const allocations = Array.isArray(payload?.allocations) ? payload.allocations : []
  const claims = Array.isArray(payload?.claims) ? payload.claims : []
  const summary = payload?.summary ?? {}
  const accountKycActive = payload?.account?.account_kyc_status === 'active' || payload?.account?.kyb_status === 'approved'
  const assignmentPending = Boolean(payload?.wallet_assignment_pending)
  const assignmentError = typeof payload?.wallet_assignment_error === 'string' ? payload.wallet_assignment_error : ''
  const walletStatus = document.querySelector('[data-rewards-wallet-status]')
  const walletSummary = document.querySelector('[data-rewards-wallet-summary]')
  const walletAddress = document.querySelector('[data-reward-wallet-address]')
  const walletNote = document.querySelector('[data-rewards-wallet-note]')
  const assignButton = document.querySelector('[data-reward-wallet-assign]')
  const copyButton = document.querySelector('[data-reward-wallet-copy]')
  const exportButton = document.querySelector('[data-reward-wallet-export]')
  const gasNote = document.querySelector('[data-rewards-wallet-gas-note]')
  const eligibleTotal = document.querySelector('[data-rewards-eligible]')
  const pendingCount = document.querySelector('[data-rewards-pending]')
  const allocationList = document.querySelector('[data-reward-allocation-list]')
  const claimList = document.querySelector('[data-reward-claim-list]')

  const hasWalletHistory = Boolean(wallet?.wallet_address)
  const hasWallet = Boolean(
    wallet?.wallet_address
      && wallet.status === 'active'
      && wallet.wallet_provider === 'universa'
      && wallet.custody_model === 'server_wallet'
      && wallet.chain === 'solana',
  )
  const walletLabel = hasWallet ? shortAddress(wallet.wallet_address, 4, 4) : 'Not assigned'
  if (walletStatus) {
    walletStatus.textContent = hasWallet
      ? 'Active'
      : assignmentError || hasWalletHistory
        ? 'Needs review'
        : accountKycActive
          ? 'Provisioning'
          : 'KYC required'
  }
  if (walletSummary) walletSummary.textContent = walletLabel
  if (walletAddress) {
    walletAddress.textContent = hasWallet ? walletLabel : 'Assigned after Account KYC'
    walletAddress.title = hasWallet ? wallet.wallet_address : ''
  }
  if (assignButton) {
    assignButton.hidden = true
    assignButton.disabled = true
  }
  if (copyButton) {
    copyButton.disabled = !hasWallet
    copyButton.dataset.copyValue = hasWallet ? wallet.wallet_address : ''
  }
  if (exportButton) {
    exportButton.disabled = !hasWallet
    exportButton.hidden = !hasWallet
  }
  if (gasNote) {
    gasNote.hidden = !hasWallet
    gasNote.textContent = hasWallet ? 'Add SOL for gas before claiming.' : ''
  }
  if (walletNote) {
    walletNote.textContent = hasWallet
      ? `Locked to ${walletLabel}.`
      : hasWalletHistory
        ? 'Reward wallet history exists for this tenant. Manual review is required before any new Universa Solana wallet can be assigned.'
      : assignmentError
        ? assignmentError
        : accountKycActive || assignmentPending
          ? 'Universa is provisioning the one Solana custody wallet that reward allocations and claims must match.'
        : 'Account KYC must be active before Universa assigns the one wallet allowed for reward releases.'
  }
  if (eligibleTotal) renderTypingText(eligibleTotal, formatUnvAmount(summary.eligible_token_amount))
  if (pendingCount) renderTypingText(pendingCount, String(summary.pending_claims ?? 0))

  if (allocationList) {
    const claimable = claimableAllocations(allocations, claims)
    allocationList.innerHTML = claimable.length
      ? claimable.map((allocation) => rewardAllocationHtml(allocation, wallet)).join('')
      : `<div class="dashboard-empty-row">
          <strong>No eligible UNV yet</strong>
          <span>Approved reward epochs will show here once usage allocations are published.</span>
        </div>`
  }

  if (claimList) {
    claimList.innerHTML = claims.length
      ? claims.map(rewardClaimHtml).join('')
      : `<div class="dashboard-empty-row">
          <strong>No claims submitted</strong>
          <span>Submitted and confirmed UNV releases will appear here.</span>
        </div>`
  }
  renderHoldingsDock()
  renderPaymentSourceWallet()
}

function holdingAssetMeta(asset) {
  return asset === 'unv'
    ? {
        asset: 'unv',
        symbol: 'UNV',
        title: 'UNV holdings',
        kicker: 'Universa rewards',
      }
    : {
        asset: 'usdc',
        symbol: 'USDC',
        title: 'USDC holdings',
        kicker: 'Solana settlement',
      }
}

function holdingToken(asset = activeHoldingsAsset) {
  const normalized = asset === 'unv' ? 'unv' : 'usdc'
  return dashboardHoldings?.tokens?.[normalized] ?? null
}

function holdingWalletAddress() {
  return dashboardHoldings?.wallet_address
    || dashboardRewards?.reward_wallet?.wallet_address
    || ''
}

function formatHoldingNumber(asset, value, mode = 'full') {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return String(value ?? '0')
  if (mode === 'pill') {
    if (asset === 'usdc') {
      return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number)
    }
    return new Intl.NumberFormat('en-US', {
      notation: number >= 100000 ? 'compact' : 'standard',
      maximumFractionDigits: number >= 1 ? 2 : 6,
    }).format(number)
  }
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: asset === 'usdc' ? 2 : 0,
    maximumFractionDigits: 6,
  }).format(number)
}

function formatHoldingPill(asset) {
  const token = holdingToken(asset)
  if (dashboardHoldingsInFlight && !token) return '...'
  if (!token || dashboardHoldings?.status === 'wallet_required') return '--'
  return formatHoldingNumber(asset, token.amount ?? token.ui_amount, 'pill')
}

function formatHoldingBalance(asset) {
  const meta = holdingAssetMeta(asset)
  const token = holdingToken(meta.asset)
  if (!token || dashboardHoldings?.status === 'wallet_required') return `0 ${meta.symbol}`
  return `${formatHoldingNumber(meta.asset, token.amount ?? token.ui_amount, 'full')} ${meta.symbol}`
}

function holdingsStatusText() {
  if (dashboardHoldingsInFlight) return 'Refreshing on-chain balance'
  if (dashboardHoldings?.status === 'live') return 'Live from confirmed Solana token accounts'
  if (dashboardHoldings?.status === 'stale') {
    return dashboardHoldings?.errors?.solana ?? 'Balance lookup could not refresh'
  }
  return 'Assign a Universa Solana reward wallet to view holdings'
}

function renderHoldingsDock() {
  const dock = document.querySelector('[data-rewards-holdings-dock]')
  if (!dock) return
  const usdc = dock.querySelector('[data-holdings-pill-usdc]')
  const unv = dock.querySelector('[data-holdings-pill-unv]')
  if (usdc) usdc.textContent = formatHoldingPill('usdc')
  if (unv) unv.textContent = formatHoldingPill('unv')
  dock.dataset.holdingsStatus = dashboardHoldings?.status ?? 'wallet_required'
  dock.querySelectorAll('[data-holdings-open]').forEach((button) => {
    button.title = holdingsStatusText()
  })
}

async function openHoldingsModal(asset = 'usdc') {
  activeHoldingsAsset = asset === 'unv' ? 'unv' : 'usdc'
  const modal = document.querySelector('[data-holdings-modal]')
  if (!modal) return
  renderHoldingsModal()
  modal.hidden = false
  document.body.classList.add('modal-open')
  modal.querySelector('[data-holdings-close]')?.focus()

  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (session?.access_token) {
    await loadHoldingsState(session)
  }
}

function closeHoldingsModal() {
  const modal = document.querySelector('[data-holdings-modal]')
  if (!modal) return
  modal.hidden = true
  document.body.classList.remove('modal-open')
}

function renderHoldingsModal() {
  const modal = document.querySelector('[data-holdings-modal]')
  if (!modal) return
  const meta = holdingAssetMeta(activeHoldingsAsset)
  const token = holdingToken(meta.asset)
  const wallet = holdingWalletAddress()

  modal.querySelector('[data-holdings-kicker]').textContent = meta.kicker
  modal.querySelector('[data-holdings-title]').textContent = meta.title
  modal.querySelector('[data-holdings-primary-label]').textContent = `${meta.symbol} balance`
  modal.querySelector('[data-holdings-balance]').textContent = dashboardHoldingsInFlight && !token
    ? 'Refreshing...'
    : formatHoldingBalance(meta.asset)
  modal.querySelector('[data-holdings-status]').textContent = holdingsStatusText()
  const walletElement = modal.querySelector('[data-holdings-wallet]')
  if (walletElement) {
    walletElement.textContent = wallet ? shortAddress(wallet, 8, 8) : 'Not assigned'
    walletElement.title = wallet
  }
  const mintElement = modal.querySelector('[data-holdings-mint]')
  if (mintElement) {
    mintElement.textContent = token?.mint ? shortAddress(token.mint, 8, 8) : '--'
    mintElement.title = token?.mint ?? ''
  }
  modal.querySelector('[data-holdings-source]').textContent =
    dashboardHoldings?.source === 'solana_rpc' ? 'Solana RPC' : 'Dashboard API'
  modal.querySelector('[data-holdings-updated]').textContent = dashboardHoldings?.updated_at
    ? formatDashboardDate(dashboardHoldings.updated_at)
    : '--'
}

function renderRewardsError(message) {
  const allocationList = document.querySelector('[data-reward-allocation-list]')
  if (!allocationList) return
  allocationList.innerHTML = `<div class="dashboard-empty-row">
    <strong>Rewards unavailable</strong>
    <span>${escapeHtml(message)}</span>
  </div>`
}

function claimableAllocations(allocations, claims) {
  const claimedEpochs = new Set(
    claims
      .filter((claim) => ['submitted', 'confirmed'].includes(String(claim.status ?? '')))
      .map((claim) => String(claim.epoch_id ?? '')),
  )
  return allocations.filter((allocation) => (
    allocation.status === 'eligible'
    && allocation.epoch?.status === 'published'
    && !claimedEpochs.has(String(allocation.epoch_id ?? ''))
  ))
}

function rewardAllocationHtml(allocation, wallet) {
  const amount = formatUnvAmount(allocation.cumulative_token_amount)
  const volume = formatRewardUsd(allocation.epoch_settled_volume_usd)
  const epochLabel = allocation.epoch?.epoch_number ? `Epoch ${allocation.epoch.epoch_number}` : 'Reward epoch'
  const walletMatches = wallet?.wallet_address
    && String(wallet.wallet_address).toLowerCase() === String(allocation.wallet_address ?? '').toLowerCase()
  const disabled = walletMatches ? '' : ' disabled'
  const buttonText = walletMatches ? 'Claim UNV' : 'Assigned wallet required'
  return `<article class="reward-allocation-row">
    <div class="reward-row-icon" aria-hidden="true">${rewardMiniSvg()}</div>
    <div>
      <span class="portal-label">${escapeHtml(epochLabel)}</span>
      <h3>${escapeHtml(amount)}</h3>
      <p>${escapeHtml(allocation.milestone_label ?? 'Eligible developer reward')} · ${escapeHtml(volume)} settled in this epoch.</p>
      <code>${escapeHtml(shortAddress(allocation.wallet_address))}</code>
    </div>
    <button type="button" data-reward-claim="${escapeAttribute(allocation.id)}"${disabled}>${buttonText}</button>
  </article>`
}

function rewardClaimHtml(claim) {
  const status = String(claim.status ?? 'submitted')
  const amount = formatUnvAmount(claim.claimed_token_amount)
  const tx = claim.tx_hash
    ? `<a href="https://solscan.io/tx/${escapeAttribute(claim.tx_hash)}" target="_blank" rel="noreferrer">View tx</a>`
    : '<span>Release pending</span>'
  return `<article class="reward-claim-row">
    <div>
      <span class="portal-label">${escapeHtml(status)}</span>
      <h3>${escapeHtml(amount)}</h3>
      <p>Submitted ${escapeHtml(formatDashboardDate(claim.created_at))} to ${escapeHtml(shortAddress(claim.wallet_address))}.</p>
    </div>
    ${tx}
  </article>`
}

function rewardMiniSvg() {
  return `<svg viewBox="0 0 48 48" aria-hidden="true" focusable="false">
    <path d="M10 29c-4-11 3-24 15-25 11-1 21 8 20 20-1 13-13 22-25 19-5-1-8-6-10-14Z" fill="#ffd98d" />
    <path d="M13 31c9-4 18-4 27-1" fill="none" stroke="#07140f" stroke-width="4" stroke-linecap="round" />
    <rect x="16" y="13" width="18" height="15" rx="5" fill="#fff8df" />
    <path d="M21 21h8" stroke="#15c69b" stroke-width="4" stroke-linecap="round" />
  </svg>`
}

function formatUnvAmount(raw, decimals = 6) {
  const text = String(raw ?? '0').replace(/\..*$/, '')
  if (!/^\d+$/.test(text) || text === '0') return '0 UNV'
  const padded = text.padStart(decimals + 1, '0')
  const whole = padded.slice(0, -decimals)
  const fraction = padded.slice(-decimals).replace(/0+$/, '')
  const formattedWhole = addCommas(whole.replace(/^0+(?=\d)/, '') || '0')
  const displayFraction = fraction ? `.${fraction.slice(0, 2)}` : ''
  return `${formattedWhole}${displayFraction} UNV`
}

function addCommas(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

function formatRewardUsd(value) {
  const number = Number(value ?? 0)
  if (!Number.isFinite(number)) return '$0.00'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(number)
}

function shortAddress(value, head = 6, tail = 6) {
  const text = String(value ?? '').trim()
  if (!text) return 'Not assigned'
  if (text.length <= head + tail + 3) return text
  return `${text.slice(0, head)}...${text.slice(-tail)}`
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
    country_code: metadata.country_code ?? metadata.account_country_code ?? metadata.business_country,
    display_currency: metadata.display_currency ?? metadata.account_currency ?? metadata.currency,
  }
}

function updateDashboardAccessState(record = {}) {
  updateDashboardAccount(record)
  const status = normalizeKycStatus(record.account_kyc_status ?? record.kyc_status)
  dashboardAccessStatus = status
  renderUnvVaultMetrics()
  updateAccountKycActions(!isKycActive(status))
  if (record.metrics || record.resources) {
    renderDashboardResources(record)
  }
  if (Array.isArray(record.api_keys)) {
    dashboardApiKeys = record.api_keys
    renderApiKeyList(dashboardApiKeys)
    renderHomeApiKeySummary(dashboardApiKeys)
    updateHomeApiKeyAction(dashboardApiKeys)
  }
  updateApiKeyTaskAction(dashboardApiKeys)

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
      'The provider has approved this account. Universa can unlock API keys and provision virtual accounts for customers after their KYC is active.'
    apiStatus.textContent = activeKeyCount ? 'API keys active' : 'Ready to create'
    apiCopy.textContent = activeKeyCount
      ? `${activeKeyCount} server ${activeKeyCount === 1 ? 'key is' : 'keys are'} active. Only prefixes are shown here for logs and support; full keys and secrets cannot be viewed again.`
      : 'Create a server key, copy the one-time signing secret into your backend, and use the key prefix for request logs and support.'
    apiPreview.hidden = activeKeyCount > 0
    apiPreview.textContent = activeKeyCount
      ? ''
      : displayApiKeyPrefix(record.api_key_prefix || record.key_prefix || 'Create a key to reveal prefix')
    if (kycStep) kycStep.textContent = 'KYC active'
    if (vaStep) vaStep.textContent = 'Customer VAs eligible'
    if (keyStep) keyStep.textContent = 'API keys unlocked'
    return
  }

  if (status === 'rejected' || status === 'denied') {
    card.classList.add('is-rejected')
    statusLabel.textContent = 'Account KYC needs review'
    statusCopy.textContent =
      'The provider did not approve this account yet. API keys and customer virtual account provisioning stay locked until the account is remediated and marked active.'
    apiStatus.textContent = 'Locked'
    apiCopy.textContent = 'Resolve Account KYC before creating server keys or moving live funds.'
    apiPreview.hidden = false
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
      'Waiting for the provider to mark this account active. When the webhook or sync job writes active status, API keys and customer VA provisioning unlock here.'
    apiStatus.textContent = 'Locked during review'
    apiCopy.textContent = 'API keys unlock automatically after Account KYC becomes active.'
    apiPreview.hidden = false
    apiPreview.textContent = 'No key issued yet'
    if (kycStep) kycStep.textContent = 'KYC in review'
    if (vaStep) vaStep.textContent = 'VA pending'
    if (keyStep) keyStep.textContent = 'API keys locked'
    return
  }

  statusLabel.textContent = 'Account KYC required'
  statusCopy.textContent =
    'Universa uses the same provider-hosted KYC flow. Once the provider marks this account active, API keys and customer virtual account provisioning unlock together.'
  apiStatus.textContent = 'Locked until Account KYC'
  apiCopy.textContent =
    'After Account KYC is active, create a server key, copy the one-time signing secret into your backend, and use the key prefix for request logs.'
  apiPreview.hidden = false
  apiPreview.textContent = 'No key issued yet'
  if (kycStep) kycStep.textContent = 'KYC not started'
  if (vaStep) vaStep.textContent = 'VA locked'
  if (keyStep) keyStep.textContent = 'API keys locked'
}

function updateDashboardAccount(record = {}) {
  const account = plainObject(record.account)
  dashboardAccount = {
    ...(dashboardAccount ?? {}),
    ...account,
    account_kyc_status: record.account_kyc_status ?? account.account_kyc_status ?? dashboardAccount?.account_kyc_status,
    kyb_status: record.kyb_status ?? account.kyb_status ?? dashboardAccount?.kyb_status,
    country_code: record.country_code ?? account.country_code ?? dashboardAccount?.country_code,
    display_currency: record.display_currency
      ?? record.currency
      ?? account.display_currency
      ?? account.currency
      ?? dashboardAccount?.display_currency,
  }
}

function updateAccountKycActions(isVisible) {
  document.querySelectorAll('[data-kyc-action]').forEach((button) => {
    const shouldHide = !isVisible
    button.hidden = shouldHide
    button.disabled = shouldHide
    button.setAttribute('aria-hidden', String(shouldHide))
    const task = button.closest('.dashboard-task')
    if (task) {
      task.hidden = shouldHide
      task.setAttribute('aria-hidden', String(shouldHide))
    }
  })
}

function renderDashboardResources(record = {}) {
  const resources = record.resources ?? {}
  dashboardMetrics = record.metrics ?? dashboardMetrics
  dashboardResources = {
    customers: Array.isArray(resources.customers)
      ? resources.customers
      : dashboardResources.customers,
    virtual_accounts: Array.isArray(resources.virtual_accounts)
      ? resources.virtual_accounts
      : dashboardResources.virtual_accounts,
    transfers: Array.isArray(resources.transfers)
      ? resources.transfers
      : dashboardResources.transfers,
  }
  renderPaymentPanel()
  renderWalletPanel()
  renderCustomerPanel()
  renderPaymentCustomerOptions()
  updatePaymentFlowRoute()
  renderPaymentFlowResult()
}

function renderPaymentPanel() {
  const summary = document.querySelector('[data-payment-summary]')
  const transferList = document.querySelector('[data-payment-transfer-list]')
  const transfers = dashboardResources.transfers
  const metrics = dashboardMetrics ?? {}

  if (summary) {
    summary.innerHTML = `
      <article><span>Volume</span><strong>${escapeHtml(displayVolumeByCurrency(metrics.volume_by_currency))}</strong></article>
      <article><span>Transfers</span><strong>${escapeHtml(metrics.transfers ?? transfers.length)}</strong></article>
      <article><span>Platform fees</span><strong>${escapeHtml(formatMoneyAmount(metrics.platform_fees ?? 0, 'usd'))}</strong></article>
    `
  }

  if (!transferList) return
  transferList.innerHTML = transfers.length
    ? transfers.map(paymentTransferHtml).join('')
    : `<div class="dashboard-empty-row">
        <strong>No transfers yet</strong>
        <span>Completed, pending, returned, and canceled transfers will appear here once they exist for this tenant.</span>
      </div>`
}

function renderWalletPanel() {
  const walletList = document.querySelector('[data-wallet-list]')
  if (!walletList) return
  const accounts = dashboardResources.virtual_accounts
  walletList.innerHTML = accounts.length
    ? accounts.map(virtualAccountHtml).join('')
    : `<div class="dashboard-empty-row">
        <strong>No virtual accounts connected</strong>
        <span>Approved customer deposit details will appear here after a virtual account is issued.</span>
      </div>`
}

function renderCustomerPanel() {
  const customerList = document.querySelector('[data-customer-list]')
  const customerDetail = document.querySelector('[data-customer-detail]')
  if (!customerList) return
  const customers = dashboardResources.customers
  if (dashboardSelectedCustomerId && !customers.some((customer) => customer.id === dashboardSelectedCustomerId)) {
    dashboardSelectedCustomerId = ''
  }
  customerList.innerHTML = customers.length
    ? customers.map(customerHtml).join('')
    : `<div class="dashboard-empty-row">
        <strong>No users connected</strong>
        <span>Users appear here after they are connected through the API or mapped from provider-issued virtual accounts.</span>
      </div>`
  if (!customerDetail) return
  const selectedCustomer = customers.find((customer) => customer.id === dashboardSelectedCustomerId)
  customerDetail.hidden = !selectedCustomer
  customerDetail.innerHTML = selectedCustomer ? customerDetailHtml(selectedCustomer) : ''
}

function paymentTransferHtml(transfer) {
  const status = String(transfer.status ?? 'unknown')
  const statusClass = isSoftInactiveStatus(status) ? ' is-revoked' : ''
  const amount = formatMoneyAmount(transfer.gross_amount ?? transfer.destination_amount ?? 0, transfer.currency ?? 'usd')
  const route = `${formatRouteObject(transfer.source)} -> ${formatRouteObject(transfer.destination)}`
  const kind = formatStatusLabel(transfer.kind ?? 'transfer')
  const created = formatDashboardDate(transfer.created_at)
  const recon = formatStatusLabel(transfer.reconciliation_status ?? 'unreconciled')
  return `<article class="api-key-row${statusClass}">
    <div>
      <span class="portal-label">${escapeHtml(formatStatusLabel(status))}</span>
      <h3>${escapeHtml(`${amount} ${kind}`)}</h3>
      <code>${escapeHtml(transfer.id ?? transfer.provider_transfer_id ?? '')}</code>
      <p>${escapeHtml(route)}. Created ${escapeHtml(created)}.</p>
      <p class="api-key-secret-note">Provider: ${escapeHtml(formatStatusLabel(transfer.provider ?? 'unknown'))}. Reconciliation: ${escapeHtml(recon)}.</p>
    </div>
    <div class="api-key-row-actions">
      <button type="button" data-copy-value="${escapeAttribute(transfer.id ?? '')}" data-copy-label="Transfer ID copied">Copy transfer ID</button>
    </div>
  </article>`
}

function virtualAccountHtml(account) {
  const deposit = plainObject(account.deposit_instructions)
  const sourceCurrency = String(account.source_currency ?? deposit.currency ?? 'usd').toUpperCase()
  const rail = formatRail(account.source_rail ?? depositInstructionValue(deposit, [
    'payment_rail',
    'rail',
  ]) ?? firstArrayValue(deposit.payment_rails))
  const bankName = depositInstructionValue(deposit, ['bank_name', 'bankName', 'bank', 'institution_name'])
  const accountName = depositInstructionValue(deposit, [
    'account_holder_name',
    'account_name',
    'beneficiary_name',
    'recipient_name',
  ])
  const accountNumber = depositInstructionValue(deposit, [
    'account_number',
    'accountNumber',
    'account',
    'iban',
    'clabe',
  ])
  const routingNumber = depositInstructionValue(deposit, [
    'routing_number',
    'routingNumber',
    'ach_routing_number',
    'wire_routing_number',
    'bank_routing_number',
  ])
  const destination = dashboardSettlementLabelForAccount(account)
  const actionButtons = [
    accountNumber
      ? `<button type="button" data-copy-value="${escapeAttribute(accountNumber)}" data-copy-label="Account copied">Copy account</button>`
      : '',
    routingNumber
      ? `<button type="button" data-copy-value="${escapeAttribute(routingNumber)}" data-copy-label="Routing copied">Copy routing</button>`
      : '',
    `<button type="button" data-copy-value="${escapeAttribute(account.id ?? '')}" data-copy-label="Virtual account ID copied">Copy VA ID</button>`,
  ].filter(Boolean).join('')

  return `<article class="api-key-row">
    <div>
      <span class="portal-label">${escapeHtml(formatStatusLabel(account.status ?? 'unknown'))}</span>
      <h3>${escapeHtml(`${sourceCurrency} ${rail} virtual account`)}</h3>
      <code>${escapeHtml(account.provider_virtual_account_id ?? account.id ?? '')}</code>
      <p>${escapeHtml(bankName || 'Deposit instructions ready')}${accountName ? ` for ${escapeHtml(accountName)}` : ''}.</p>
      <p class="api-key-secret-note">
        ${accountNumber ? `Account ${escapeHtml(maskedBankValue(accountNumber))}. ` : ''}
        ${routingNumber ? `Routing ${escapeHtml(maskedBankValue(routingNumber))}. ` : ''}
        ${destination ? `Settles to ${escapeHtml(destination)}.` : ''}
      </p>
    </div>
    <div class="api-key-row-actions">${actionButtons}</div>
  </article>`
}

function customerHtml(customer) {
  const customerAccounts = dashboardResources.virtual_accounts
    .filter((account) => account.customer_id === customer.id)
  const activeAccounts = customerAccounts.filter((account) => account.status === 'active').length
  const matchedWalletAccount = customerAccounts.find((account) =>
    dashboardSettlementWalletForAccount(account)
  )
  const accountWithWallet = matchedWalletAccount
    ?? customerAccounts.find((account) => dashboardSettlementWalletForAccount(account))
  const walletAddress = accountWithWallet
    ? dashboardSettlementWalletForAccount(accountWithWallet)
    : ''
  const walletLabel = walletAddress
    ? shortAddress(walletAddress, 5, 5)
    : 'No linked wallet'
  const vaLabel = customerAccounts.length
    ? `${activeAccounts}/${customerAccounts.length} active VAs`
    : 'No issued VAs'
  const transferCount = dashboardResources.transfers.filter((transfer) => transfer.customer_id === customer.id).length
  const isImported = plainObject(customer.metadata).source === 'virtual_account_import'
  const name = customer.full_name || customer.email || customer.id
  const label = [
    customer.country_code,
    customer.type ? formatStatusLabel(customer.type) : '',
  ].filter(Boolean).join(' ')
  const kyc = formatStatusLabel(customer.provider_kyc_status ?? customer.status ?? 'unknown')
  return `<article class="api-key-row customer-row${dashboardSelectedCustomerId === customer.id ? ' is-selected' : ''}" data-customer-open="${escapeAttribute(customer.id ?? '')}">
    <div>
      <span class="portal-label">${escapeHtml(isImported ? 'Imported' : formatStatusLabel(customer.status ?? 'unknown'))}</span>
      <h3>${escapeHtml(name)}</h3>
      <code>${escapeHtml(customer.id ?? '')}</code>
      <p>${escapeHtml(isImported
        ? `Imported from linked provider virtual account${customer.provider ? ` on ${formatStatusLabel(customer.provider)}` : ''}.`
        : `${label || 'Customer'} with ${kyc} provider KYC.`)}</p>
      <p class="api-key-secret-note">Wallet: ${escapeHtml(walletLabel)}. Virtual accounts: ${escapeHtml(vaLabel)}. Transfers: ${escapeHtml(transferCount)}.</p>
    </div>
    <div class="api-key-row-actions">
      <button type="button" data-customer-open="${escapeAttribute(customer.id ?? '')}">Open user</button>
      <button type="button" data-copy-value="${escapeAttribute(customer.id ?? '')}" data-copy-label="Customer ID copied">Copy customer ID</button>
      ${walletAddress ? `<button type="button" data-copy-value="${escapeAttribute(walletAddress)}" data-copy-label="Wallet copied">Copy wallet</button>` : ''}
    </div>
  </article>`
}

function customerDetailHtml(customer) {
  const accounts = dashboardResources.virtual_accounts
    .filter((account) => account.customer_id === customer.id)
  const transfers = dashboardResources.transfers
    .filter((transfer) => transfer.customer_id === customer.id)
  const walletAccount = accounts.find((account) => dashboardSettlementWalletForAccount(account))
  const walletAddress = walletAccount ? dashboardSettlementWalletForAccount(walletAccount) : ''
  const name = customer.full_name || customer.email || customer.id
  const status = formatStatusLabel(customer.provider_kyc_status ?? customer.status ?? 'unknown')

  return `
    <div class="customer-detail-header">
      <div>
        <span class="portal-label">Master user view</span>
        <h2>${escapeHtml(name)}</h2>
        <p>${escapeHtml(status)} user. All visible wallets, virtual accounts, and transfers below are filtered to this user.</p>
      </div>
      <button type="button" data-copy-value="${escapeAttribute(customer.id ?? '')}" data-copy-label="Customer ID copied">Copy user ID</button>
    </div>
    <div class="customer-detail-grid">
      <article>
        <span>Assigned wallet</span>
        <strong>${escapeHtml(walletAddress ? shortAddress(walletAddress, 6, 6) : 'No linked wallet')}</strong>
        ${walletAddress ? `<button type="button" data-copy-value="${escapeAttribute(walletAddress)}" data-copy-label="Wallet copied">Copy wallet</button>` : ''}
      </article>
      <article>
        <span>Virtual accounts</span>
        <strong>${escapeHtml(String(accounts.length))}</strong>
        <small>${escapeHtml(accounts.filter((account) => account.status === 'active').length)} active</small>
      </article>
      <article>
        <span>Transfers</span>
        <strong>${escapeHtml(String(transfers.length))}</strong>
        <small>Recent user activity</small>
      </article>
    </div>
    <div class="customer-detail-section">
      <h3>Virtual accounts</h3>
      <div class="dashboard-resource-list">
        ${accounts.length ? accounts.map(virtualAccountHtml).join('') : `<div class="dashboard-empty-row"><strong>No virtual accounts</strong><span>No issued virtual accounts are linked to this user yet.</span></div>`}
      </div>
    </div>
    <div class="customer-detail-section">
      <h3>Transfers</h3>
      <div class="dashboard-resource-list">
        ${transfers.length ? transfers.map(paymentTransferHtml).join('') : `<div class="dashboard-empty-row"><strong>No transfers</strong><span>No transfer activity is linked to this user yet.</span></div>`}
      </div>
    </div>`
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
          <code>${escapeHtml(displayApiKeyPrefix(key.key_prefix))}</code>
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
  list.innerHTML = `<p class="portal-label">Active key prefixes</p>
    <p>${activeKeys.length} server ${activeKeys.length === 1 ? 'key is' : 'keys are'} active. Prefixes are not usable credentials.</p>
    ${visibleKeys.map((key) => `<div class="home-api-key-row">
      <code>${escapeHtml(displayApiKeyPrefix(key.key_prefix))}</code>
      <button type="button" data-copy-value="${escapeAttribute(key.key_prefix ?? '')}" data-copy-label="Key prefix copied">Copy prefix</button>
    </div>`).join('')}
    ${remaining > 0 ? `<p>${remaining} more ${remaining === 1 ? 'key' : 'keys'} in API docs.</p>` : ''}
    <button class="dashboard-action-secondary" type="button" data-panel-target="api">Manage / revoke keys</button>`
}

function displayApiKeyPrefix(prefix) {
  if (!prefix) return 'No prefix'
  const value = String(prefix)
  if (value.startsWith('unv_')) return `${value}...`
  if (value.startsWith('mk_')) return `Legacy test prefix: ${value}`
  return value
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

function updateApiKeyTaskAction(keys = dashboardApiKeys) {
  const button = document.querySelector('[data-api-key-task-action]')
  if (!button) return
  const activeCount = keys.filter((key) => key.status === 'active').length
  if (activeCount > 0) {
    button.textContent = 'Manage keys'
    button.setAttribute('aria-label', `${activeCount} active API ${activeCount === 1 ? 'key' : 'keys'}. Manage keys.`)
    return
  }
  if (isKycActive(dashboardAccessStatus)) {
    button.textContent = 'Create key'
    button.setAttribute('aria-label', 'Create an API key')
    return
  }
  button.textContent = 'Start'
  button.setAttribute('aria-label', 'Start API key setup')
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
      "payment_rail": "solana"
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
- Provider-hosted account KYC is the approval gate for the API account, matching the account status model.
- When account_kyc_status is active or kyc_status is approved, Universa unlocks API keys and customer VA provisioning.
- Create customers and launch hosted customer KYC. When customer KYC becomes active, Universa assigns a Privy-managed Solana wallet for that customer.
- Create or retry the customer virtual account after KYC approval. The VA destination defaults to the assigned Solana USDC wallet, so developers do not provide payout keys for on-ramp settlement.
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
6. Read GET /v1/customers/{customer_id}/wallet when your server needs the assigned Solana USDC destination.
7. Create or retry the customer virtual account with POST /v1/customers/{customer_id}/virtual-accounts.
8. Create a quote with POST /v1/quotes and include tenant_fee_bps.
9. Create a transfer with POST /v1/transfers using the open quote_id.
10. Use GET endpoints for support/reconciliation.
11. Configure webhooks for customer, customer wallet, KYC, virtual account, quote, transfer, and test events.

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
Returns: kyc_session with kyc_url, tos_url, status, expires_at, updated customer, and customer_wallet when active.

GET /v1/customers/{customer_id}/wallet
Scope: customer_wallets:read
Purpose: read the Privy-managed Solana wallet assigned after customer KYC is active. USDC/Solana transfer legs default to this address.

POST /v1/customers/{customer_id}/wallet/export
Scope: customer_wallets:export
Purpose: broker a Privy HPKE wallet export. Universa returns encrypted key material and never stores plaintext keys.
Body:
{
  "recipient_public_key": "hpke_recipient_public_key"
}

POST /v1/customers/{customer_id}/virtual-accounts
Scope: virtual_accounts:write
Purpose: create or retry reusable fiat deposit details for an approved customer. Destination defaults to the assigned Solana USDC wallet.
Requires: customer.status = active and provider_kyc_status = active.
Body:
{
  "source_currency": "usd"
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
    "payment_rail": "solana"
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
    "payment_rail": "solana"
  }
}

GET /v1/transfers/{transfer_id}
Scope: transfers:read
Purpose: retrieve transfer status, amounts, fees, source instructions, and timestamps.

Webhook guidance:
- Store webhook endpoint URL and signing secret server-side.
- Configure endpoints in the dashboard Webhooks panel. The secret is shown once at creation or rotation.
- Supported subscriptions include customer.*, customer_wallet.*, kyc_session.*, virtual_account.*, quote.*, transfer.*, webhook.test, exact event names, or *.
- Universa sends x-universa-event-id, x-universa-event-type, x-universa-delivery-id, x-universa-timestamp, and x-universa-signature.
- Verify x-universa-signature = "v1=" + hex(hmac_sha256($WEBHOOK_SECRET, x-universa-timestamp + "." + raw_body)).
- Return any 2xx response after durable processing. Non-2xx responses and network errors retry with exponential backoff and eventually dead-letter.
- Treat webhook delivery as the source of truth for async status changes, then use GET endpoints for reconciliation and support.
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
  const sourceCurrency = document.querySelector('[data-quote-source-currency]')
  const sourcePrefix = document.querySelector('[data-quote-source-prefix]')
  const arrival = document.querySelector('#quote-arrival')
  const destination = document.querySelector('#quote-destination')
  const totalFees = document.querySelector('#quote-total-fees')
  const liveNote = document.querySelector('#quote-live-note')
  const cta = document.querySelector('.quote-add-recipient')
  const tenantFeeInput = document.querySelector('#tenant-fee-bps')
  if (!amountInput || !receiveInput || !rate || !inlineFlag || !inlineCurrency) return

  const route = quoteRoutes[activeQuoteRoute] ?? quoteRoutes.mxn
  const sourceCurrencyCode = dashboardPaymentKind === 'offramp' ? 'USDC' : 'USD'
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
  topFlag?.setAttribute('src', flagUrl)
  inlineFlag.setAttribute('src', flagUrl)
  if (topCurrency) topCurrency.textContent = route.currency
  inlineCurrency.textContent = route.currency
  if (sourceCurrency) sourceCurrency.textContent = sourceCurrencyCode
  if (sourcePrefix) sourcePrefix.textContent = sourceCurrencyCode === 'USDC' ? 'USDC' : '$'
  renderTypingText(rate, formatFxRate(route))
  if (arrival) arrival.textContent = route.arrival
  if (destination) renderTypingText(destination, formatQuoteDestination(route))
  if (totalFees) {
    renderTypingText(totalFees, sourceCurrencyCode === 'USDC'
      ? formatMoneyAmount(total, 'USDC')
      : formatUsd(total))
  }
  if (liveNote) liveNote.textContent = route.note
  if (cta) {
    cta.classList.toggle('is-disabled', gross <= 0)
    cta.textContent = gross > 0 ? 'Add recipient' : 'Enter amount'
  }
  updatePaymentFlowRoute()
}

function initializeUnvLiveVault() {
  const balanceStatus = document.querySelector('[data-unv-vault-balance-status]')
  const sourceElement = document.querySelector('[data-unv-price-source]')
  const updatedElement = document.querySelector('[data-unv-price-updated]')
  if (!document.querySelector('[data-unv-vault-balance]')) return

  let channel = null
  let channelReady = false

  const sendPriceWatch = () => {
    if (!channel || !channelReady) return
    channel
      .send({
        type: 'broadcast',
        event: 'watch',
        payload: { mints: [UNV_MINT], sentAt: Date.now() },
      })
      .catch(() => {})
  }

  const applyPriceUpdate = (update, options = {}) => {
    unvLiveVaultState = {
      ...unvLiveVaultState,
      priceUsd: update.priceUsd,
    }
    if (sourceElement) {
      const source = update.source ? formatStatusLabel(String(update.source).replace(/:/g, ' ')) : 'Monet price feed'
      sourceElement.textContent = options.direct ? `Live via ${source}` : `Live via ${source} through Monet`
    }
    if (updatedElement) updatedElement.textContent = formatLivePriceUpdatedAt(update.updatedAt)
    renderUnvVaultMetrics()
  }

  const fetchVaultSnapshot = async () => {
    const snapshot = await fetchUnvVaultSnapshot()
    if (!snapshot) {
      if (balanceStatus) balanceStatus.textContent = 'Verified vault funding amount'
      return
    }
    const nextBalance = Number(snapshot.balance)
    if (Number.isFinite(nextBalance) && nextBalance >= 0) {
      unvLiveVaultState = {
        ...unvLiveVaultState,
        vaultBalance: nextBalance,
      }
      if (balanceStatus) {
        balanceStatus.textContent = snapshot.balanceSource === 'solana_rpc'
          ? 'Live Solana vault account'
          : 'Verified vault funding amount'
      }
    }
    const snapshotPrice = Number(snapshot.priceUsd)
    if (Number.isFinite(snapshotPrice) && snapshotPrice > 0) {
      applyPriceUpdate({
        priceUsd: snapshotPrice,
        source: snapshot.priceSource ?? 'jupiter',
        updatedAt: Number(snapshot.updatedAt) || Date.now(),
      }, { direct: true })
      return
    }
    renderUnvVaultMetrics()
  }

  renderUnvVaultMetrics()
  fetchVaultSnapshot().catch(() => {
    if (balanceStatus) balanceStatus.textContent = 'Verified vault funding amount'
  })

  channel = monetSupabase
    .channel(TOKEN_PRICE_TOPIC)
    .on('broadcast', { event: 'price_batch' }, ({ payload }) => {
      const updates = normalizeTokenPriceUpdates(payload)
      const update = updates.find((row) => row.mint === UNV_MINT)
      if (update) applyPriceUpdate(update)
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        channelReady = true
        sendPriceWatch()
        return
      }
      if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        channelReady = false
        if (updatedElement) updatedElement.textContent = 'Reconnecting to Monet feed'
      }
    })

  const priceHeartbeat = window.setInterval(sendPriceWatch, TOKEN_PRICE_WATCH_HEARTBEAT_MS)
  const snapshotHeartbeat = window.setInterval(() => {
    fetchVaultSnapshot().catch(() => {
      if (balanceStatus) balanceStatus.textContent = 'Verified vault funding amount'
    })
  }, UNV_VAULT_SNAPSHOT_POLL_MS)

  window.addEventListener('pagehide', () => {
    window.clearInterval(priceHeartbeat)
    window.clearInterval(snapshotHeartbeat)
    if (channel) monetSupabase.removeChannel(channel).catch(() => {})
  }, { once: true })
}

function renderUnvVaultMetrics() {
  const balanceElement = document.querySelector('[data-unv-vault-balance]')
  const valueElement = document.querySelector('[data-unv-vault-value]')
  const priceElement = document.querySelector('[data-unv-price]')
  const valueCurrencyElement = document.querySelector('[data-unv-vault-value-currency]')
  const valueLabelElement = document.querySelector('[data-unv-vault-value-label]')
  if (!balanceElement || !valueElement || !priceElement) return

  const vaultBalance = Number(unvLiveVaultState.vaultBalance)
  const priceUsd = Number(unvLiveVaultState.priceUsd)
  const display = dashboardUnvDisplayCurrency()
  renderFlipValue(balanceElement, formatUnvBalance(vaultBalance))
  renderFlipValue(priceElement, formatUnvPriceUsd(priceUsd))
  const vaultValueUsd = Number.isFinite(priceUsd) && priceUsd > 0 && Number.isFinite(vaultBalance)
    ? vaultBalance * priceUsd
    : null
  const vaultDisplayValue = Number.isFinite(vaultValueUsd)
    ? vaultValueUsd * display.usdToCurrencyRate
    : null
  renderFlipValue(
    valueElement,
    Number.isFinite(vaultDisplayValue)
      ? formatMoneyAmount(vaultDisplayValue, display.currency, { locale: display.locale })
      : display.currency === 'USD' ? '$--' : `-- ${display.currency}`,
  )
  if (valueCurrencyElement) valueCurrencyElement.textContent = display.note
  if (valueLabelElement) valueLabelElement.textContent = `${display.currency} vault value`
}

function dashboardUnvDisplayCurrency() {
  const account = plainObject(dashboardAccount)
  const status = normalizeKycStatus(account.account_kyc_status ?? account.kyb_status)
  const isActive = isKycActive(status)
  const countryCode = countryCodeFromValue(
    account.country_code
      ?? account.country
      ?? account.account_country_code
      ?? account.business_country
      ?? account.business_country_code,
  )
  if (!isActive) {
    return {
      currency: 'USD',
      locale: 'en-US',
      usdToCurrencyRate: 1,
      note: 'USD shown until Account KYC country is active.',
    }
  }

  const requestedCurrency = normalizeCurrencyCode(
    account.display_currency
      ?? account.account_currency
      ?? account.default_currency
      ?? account.currency,
  )
  const currency = requestedCurrency || COUNTRY_CURRENCY_MAP[countryCode] || 'USD'
  if (currency === 'USD') {
    return {
      currency,
      locale: 'en-US',
      usdToCurrencyRate: 1,
      note: countryCode ? `USD based on ${countryLabel(countryCode)} account country.` : 'USD shown because no Account KYC country is set.',
    }
  }

  const route = Object.values(quoteRoutes).find((candidate) => candidate.currency === currency)
  const rate = Number(route?.rate)
  if (!Number.isFinite(rate) || rate <= 0) {
    return {
      currency: 'USD',
      locale: 'en-US',
      usdToCurrencyRate: 1,
      note: `${currency} is not priced in this dashboard yet, so USD is shown.`,
    }
  }

  return {
    currency,
    locale: route?.locale ?? currencyLocale(currency),
    usdToCurrencyRate: rate,
    note: `${currency} value based on ${countryCode ? `${countryLabel(countryCode)} account country` : 'account currency'}.`,
  }
}

async function fetchUnvVaultSnapshot() {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${UNV_VAULT_ENDPOINT}?t=${Date.now()}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: controller.signal,
    })
    if (!response.ok) return null
    const payload = await response.json()
    return payload && typeof payload === 'object' ? payload : null
  } catch {
    return null
  } finally {
    window.clearTimeout(timeout)
  }
}

function normalizeTokenPriceUpdates(payload) {
  const rows = Array.isArray(payload?.prices) ? payload.prices : Array.isArray(payload) ? payload : []
  return rows
    .map((row) => {
      const mint = String(row?.mint ?? '').trim()
      const priceUsd = Number(row?.priceUsd ?? row?.usdPrice)
      if (!mint || !Number.isFinite(priceUsd) || priceUsd <= 0) return null
      const updatedAt = Number(row?.updatedAt)
      return {
        mint,
        priceUsd,
        source: typeof row?.source === 'string' ? row.source : null,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
      }
    })
    .filter(Boolean)
}

function renderFlipValue(element, text) {
  if (!element || element.textContent.trim() === text) return
  if (reducedMotion) {
    element.textContent = text
    return
  }
  element.classList.remove('is-flipping')
  void element.offsetWidth
  element.textContent = text
  element.classList.add('is-flipping')
}

function formatUnvBalance(value) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return '5,000,000 UNV'
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
  }).format(amount)} UNV`
}

function formatUnvPriceUsd(value) {
  const price = Number(value)
  if (!Number.isFinite(price) || price <= 0) return '$--'
  const maximumFractionDigits = price >= 1 ? 4 : price >= 0.01 ? 6 : 8
  const minimumFractionDigits = price >= 1 ? 2 : Math.min(4, maximumFractionDigits)
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(price)
}

function formatLivePriceUpdatedAt(value) {
  const date = new Date(Number(value))
  if (Number.isNaN(date.getTime())) return 'Live price feed active'
  return `Updated ${new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  }).format(date)}`
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

function displayVolumeByCurrency(volumeByCurrency) {
  const entries = Object.entries(plainObject(volumeByCurrency))
    .map(([currency, amount]) => [currency, Number(amount)])
    .filter(([, amount]) => Number.isFinite(amount) && amount > 0)
    .sort((left, right) => right[1] - left[1])
  if (!entries.length) return '$0.00'
  const [currency, amount] = entries[0]
  return formatMoneyAmount(amount, currency)
}

function formatMoneyAmount(value, currency = 'usd', options = {}) {
  const amount = Number(value)
  const normalizedCurrency = String(currency || 'usd').toUpperCase()
  if (!Number.isFinite(amount)) {
    return normalizedCurrency === 'USD' ? '$0.00' : `0 ${normalizedCurrency}`
  }
  if (/^[A-Z]{3}$/.test(normalizedCurrency)) {
    const fractionDigits = options.fractionDigits ?? currencyFractionDigits(normalizedCurrency)
    return new Intl.NumberFormat(options.locale ?? currencyLocale(normalizedCurrency), {
      style: 'currency',
      currency: normalizedCurrency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    }).format(amount)
  }
  return `${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
  }).format(amount)} ${normalizedCurrency}`
}

function formatRouteObject(route) {
  const object = plainObject(route)
  const country = countryLabel(object.country ?? object.country_code)
  const currency = object.currency ? String(object.currency).toUpperCase() : ''
  const railValue = object.payment_rail ?? object.rail
  const normalizedRail = String(railValue ?? '').toLowerCase()
  const rail = currency === 'USDC' && normalizedRail === 'base'
    ? 'Solana'
    : formatRail(railValue)
  return [country, currency, rail].filter(Boolean).join(' ') || 'Unknown route'
}

function currencyLocale(currency) {
  const locales = {
    USD: 'en-US',
    MXN: 'es-MX',
    BRL: 'pt-BR',
    COP: 'es-CO',
    GBP: 'en-GB',
  }
  return locales[String(currency || '').toUpperCase()] ?? 'en-US'
}

function currencyFractionDigits(currency) {
  const digits = {
    COP: 0,
  }
  return digits[String(currency || '').toUpperCase()] ?? 2
}

function normalizeCurrencyCode(value) {
  const code = String(value ?? '').trim().toUpperCase()
  return /^[A-Z]{3}$/.test(code) ? code : ''
}

function countryCodeFromValue(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ')
  const aliases = {
    us: 'US',
    usa: 'US',
    'united states': 'US',
    mx: 'MX',
    mex: 'MX',
    mexico: 'MX',
    br: 'BR',
    bra: 'BR',
    brazil: 'BR',
    co: 'CO',
    col: 'CO',
    colombia: 'CO',
    gb: 'GB',
    gbr: 'GB',
    uk: 'GB',
    'united kingdom': 'GB',
  }
  return aliases[key] ?? (/^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : '')
}

function countryLabel(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return ''
  const key = raw.toLowerCase().replace(/[_-]+/g, ' ')
  const aliases = {
    us: 'US',
    usa: 'US',
    'united states': 'US',
    mx: 'MX',
    mex: 'MX',
    mexico: 'MX',
    br: 'BR',
    bra: 'BR',
    brazil: 'BR',
    co: 'CO',
    col: 'CO',
    colombia: 'CO',
    gb: 'GB',
    gbr: 'GB',
    uk: 'GB',
    'united kingdom': 'GB',
  }
  const code = aliases[key] ?? (/^[a-z]{2}$/i.test(raw) ? raw.toUpperCase() : '')
  if (!code) return formatStatusLabel(raw)
  try {
    if (typeof Intl.DisplayNames === 'function') {
      return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code
    }
  } catch {
    // Fall through to static labels below.
  }
  return {
    US: 'United States',
    MX: 'Mexico',
    BR: 'Brazil',
    CO: 'Colombia',
    GB: 'United Kingdom',
  }[code] ?? code
}

function formatRail(value) {
  const raw = String(value ?? '').trim()
  if (!raw) return 'Rail'
  const normalized = raw.toLowerCase()
  const labels = {
    ach: 'ACH',
    ach_push: 'ACH Push',
    wire: 'Wire',
    bank: 'Bank',
    base: 'Base',
    solana: 'Solana',
    sepa: 'SEPA',
    pix: 'PIX',
    spei: 'SPEI',
    faster_payments: 'Faster Payments',
  }
  return labels[normalized] ?? formatStatusLabel(normalized)
}

function formatStatusLabel(value) {
  return String(value ?? 'unknown')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function isSoftInactiveStatus(status) {
  return ['canceled', 'cancelled', 'failed', 'rejected', 'returned', 'closed', 'suspended']
    .includes(String(status ?? '').toLowerCase())
}

function plainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {}
}

function firstArrayValue(value) {
  return Array.isArray(value) && value.length ? value[0] : null
}

function depositInstructionValue(deposit, keys) {
  const containers = [
    plainObject(deposit),
    plainObject(deposit.account),
    plainObject(deposit.bank_account),
    plainObject(deposit.account_details),
    plainObject(deposit.source),
    plainObject(deposit.destination),
    plainObject(deposit.beneficiary),
    plainObject(deposit.instructions),
  ]
  for (const container of containers) {
    for (const key of keys) {
      const value = container[key]
      if (typeof value === 'string' && value.trim()) return value.trim()
      if (typeof value === 'number' && Number.isFinite(value)) return String(value)
    }
  }
  return ''
}

function maskedBankValue(value) {
  const raw = String(value ?? '').replace(/\s+/g, '')
  if (!raw) return 'not available'
  if (raw.length <= 4) return `ending ${raw}`
  return `ending ${raw.slice(-4)}`
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
  return formatMoneyAmount(value, 'USD')
}

function formatLocal(value, route) {
  return formatMoneyAmount(value, route.currency, {
    fractionDigits: route.decimals,
    locale: route.locale,
  })
}

function formatFxRate(route) {
  const decimals = route.rate >= 100 ? 2 : route.rate >= 10 ? 4 : 5
  return `1 USD = ${formatMoneyAmount(route.rate, route.currency, {
    fractionDigits: decimals,
    locale: route.locale,
  })}`
}

function formatQuoteDestination(route) {
  const rail = String(route.rail ?? '').trim()
  if (!rail) return `${route.currency} bank`
  return rail.toLowerCase().includes('bank')
    ? `${route.currency} bank`
    : `${route.currency} ${rail} bank`
}

function formatRawAmount(value, decimals) {
  if (!Number.isFinite(value) || value <= 0) return ''
  const fixed = value.toFixed(decimals)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

initializeVisualViewportGuard()
prepareAnimatedCopy()
animatePhrase()
observeAnimations()
initializeQuoteWidget()
initializeUnvLiveVault()
initializeAuth()

if (!reducedMotion) {
  window.setInterval(animatePhrase, 3200)
}
