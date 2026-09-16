import { REDACTED } from '@bugcapsule/format'
import type {
  ActionsFile,
  CapsuleArchive,
  ConsoleEntry,
  Environment,
  NetworkRequest,
  Privacy,
  StateFile,
} from '@bugcapsule/format'

/**
 * Fixture capsule — sample data for developing the diff engine and viewer
 * without a Chrome Extension.
 *
 * The `checkout-working` / `checkout-broken` pair tells exactly one story:
 *
 * - the checkout flow that works: `POST /api/checkout` returns 201 with
 *   `{ orderId, total, etaDays }`
 * - the same flow broken: returns 500 with `{ error, traceId }`, console has an
 *   error, an extra retry request appears only on the broken side, and the
 *   feature flag `feature_new_checkout` has been enabled
 *
 * The important point: **bodies are not captured on either side**
 * (`requestBodies` and `responseBodies` are both `false`). All schema signal
 * comes from `bodyShape`. That means the diff engine works with default
 * privacy, with no opt-in.
 */

const CREATED_AT = '2026-09-16T09:00:00Z'
const BROKEN_CREATED_AT = '2026-09-16T09:12:00Z'
const CAPTURE_STARTED_AT = '2026-09-16T08:59:30Z'
const CAPTURE_ENDED_AT = '2026-09-16T09:00:00Z'

const SOURCE = { name: 'bugcapsule-fixtures', version: '0.1.0' } as const

const environment: Environment = {
  browser: { name: 'Chrome', version: '128.0.6613.120' },
  os: { name: 'Windows', version: '11' },
  viewport: { width: 1440, height: 900, devicePixelRatio: 1 },
  locale: 'en-US',
  timezone: 'Asia/Ho_Chi_Minh',
  network: { online: true },
  document: { visibilityState: 'visible' },
  build: 'web-2026.09.16-a',
}

/**
 * Shape is captured, value is not. `storageValues: true` is deliberate: this
 * fixture also illustrates the signal that needs values (feature flag), so the
 * diff engine has data for both modes.
 */
const privacy: Privacy = {
  policy: {
    queryValues: true,
    requestBodies: false,
    responseBodies: false,
    bodyShapes: true,
    storageValues: true,
    consoleVerbose: false,
  },
  redaction: {
    applied: true,
    byRule: [
      { rule: 'auth-header', count: 2 },
      { rule: 'secret-query', count: 1 },
    ],
    removedFields: {
      headers: ['authorization', 'cookie'],
      queryKeys: ['token'],
      bodyPaths: [],
      storageKeys: [],
    },
  },
}

function productsRequest(): NetworkRequest {
  return {
    id: 'req_01',
    docId: 'doc_1',
    frameId: 0,
    offsetMs: 120,
    seq: 1,
    method: 'GET',
    url: {
      origin: 'https://api.shop.example.com',
      pathname: '/api/products',
      query: { page: '1', sort: 'price' },
    },
    resourceType: 'fetch',
    status: 200,
    durationMs: 84,
    request: { bodyCaptured: false, omissionReason: 'disabled' },
    response: {
      contentType: 'application/json',
      bodyCaptured: false,
      omissionReason: 'disabled',
      bodyShape: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            price: { type: 'number' },
            title: { type: 'string' },
          },
        },
      },
    },
  }
}

function cartRequest(): NetworkRequest {
  return {
    id: 'req_02',
    docId: 'doc_1',
    frameId: 0,
    offsetMs: 1450,
    seq: 2,
    method: 'GET',
    url: { origin: 'https://api.shop.example.com', pathname: '/api/cart', query: {} },
    resourceType: 'fetch',
    status: 200,
    durationMs: 62,
    request: { bodyCaptured: false, omissionReason: 'disabled' },
    response: {
      contentType: 'application/json',
      bodyCaptured: false,
      omissionReason: 'disabled',
      bodyShape: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: {
              type: 'object',
              properties: { sku: { type: 'string' }, quantity: { type: 'number' } },
            },
          },
          total: { type: 'number' },
        },
      },
    },
  }
}

function cartLoadedLog(): ConsoleEntry {
  return {
    id: 'log_01',
    docId: 'doc_1',
    frameId: 0,
    offsetMs: 1480,
    seq: 3,
    level: 'info',
    message: 'cart loaded: 1 item',
    source: 'page',
  }
}

function checkoutClick(): ActionsFile {
  return {
    events: [
      {
        id: 'act_01',
        docId: 'doc_1',
        frameId: 0,
        offsetMs: 4200,
        seq: 4,
        type: 'click',
        target: {
          tag: 'button',
          selector: '[data-testid="checkout-button"]',
          strategy: 'testid',
          role: 'button',
        },
        metadata: { valueCaptured: false },
      },
    ],
  }
}

function stateWith(flagValue: boolean): StateFile {
  return {
    localStorage: [
      {
        key: 'feature_new_checkout',
        valueCaptured: true,
        value: flagValue,
        valueType: 'boolean',
      },
      { key: 'cart_id', valueCaptured: true, value: 'crt_8842', valueType: 'string' },
    ],
    sessionStorage: [],
    cookieNames: ['session', 'csrf'],
  }
}

