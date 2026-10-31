/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import {
  Server,
  Play,
  CheckCircle2,
  XCircle,
  Database,
  Shield,
  Layers,
  MapPin,
  CreditCard,
  Send,
  RefreshCw,
  FileCode,
  Terminal,
  Activity,
  ChevronRight,
  BookOpen,
  DollarSign,
  AlertTriangle,
  Zap,
} from 'lucide-react';

interface TestResult {
  category: string;
  name: string;
  status: 'passed' | 'failed';
  durationMs: number;
  details?: string;
  error?: string;
}

interface TestSummary {
  total: number;
  passed: number;
  failed: number;
  durationMs: number;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<'docs' | 'explorer' | 'tests' | 'database' | 'analytics'>('docs');
  const [healthStatus, setHealthStatus] = useState<any>(null);
  const [isRunningTests, setIsRunningTests] = useState(false);
  const [testResults, setTestResults] = useState<{ summary: TestSummary; results: TestResult[] } | null>(null);

  // Endpoint Explorer State
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('GET /api/health');
  const [requestMethod, setRequestMethod] = useState<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'>('GET');
  const [requestPath, setRequestPath] = useState<string>('/api/health');
  const [requestBody, setRequestBody] = useState<string>('');
  const [responseOutput, setResponseOutput] = useState<string>('Click "Execute Request" to test endpoint...');
  const [responseStatus, setResponseStatus] = useState<number | null>(null);
  const [responseHeaders, setResponseHeaders] = useState<Record<string, string>>({});
  const [responseDuration, setResponseDuration] = useState<number | null>(null);
  const [isLoadingRequest, setIsLoadingRequest] = useState(false);

  // Telemetry
  const [cacheStats, setCacheStats] = useState<any>(null);

  useEffect(() => {
    fetchHealth();
    fetchCacheStats();
  }, []);