const checkoutRequest: NetworkRequest = {
  id: 'req_03',
  docId: 'doc_1',
  frameId: 0,
  offsetMs: 5102,
  seq: 5,
  method: 'POST',
  url: {
    origin: 'https://api.shop.example.com',
    pathname: '/api/checkout',
    query: { token: REDACTED },
  },
  resourceType: 'fetch',
  status: 201,
  durationMs: 321,
  request: {
    contentType: 'application/json',
    bodyCaptured: false,
    omissionReason: 'disabled',
    bodyShape: {
      type: 'object',
      properties: { cartId: { type: 'string' }, paymentMethod: { type: 'string' } },
    },
  },
  response: {
    contentType: 'application/json',
    bodyCaptured: false,
    omissionReason: 'disabled',
    bodyShape: {
      type: 'object',
      properties: {
        orderId: { type: 'string' },
        total: { type: 'number' },
        etaDays: { type: 'number' },
      },
    },
  },
}

/** Smallest capsule that is still valid — spec §29. Can be written by hand, no tool needed. */
export function buildMinimalCapsule(): CapsuleArchive {
  return {
    manifest: {
      format: 'bugcapsule',
      formatVersion: '0.1.0',
      id: 'fixture-minimal',
      createdAt: CREATED_AT,
      source: SOURCE,
      capture: {
        startedAt: CAPTURE_STARTED_AT,
        endedAt: CAPTURE_ENDED_AT,
        durationMs: 30000,
      },
    },
  }
}

export function buildCheckoutWorking(): CapsuleArchive {
  return {
    manifest: {
      format: 'bugcapsule',
      formatVersion: '0.1.0',
      id: 'fixture-checkout-working',
      createdAt: CREATED_AT,
      source: SOURCE,
      role: 'working',
      page: {
        origin: 'https://shop.example.com',
        pathname: '/checkout',
        query: { step: 'payment' },
      },
      capture: {
        startedAt: CAPTURE_STARTED_AT,
        endedAt: CAPTURE_ENDED_AT,
        durationMs: 30000,
      },
      captureGaps: ['workers-not-captured'],
    },
    environment,
    actions: checkoutClick(),
    network: { requests: [productsRequest(), cartRequest(), { ...checkoutRequest }] },
    console: { entries: [cartLoadedLog()] },
    state: stateWith(false),
    privacy,
  }
}

export function buildCheckoutBroken(): CapsuleArchive {
  return {
    manifest: {
      format: 'bugcapsule',
      formatVersion: '0.1.0',
      id: 'fixture-checkout-broken',
      createdAt: BROKEN_CREATED_AT,
      source: SOURCE,
      role: 'broken',
      page: {
        origin: 'https://shop.example.com',
        pathname: '/checkout',
        query: { step: 'payment' },
      },
      capture: {
        startedAt: '2026-09-16T09:11:30Z',
        endedAt: BROKEN_CREATED_AT,
        durationMs: 30000,
      },
      captureGaps: ['workers-not-captured'],
    },
    environment,
    actions: {
      events: [
        ...checkoutClick().events,
        {
          id: 'act_02',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 5320,
          seq: 8,
          type: 'click',
          target: {
            tag: 'button',
            selector: '[data-testid="retry-button"]',
            strategy: 'testid',
            role: 'button',
          },
          metadata: { valueCaptured: false },
        },
      ],
    },
    network: {
      requests: [
        productsRequest(),
        cartRequest(),
        {
          ...checkoutRequest,
          status: 500,
          durationMs: 1840,
          response: {
            contentType: 'application/json',
            bodyCaptured: false,
            omissionReason: 'disabled',
            bodyShape: {
              type: 'object',
              properties: {
                error: { type: 'string' },
                traceId: { type: 'string' },
              },
            },
          },
        },
        {
          id: 'req_04',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 5410,
          seq: 9,
          method: 'POST',
          url: {
            origin: 'https://api.shop.example.com',
            pathname: '/api/checkout',
            query: { token: REDACTED, retry: '1' },
          },
          resourceType: 'fetch',
          status: 500,
          durationMs: 912,
          request: { bodyCaptured: false, omissionReason: 'disabled' },
          response: {
            contentType: 'application/json',
            bodyCaptured: false,
            omissionReason: 'disabled',
            bodyShape: {
              type: 'object',
              properties: { error: { type: 'string' }, traceId: { type: 'string' } },
            },
          },
        },
      ],
    },
    console: {
      entries: [
        cartLoadedLog(),
        {
          id: 'log_02',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 5140,
          seq: 6,
          level: 'error',
          message: 'Checkout failed: 500 Internal Server Error',
          stack:
            'Error: Checkout failed\n    at submitOrder (https://shop.example.com/assets/checkout-8f2a1c.js:1:24811)',
          source: 'page',
        },
        {
          id: 'log_03',
          docId: 'doc_1',
          frameId: 0,
          offsetMs: 5200,
          seq: 7,
          level: 'warn',
          message: 'retrying checkout once',
          source: 'page',
        },
      ],
    },
    state: stateWith(true),
    privacy,
  }
}

export interface Fixture {
  name: string
  archive: CapsuleArchive
}

export const FIXTURES: readonly Fixture[] = [
  { name: 'minimal', archive: buildMinimalCapsule() },
  { name: 'checkout-working', archive: buildCheckoutWorking() },
  { name: 'checkout-broken', archive: buildCheckoutBroken() },
]