  const fetchHealth = async () => {
    try {
      const res = await fetch('/api/health');
      const data = await res.json();
      setHealthStatus(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchCacheStats = async () => {
    try {
      const res = await fetch('/api/analytics/cache-stats');
      const data = await res.json();
      setCacheStats(data.cache);
    } catch (e) {
      console.error(e);
    }
  };

  const runAllTests = async () => {
    setIsRunningTests(true);
    try {
      const res = await fetch('/api/tests/run', { method: 'POST' });
      const data = await res.json();
      setTestResults(data);
      fetchCacheStats();
    } catch (e) {
      console.error(e);
    } finally {
      setIsRunningTests(false);
    }
  };

  const endpointsCatalog = [
    // Health & System
    { group: 'System & Health', method: 'GET', path: '/api/health', body: '' },
    // Authentication & Security
    { group: 'Auth & Sessions', method: 'POST', path: '/api/auth/register', body: JSON.stringify({ email: `farmer.${Date.now()}@farmersworld.co.ke`, phone: '+254712999888', fullName: 'Otieno Omolo', role: 'farmer', password: 'Password123!', location: { lat: -0.0917, lng: 34.768, county: 'Kisumu', town: 'Kisumu City' }, deviceFingerprint: 'device-fingerprint-xyz', deviceName: 'Oppo A57' }, null, 2) },
    { group: 'Auth & Sessions', method: 'POST', path: '/api/auth/login', body: JSON.stringify({ emailOrPhone: 'mwangi.farmer@farmersworld.co.ke', password: 'Password123!', deviceFingerprint: 'mwangi-samsung-galaxy-a34' }, null, 2) },
    { group: 'Auth & Sessions', method: 'GET', path: '/api/auth/me', body: '' },
    { group: 'Auth & Sessions', method: 'GET', path: '/api/auth/sessions', body: '' },
    { group: 'Auth & Sessions', method: 'POST', path: '/api/auth/payout-password/set', body: JSON.stringify({ accountPassword: 'Password123!', payoutPassword: '1234' }, null, 2) },
    { group: 'Auth & Sessions', method: 'POST', path: '/api/auth/payout-password/verify', body: JSON.stringify({ payoutPassword: '1234' }, null, 2) },
    { group: 'Auth & Sessions', method: 'POST', path: '/api/auth/logout', body: '' },
    // Categories
    { group: 'Categories', method: 'GET', path: '/api/categories', body: '' },
    { group: 'Categories', method: 'GET', path: '/api/categories/fresh-vegetables', body: '' },
    // Banners & Agronomic Bulletins
    { group: 'Banners & Bulletins', method: 'GET', path: '/api/banners?position=home_hero', body: '' },
    { group: 'Banners & Bulletins', method: 'GET', path: '/api/banners?county=Nairobi', body: '' },
    { group: 'Banners & Bulletins', method: 'POST', path: '/api/banners/ban_planting_season_01/click', body: '' },
    { group: 'Banners & Bulletins', method: 'POST', path: '/api/banners', body: JSON.stringify({ title: '🌽 Eldoret Grain Harvest Alert', subtitle: 'Dry white maize market is open with guaranteed off-take.', imageKey: 'banners/eldoret_maize_harvest.jpg', actionUrl: '/api/products?category=cereals-grains', position: 'home_hero', targetRole: 'buyer', targetCounty: 'Uasin Gishu', priority: 1 }, null, 2) },
    // Products & Haversine Geolocation
    { group: 'Products & Geo', method: 'GET', path: '/api/products', body: '' },
    { group: 'Products & Geo', method: 'GET', path: '/api/products/nearby?lat=-1.2635&lng=36.8024&sortBy=distance', body: '' },
    { group: 'Products & Geo', method: 'GET', path: '/api/products/ai-search?q=sukuma&county=Kiambu', body: '' },
    { group: 'Products & Geo', method: 'GET', path: '/api/products/prod_sukuma_kiambu_01', body: '' },
    { group: 'Products & Geo', method: 'PATCH', path: '/api/products/prod_sukuma_kiambu_01/stock', body: JSON.stringify({ stockQuantity: 350 }, null, 2) },
    // Cart
    { group: 'Cart', method: 'GET', path: '/api/cart', body: '' },
    { group: 'Cart', method: 'POST', path: '/api/cart/items', body: JSON.stringify({ productId: 'prod_sukuma_kiambu_01', quantity: 5 }, null, 2) },
    // Orders & Supply Chain Auto-Routing
    { group: 'Orders & Routing', method: 'GET', path: '/api/orders', body: '' },
    { group: 'Orders & Routing', method: 'POST', path: '/api/orders/direct', body: JSON.stringify({ items: [{ productId: 'prod_sukuma_kiambu_01', quantity: 2 }, { productId: 'prod_seeds_agrovet_05', quantity: 1 }], deliveryAddress: 'Nairobi Kilimani', buyerLocation: { lat: -1.2921, lng: 36.8219, county: 'Nairobi' }, buyerUrgencyNotes: '15 eggs in 15 mins / rapid delivery', paymentGateway: 'pawapay' }, null, 2) },
    { group: 'Live GPS & Tracking', method: 'GET', path: '/api/orders/ord_sample/tracking', body: '' },
    { group: 'Live GPS & Tracking', method: 'POST', path: '/api/orders/ord_sample/tracking/gps-ping', body: JSON.stringify({ lat: -1.2845, lng: 36.8190, speedKmh: 45, courierName: 'Mwangi Boda Transporter', courierPhone: '+254711998877', estimatedArrivalMinutes: 10 }, null, 2) },
    // On-the-fly Receipts & QR Code (Zero R2 Storage)
    { group: 'Receipts & QR Codes', method: 'GET', path: '/api/orders/ord_sample/receipt', body: '' },
    { group: 'Receipts & QR Codes', method: 'POST', path: '/api/orders/ord_sample/receipt/send-whatsapp', body: JSON.stringify({ recipientType: 'both' }, null, 2) },
    { group: 'Receipts & QR Codes', method: 'GET', path: '/api/orders/receipts/verify/RCP-2026-SAMPLE', body: '' },
    // Ratings & Reviews
    { group: 'Ratings & Reviews', method: 'POST', path: '/api/orders/sub-orders/sub_sample/rate', body: JSON.stringify({ rating: 5, comment: 'Excellent fresh greens, delivered within 25 minutes!', freshnessScore: 5, deliveryScore: 5, packagingScore: 5 }, null, 2) },
    { group: 'Ratings & Reviews', method: 'GET', path: '/api/orders/vendors/usr_farmer_kiambu_01/ratings', body: '' },
    // Wallet & Escrow
    { group: 'Wallet & Ledger', method: 'GET', path: '/api/wallet', body: '' },
    { group: 'Wallet & Ledger', method: 'GET', path: '/api/wallet/transactions', body: '' },
    { group: 'Wallet & Ledger', method: 'POST', path: '/api/wallet/withdraw', body: JSON.stringify({ amountKES: 1500, payoutPassword: '1234', recipientPhone: '+254711223344' }, null, 2) },
    // Payments, Webhooks & PawaPay
    { group: 'Payments & Webhooks', method: 'GET', path: '/api/payments/pawapay/pricing?correspondent=MPESA_KEN', body: '' },
    { group: 'Payments & Webhooks', method: 'POST', path: '/api/payments/pawapay/simulate-payment-success', body: JSON.stringify({ orderId: 'ord_sample' }, null, 2) },
    { group: 'Payments & Webhooks', method: 'POST', path: '/api/payments/paystack/simulate-payment-success', body: JSON.stringify({ orderId: 'ord_sample' }, null, 2) },
    { group: 'Payments & Webhooks', method: 'GET', path: '/api/payments/subscriptions/farmer/status', body: '' },
    { group: 'Payments & Webhooks', method: 'POST', path: '/api/payments/subscriptions/farmer/renew', body: '' },
    // Agrovets Strict Licensing
    { group: 'Agrovet Licensing', method: 'GET', path: '/api/agrovet/directory', body: '' },
    { group: 'Agrovet Licensing', method: 'GET', path: '/api/agrovet/licenses/pending', body: '' },
    // Regional Price Trends
    { group: 'Price Trends', method: 'GET', path: '/api/trends?county=Nairobi', body: '' },
    { group: 'Price Trends', method: 'GET', path: '/api/trends', body: '' },
    // Support & Tickets
    { group: 'Support & FAQs', method: 'GET', path: '/api/support/faqs', body: '' },
    { group: 'Support & Tickets', method: 'GET', path: '/api/support/tickets', body: '' },
    // Cloudflare R2
    { group: 'R2 Media Storage', method: 'POST', path: '/api/r2/presigned-upload-url', body: JSON.stringify({ folder: 'products', fileExtension: 'jpg', contentType: 'image/jpeg' }, null, 2) },
    // Cloudflare Analytics & Cache
    { group: 'Analytics & Edge Cache', method: 'GET', path: '/api/analytics/summary', body: '' },
    { group: 'Analytics & Edge Cache', method: 'GET', path: '/api/analytics/cache-stats', body: '' },
    { group: 'Analytics & Edge Cache', method: 'GET', path: '/api/analytics/audit-logs', body: '' },
    // Cron Schedulers
    { group: 'Cron Schedulers', method: 'POST', path: '/api/cron/payout-disbursements', body: '' },
    { group: 'Cron Schedulers', method: 'POST', path: '/api/cron/order-expiration-check', body: '' },
  ];

  const handleSelectEndpoint = (ep: any) => {
    setSelectedEndpoint(`${ep.method} ${ep.path}`);
    setRequestMethod(ep.method);
    setRequestPath(ep.path);
    setRequestBody(ep.body);
  };

  const handleExecuteRequest = async () => {
    setIsLoadingRequest(true);
    setResponseOutput('Sending request to Hono Workers backend...');
    const t0 = performance.now();

    try {
      const options: RequestInit = {
        method: requestMethod,
        headers: {
          'Content-Type': 'application/json',
        },
      };

      if (['POST', 'PUT', 'PATCH'].includes(requestMethod) && requestBody.trim()) {
        options.body = requestBody;
      }

      const res = await fetch(requestPath, options);
      const t1 = performance.now();
      setResponseDuration(Math.round(t1 - t0));
      setResponseStatus(res.status);

      // Collect headers
      const hdrs: Record<string, string> = {};
      res.headers.forEach((val, key) => {
        hdrs[key] = val;
      });
      setResponseHeaders(hdrs);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const json = await res.json();
        setResponseOutput(JSON.stringify(json, null, 2));
      } else {
        const text = await res.text();
        setResponseOutput(text);
      }

      fetchCacheStats();
    } catch (err) {
      setResponseStatus(0);
      setResponseOutput(`Network/Execution Error: ${(err as Error).message}`);
    } finally {
      setIsLoadingRequest(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Header */}
      <header className="border-b border-slate-800 bg-slate-900/80 backdrop-blur sticky top-0 z-50 px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <div className="h-9 w-9 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-white shadow-lg shadow-emerald-900/50">
            FW
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h1 className="text-base font-bold tracking-tight text-white">FarmersWorld Backend</h1>
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-emerald-950 text-emerald-400 border border-emerald-800 px-2 py-0.5 rounded">
                Cloudflare Workers + Hono + MongoDB
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Kenyan Agricultural Marketplace • Haversine Geolocation • Escrow & Dual-Password Wallets • PawaPay
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Cache Telemetry Indicator */}
          {cacheStats && (
            <div className="hidden md:flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
              <Zap className={`h-3.5 w-3.5 ${cacheStats.hitRatePercentage >= 70 ? 'text-emerald-400' : 'text-amber-400'}`} />
              <span className="text-slate-400">CF Cache Hit:</span>
              <span className="font-mono font-semibold text-white">{cacheStats.hitRatePercentage}%</span>
              <span className="text-slate-500 text-[10px]">(Goal: 70%)</span>
            </div>
          )}

          {/* Quick Health Tag */}
          <div className="flex items-center space-x-2 bg-slate-800/80 border border-slate-700 px-3 py-1.5 rounded-lg text-xs">
            <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-slate-300 font-mono">Port 3000 : Ready</span>
          </div>

          <button
            onClick={runAllTests}
            disabled={isRunningTests}
            className="flex items-center space-x-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-medium px-3.5 py-1.5 rounded-lg transition shadow disabled:opacity-50"
          >
            <Play className={`h-3.5 w-3.5 ${isRunningTests ? 'animate-spin' : ''}`} />
            <span>{isRunningTests ? 'Running Suites...' : 'Run Test Suite'}</span>
          </button>
        </div>
      </header>

      {/* Navigation Tabs */}
      <nav className="border-b border-slate-800 bg-slate-900/50 px-6 flex space-x-6 text-sm font-medium">
        <button
          onClick={() => setActiveTab('docs')}
          className={`py-3 flex items-center space-x-2 border-b-2 transition ${
            activeTab === 'docs'
              ? 'border-emerald-500 text-emerald-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <BookOpen className="h-4 w-4" />
          <span>Architecture & System Spec</span>
        </button>

        <button
          onClick={() => setActiveTab('explorer')}
          className={`py-3 flex items-center space-x-2 border-b-2 transition ${
            activeTab === 'explorer'
              ? 'border-emerald-500 text-emerald-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="h-4 w-4" />
          <span>API Explorer ({endpointsCatalog.length} Endpoints)</span>
        </button>

        <button
          onClick={() => setActiveTab('tests')}
          className={`py-3 flex items-center space-x-2 border-b-2 transition ${
            activeTab === 'tests'
              ? 'border-emerald-500 text-emerald-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
          <span>Automated Verification Suites</span>
          {testResults && (
            <span className="ml-1.5 text-[10px] bg-slate-800 border border-slate-700 px-1.5 py-0.2 rounded text-emerald-300">
              {testResults.summary.passed}/{testResults.summary.total}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('database')}
          className={`py-3 flex items-center space-x-2 border-b-2 transition ${
            activeTab === 'database'
              ? 'border-emerald-500 text-emerald-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Database className="h-4 w-4" />
          <span>Database Collections & Schemas</span>
        </button>

        <button
          onClick={() => setActiveTab('analytics')}
          className={`py-3 flex items-center space-x-2 border-b-2 transition ${
            activeTab === 'analytics'
              ? 'border-emerald-500 text-emerald-400 font-semibold'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Activity className="h-4 w-4" />
          <span>Edge Cache & Telemetry</span>
        </button>
      </nav>

      {/* Main Content Area */}
      <main className="flex-1 p-6 overflow-auto">
        {/* TAB 1: ARCHITECTURE & SYSTEM SPEC */}
        {activeTab === 'docs' && (
          <div className="max-w-6xl mx-auto space-y-6">
            {/* Hero Summary Card */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-900/60 border border-slate-800 rounded-xl p-6 shadow-xl">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-xl font-bold text-white mb-2">
                    FarmersWorld Kenya: Scalable Agricultural Backend
                  </h2>
                  <p className="text-slate-300 text-sm leading-relaxed max-w-4xl">
                    High-throughput, low-latency marketplace architecture engineered with <strong>Hono</strong>,{' '}
                    <strong>Cloudflare Workers Edge</strong>, <strong>TypeScript</strong>, and <strong>MongoDB</strong>.
                    Designed specifically for Kenyan producers, agrovets, and buyers with strict financial safeguards,
                    fraud protection, and supply chain automation.
                  </p>
                </div>
                <div className="bg-emerald-950 border border-emerald-800/80 rounded-lg p-3 text-right">
                  <div className="text-2xl font-mono font-bold text-emerald-400">50+</div>
                  <div className="text-xs text-emerald-300">Active Endpoints</div>
                </div>
              </div>

              {/* Core Pillars Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mt-6">
                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-lg">
                  <div className="flex items-center space-x-2 text-emerald-400 text-sm font-semibold mb-2">
                    <MapPin className="h-4 w-4" />
                    <span>Haversine Geolocation</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Precise great-circle spherical calculations preventing cost-ineffective transport (e.g. 20 KES sukuma wiki from 50km). Tiered delivery fees and proximity-first sorting.
                  </p>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-lg">
                  <div className="flex items-center space-x-2 text-blue-400 text-sm font-semibold mb-2">
                    <Shield className="h-4 w-4" />
                    <span>Dual Passwords & OTP</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Separate account login password and secondary Payout Password. Requires payout password + SMS/WhatsApp OTP before any M-Pesa withdrawal is approved.
                  </p>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-lg">
                  <div className="flex items-center space-x-2 text-amber-400 text-sm font-semibold mb-2">
                    <Layers className="h-4 w-4" />
                    <span>Multi-Vendor Splitting</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Single checkout involving 2+ farmers/agrovets automatically divides into sub-orders with separate delivery timelines and independent 6-digit PIN delivery acknowledgements.
                  </p>
                </div>

                <div className="bg-slate-950/60 border border-slate-800 p-4 rounded-lg">
                  <div className="flex items-center space-x-2 text-purple-400 text-sm font-semibold mb-2">
                    <RefreshCw className="h-4 w-4" />
                    <span>Auto-Rerouting Engine</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">
                    Dynamic category timeouts (30 mins for perishable vegetables, 2h for poultry, 24h for seeds). If unaccepted or declined, automatically reroutes to the next closest seller.
                  </p>
                </div>
              </div>
            </div>

            {/* Architectural Modules Breakdown */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Financial Architecture */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center space-x-2 text-white font-bold text-sm border-b border-slate-800 pb-3">
                  <DollarSign className="h-4 w-4 text-emerald-400" />
                  <span>Financial Integrity & Wallet Ledger</span>
                </div>
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Strict Overdraw Prevention:</strong> Database invariants ensure users can never withdraw more than their available balance. Requests exceeding balance are hard-rejected.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Escrow Locking:</strong> Buyer payments are locked in seller's escrow until buyer confirms receipt with their 6-digit delivery PIN, unlocking net funds minus platform commission.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Automatic Payout Rollback:</strong> If PawaPay or M-Pesa gateway rejects disbursement, funds are immediately restored to the user's available wallet balance with full audit trails.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Dynamic PawaPay Pricing:</strong> Real-time payout pricing tier inspection endpoint prevents platform loss by charging exact network fees dynamically.
                    </div>
                  </div>
                </div>
              </div>

              {/* Security & Authentication */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center space-x-2 text-white font-bold text-sm border-b border-slate-800 pb-3">
                  <Shield className="h-4 w-4 text-blue-400" />
                  <span>Session Security & Single-Device Gate</span>
                </div>
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 mt-1.5" />
                    <div>
                      <strong className="text-white">100% Cookie-Based JWT:</strong> Access token (2-hour) and Refresh token (1-year: 365 days) are issued exclusively as <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded">HttpOnly</code>, <code className="bg-slate-800 text-blue-300 px-1 py-0.5 rounded">SameSite=Lax</code> cookies. Zero tokens exposed to frontend JS.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Single Active Device Policy:</strong> For financial safety, multi-device logins are restricted. Logging in from a new device revokes previous sessions unless explicitly re-authorized.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Lost Device Remote Revocation:</strong> Users and administrators can list all registered device sessions and remotely revoke lost or stolen handsets instantly.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-blue-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Bcryptjs Password Hashing:</strong> Salting and slow hashing on both primary and secondary payout passwords.
                    </div>
                  </div>
                </div>
              </div>

              {/* Cloudflare Edge Stack */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center space-x-2 text-white font-bold text-sm border-b border-slate-800 pb-3">
                  <Zap className="h-4 w-4 text-amber-400" />
                  <span>Cloudflare Workers, R2 & Cache API</span>
                </div>
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5" />
                    <div>
                      <strong className="text-white">R2 Storage Presigned PUT URLs:</strong> Uploads return a key and signed upload URL. Database strictly persists the <code className="bg-slate-800 text-amber-300 px-1 py-0.5 rounded">key</code>, preserving immutability and bucket privacy.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Cloudflare Cache API (&gt;70% Hit Rate):</strong> Public commodity prices, category taxonomies, and catalog listings leverage edge caching with smart tag invalidation upon inventory updates.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-amber-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Cloudflare Analytics Engine:</strong> Structured blobs and doubles emission tracking searches, regional order volumes, and fulfillment latencies.
                    </div>
                  </div>
                </div>
              </div>

              {/* Subscriptions & Communications */}
              <div className="bg-slate-900/60 border border-slate-800 rounded-xl p-5 space-y-4">
                <div className="flex items-center space-x-2 text-white font-bold text-sm border-b border-slate-800 pb-3">
                  <Send className="h-4 w-4 text-emerald-400" />
                  <span>Farmer Subscriptions & Multi-Role Comms</span>
                </div>
                <div className="space-y-2.5 text-xs text-slate-300">
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Farmer 2-Month Free Trial:</strong> Newly registered farmers get 60 days free before the affordable KSH 20 / month subscription kicks in.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Agrovet Licensing Verification:</strong> Agrovets require verification from Kenya Veterinary Board, KePHIS, or PCPB before distributing certified seeds and fertilizers.
                    </div>
                  </div>
                  <div className="flex items-start space-x-2">
                    <div className="h-1.5 w-1.5 rounded-full bg-emerald-400 mt-1.5" />
                    <div>
                      <strong className="text-white">Infobip WhatsApp & ZeptoMail:</strong> Automated multi-role alerts to Buyer (order ACK code), Farmer (new order acceptance countdown), and Agrovet.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: INTERACTIVE API EXPLORER */}
        {activeTab === 'explorer' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 h-[calc(100vh-140px)]">
            {/* Left Column: Endpoint Directory */}
            <div className="lg:col-span-4 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
              <div className="p-3.5 border-b border-slate-800 bg-slate-900/90 flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  <FileCode className="h-4 w-4 text-emerald-400" />
                  <span className="text-xs font-bold text-white uppercase tracking-wider">Endpoints ({endpointsCatalog.length})</span>
                </div>
                <span className="text-[10px] text-slate-400 font-mono">Hono / Cloudflare</span>
              </div>

              <div className="flex-1 overflow-y-auto divide-y divide-slate-800/60 p-2 space-y-1">
                {endpointsCatalog.map((ep, idx) => {
                  const isSelected = selectedEndpoint === `${ep.method} ${ep.path}`;
                  const methodColors: Record<string, string> = {
                    GET: 'text-blue-400 bg-blue-950/60 border-blue-800',
                    POST: 'text-emerald-400 bg-emerald-950/60 border-emerald-800',
                    PUT: 'text-amber-400 bg-amber-950/60 border-amber-800',
                    PATCH: 'text-purple-400 bg-purple-950/60 border-purple-800',
                    DELETE: 'text-rose-400 bg-rose-950/60 border-rose-800',
                  };

                  return (
                    <button
                      key={idx}
                      onClick={() => handleSelectEndpoint(ep)}
                      className={`w-full text-left p-2.5 rounded-lg flex items-center justify-between text-xs transition ${
                        isSelected
                          ? 'bg-slate-800 border border-slate-700 shadow-sm'
                          : 'hover:bg-slate-800/50'
                      }`}
                    >
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded border ${methodColors[ep.method]}`}>
                          {ep.method}
                        </span>
                        <span className="font-mono text-slate-200 truncate">{ep.path}</span>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0 ml-1" />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Request & Response Console */}
            <div className="lg:col-span-8 flex flex-col space-y-4">
              {/* Request Builder */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center space-x-2">
                  <select
                    value={requestMethod}
                    onChange={(e) => setRequestMethod(e.target.value as any)}
                    className="bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono font-bold text-white px-3 py-2 outline-none focus:border-emerald-500"
                  >
                    <option value="GET">GET</option>
                    <option value="POST">POST</option>
                    <option value="PUT">PUT</option>
                    <option value="PATCH">PATCH</option>
                    <option value="DELETE">DELETE</option>
                  </select>

                  <input
                    type="text"
                    value={requestPath}
                    onChange={(e) => setRequestPath(e.target.value)}
                    className="flex-1 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-slate-200 px-3 py-2 outline-none focus:border-emerald-500"
                    placeholder="/api/..."
                  />

                  <button
                    onClick={handleExecuteRequest}
                    disabled={isLoadingRequest}
                    className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold px-4 py-2 rounded-lg flex items-center space-x-1.5 shadow transition disabled:opacity-50"
                  >
                    <Play className={`h-3.5 w-3.5 ${isLoadingRequest ? 'animate-spin' : ''}`} />
                    <span>{isLoadingRequest ? 'Sending...' : 'Execute Request'}</span>
                  </button>
                </div>

                {/* Request Body Editor (for POST/PUT/PATCH) */}
                {['POST', 'PUT', 'PATCH'].includes(requestMethod) && (
                  <div>
                    <label className="text-[11px] font-semibold text-slate-400 block mb-1">JSON Request Body (Zod Validated):</label>
                    <textarea
                      value={requestBody}
                      onChange={(e) => setRequestBody(e.target.value)}
                      rows={5}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-xs font-mono text-emerald-300 outline-none focus:border-slate-700"
                      placeholder="{}"
                    />
                  </div>
                )}
              </div>

              {/* Response Inspector */}
              <div className="flex-1 bg-slate-900 border border-slate-800 rounded-xl flex flex-col overflow-hidden">
                <div className="p-3 border-b border-slate-800 bg-slate-950/60 flex items-center justify-between text-xs">
                  <div className="flex items-center space-x-3">
                    <span className="font-semibold text-slate-300">Response Inspector</span>
                    {responseStatus !== null && (
                      <span
                        className={`font-mono text-[11px] px-2 py-0.5 rounded font-bold ${
                          responseStatus >= 200 && responseStatus < 300
                            ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                            : 'bg-rose-950 text-rose-400 border border-rose-800'
                        }`}
                      >
                        Status: {responseStatus}
                      </span>
                    )}
                    {responseDuration !== null && (
                      <span className="text-slate-400 font-mono text-[11px]">Latency: {responseDuration}ms</span>
                    )}
                  </div>

                  {responseHeaders['cf-cache-status'] && (
                    <span className="font-mono text-[10px] bg-slate-800 text-amber-300 px-2 py-0.5 rounded border border-slate-700">
                      CF-Cache: {responseHeaders['cf-cache-status']}
                    </span>
                  )}
                </div>

                <div className="flex-1 p-4 bg-slate-950 overflow-auto">
                  <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">
                    {responseOutput}
                  </pre>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: AUTOMATED TEST SUITES */}
        {activeTab === 'tests' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-xl p-5">
              <div>
                <h3 className="text-base font-bold text-white mb-1">Production Verification & Test Harness</h3>
                <p className="text-xs text-slate-400">
                  Runs unit and integration suites validating anti-overbuy guards, dual-passwords, auto-routing, and Haversine distance.
                </p>
              </div>
              <button
                onClick={runAllTests}
                disabled={isRunningTests}
                className="bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold px-4 py-2 rounded-lg flex items-center space-x-2 transition disabled:opacity-50"
              >
                <Play className={`h-4 w-4 ${isRunningTests ? 'animate-spin' : ''}`} />
                <span>{isRunningTests ? 'Executing Suites...' : 'Run All 14 Test Suites'}</span>
              </button>
            </div>

            {testResults ? (
              <div className="space-y-4">
                {/* Summary Scorecard */}
                <div className="grid grid-cols-4 gap-4">
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <div className="text-xs text-slate-400">Total Suites Executed</div>
                    <div className="text-2xl font-bold font-mono text-white mt-1">{testResults.summary.total}</div>
                  </div>
                  <div className="bg-emerald-950/40 border border-emerald-900/60 p-4 rounded-xl">
                    <div className="text-xs text-emerald-400 font-semibold">Passed Checks</div>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{testResults.summary.passed}</div>
                  </div>
                  <div className="bg-rose-950/40 border border-rose-900/60 p-4 rounded-xl">
                    <div className="text-xs text-rose-400 font-semibold">Failed Checks</div>
                    <div className="text-2xl font-bold font-mono text-rose-400 mt-1">{testResults.summary.failed}</div>
                  </div>
                  <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
                    <div className="text-xs text-slate-400">Execution Time</div>
                    <div className="text-2xl font-bold font-mono text-slate-200 mt-1">{testResults.summary.durationMs}ms</div>
                  </div>
                </div>

                {/* Individual Test Items */}
                <div className="bg-slate-900 border border-slate-800 rounded-xl divide-y divide-slate-800 overflow-hidden">
                  {testResults.results.map((t, idx) => (
                    <div key={idx} className="p-4 flex items-center justify-between text-xs hover:bg-slate-800/40 transition">
                      <div className="flex items-center space-x-3">
                        {t.status === 'passed' ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                        ) : (
                          <XCircle className="h-4 w-4 text-rose-400 shrink-0" />
                        )}
                        <div>
                          <div className="font-semibold text-slate-200">{t.name}</div>
                          <div className="text-[11px] text-slate-400">{t.category}</div>
                          {t.error && <div className="text-rose-400 text-[11px] mt-1 font-mono">{t.error}</div>}
                        </div>
                      </div>
                      <div className="font-mono text-slate-500 text-[11px]">{t.durationMs}ms</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-center py-16 bg-slate-900/40 border border-dashed border-slate-800 rounded-xl">
                <CheckCircle2 className="h-10 w-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">Click "Run All 14 Test Suites" above to execute all validation suites.</p>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: DATABASE & MODELS */}
        {activeTab === 'database' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-white mb-1">MongoDB Collections & Schema Registry</h3>
                <p className="text-xs text-slate-400">
                  Native MongoDB Driver with high-performance transactional repository and automatic Atlas connectivity.
                </p>
              </div>
              <span className="text-xs font-mono bg-emerald-950 border border-emerald-800 text-emerald-400 px-3 py-1 rounded">
                Database: farmersworld
              </span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { name: 'users', count: '5 Seeded Users', desc: 'Buyers, farmers (w/ 2-mo trials), certified agrovets, admins, device sessions' },
                { name: 'products', count: '6 Farm Inputs & Commodities', desc: 'Perishables, KePHIS seeds, DAP fertilizers, stocks, dynamic acceptance limits' },
                { name: 'categories', count: '8 Regulated Categories', desc: 'Vegetables (30m), poultry (2h), agrovet certified inputs (24h), commission rates' },
                { name: 'orders', count: 'Orders & Sub-Orders', desc: 'Multi-vendor splitting, escrow holds, 6-digit delivery acknowledgement PINs' },
                { name: 'wallets', count: 'Wallets & Escrow Balances', desc: 'Separated available balance vs locked escrow, double-spend prevention' },
                { name: 'transactions', count: 'Immutable Ledger Entries', desc: 'Escrow holds, releases, withdrawals, commission deductions, balance snapshots' },
                { name: 'agrovetLicenses', count: 'Regulatory Licenses', desc: 'Kenya Veterinary Board, KePHIS, premise addresses, verified by admin' },
                { name: 'priceTrends', count: 'Market Price Hubs', desc: 'Marikiti, Wangige, Kibuye, Eldoret, wholesale/retail tracking' },
                { name: 'supportTickets', count: 'Asynchronous Helpdesk', desc: 'Multi-role ticket message threads, priorities, resolution audit logs' },
              ].map((col, idx) => (
                <div key={idx} className="bg-slate-900/60 border border-slate-800 p-4 rounded-xl">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono text-sm font-bold text-emerald-400">{col.name}</span>
                    <span className="text-[10px] text-slate-400 font-mono bg-slate-800 px-2 py-0.5 rounded">{col.count}</span>
                  </div>
                  <p className="text-xs text-slate-400 leading-relaxed">{col.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 5: ANALYTICS & EDGE CACHE */}
        {activeTab === 'analytics' && (
          <div className="max-w-5xl mx-auto space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <div className="text-xs text-slate-400 mb-1">Cloudflare Cache Hit Ratio</div>
                <div className="text-3xl font-bold font-mono text-emerald-400">
                  {cacheStats ? `${cacheStats.hitRatePercentage}%` : 'N/A'}
                </div>
                <div className="text-[11px] text-slate-500 mt-2">
                  Target: &gt;70% • Active cache entries: {cacheStats?.activeEntries || 0}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <div className="text-xs text-slate-400 mb-1">Total Edge Cache Requests</div>
                <div className="text-3xl font-bold font-mono text-white">
                  {cacheStats?.totalRequests || 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-2">
                  Hits: {cacheStats?.hits || 0} • Misses: {cacheStats?.misses || 0}
                </div>
              </div>

              <div className="bg-slate-900 border border-slate-800 p-5 rounded-xl">
                <div className="text-xs text-slate-400 mb-1">Analytics Dataset</div>
                <div className="text-lg font-bold font-mono text-blue-400 mt-1">marketplace_events</div>
                <div className="text-[11px] text-slate-500 mt-2">
                  Cloudflare Analytics Engine blobs & doubles
                </div>
              </div>
            </div>

            <div className="bg-slate-900 border border-slate-800 rounded-xl p-5">
              <h4 className="text-sm font-bold text-white mb-3">Edge Cache Optimization Strategy</h4>
              <ul className="space-y-2 text-xs text-slate-300">
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Public commodity catalogs (<code className="text-emerald-300 font-mono">/api/products</code>) cached for 60s at Cloudflare edge.</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Regional market price trends (<code className="text-emerald-300 font-mono">/api/trends</code>) cached for 180s.</span>
                </li>
                <li className="flex items-center space-x-2">
                  <div className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                  <span>Category taxonomies (<code className="text-emerald-300 font-mono">/api/categories</code>) cached for 300s with instant tag invalidation on edit.</span>
                </li>
              </ul>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
