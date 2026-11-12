import { createHash } from 'node:crypto';
import { HttpError } from '../http/errors.js';

export const SKU_MOQ = 10;
export const MAX_ORDER_QUANTITY = 1_000_000;
/** 9,000,000,000,000 cents = USD 90 billion; well inside Number.MAX_SAFE_INTEGER. */
export const MAX_ORDER_TOTAL_CENTS = 9_000_000_000_000;
export const MAX_SHIPPING_REQUIREMENTS = 1000;
export const MAX_PRICE_CENTS = 100_000_000;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Reject malformed identifiers as a 400 instead of letting PostgreSQL 22P02 become a 500. */
export function requireUuid(value: unknown, field: string): string {
  if (!isUuid(value)) {
    throw new HttpError(400, 'invalid_request', `${field} must be a UUID.`);
  }
  return value;
}

export const REFERENCE_PRICE_NOTE =
  'Reference quote based on the current base wholesale price. Customer-tier and promotion pricing, confirmation and stock reservation are handled by sales in Phase 4B-05.';
export const PRICING_MODE = 'base_reference' as const;
export const PRICING_VERSION = '4b04-base-price-v1';

export const SHIPPING_METHODS = [
  'Express',
  'Air',
  'Sea',
  'Customer Pickup',
  'Other',
] as const;

/** New Phase 4B-05 format. Historical ODYYMMDDNNNN rows remain valid. */
export const ORDER_NUMBER_PATTERN = /^OD-[0-9]{6}-[0-9]{4}$/;
export const LEGACY_ORDER_NUMBER_PATTERN = /^OD[0-9]{10}$/;
export const ANY_ORDER_NUMBER_PATTERN = /^(OD[0-9]{10}|OD-[0-9]{6}-[0-9]{4})$/;

/** Owner-confirmed 3 + 10 day rule, implemented as continuous hours. */
export const INITIAL_RESERVATION_HOURS = 72;
export const MAX_TOTAL_EXTENSION_HOURS = 240;
export const HARD_RESERVATION_HOURS = INITIAL_RESERVATION_HOURS + MAX_TOTAL_EXTENSION_HOURS;


export type ShippingMethod = (typeof SHIPPING_METHODS)[number];

/**
 * ISO 3166-1 alpha-3 codes. The API rejects syntactic look-alikes that are not
 * assigned country codes instead of accepting any three uppercase letters.
 */
export const ISO_ALPHA3_CODES: ReadonlySet<string> = new Set([
  'ABW', 'AFG', 'AGO', 'AIA', 'ALA', 'ALB', 'AND', 'ARE', 'ARG', 'ARM', 'ASM', 'ATA', 'ATF',
  'ATG', 'AUS', 'AUT', 'AZE', 'BDI', 'BEL', 'BEN', 'BES', 'BFA', 'BGD', 'BGR', 'BHR', 'BHS',
  'BIH', 'BLM', 'BLR', 'BLZ', 'BMU', 'BOL', 'BRA', 'BRB', 'BRN', 'BTN', 'BVT', 'BWA', 'CAF',
  'CAN', 'CCK', 'CHE', 'CHL', 'CHN', 'CIV', 'CMR', 'COD', 'COG', 'COK', 'COL', 'COM', 'CPV',
  'CRI', 'CUB', 'CUW', 'CXR', 'CYM', 'CYP', 'CZE', 'DEU', 'DJI', 'DMA', 'DNK', 'DOM', 'DZA',
  'ECU', 'EGY', 'ERI', 'ESH', 'ESP', 'EST', 'ETH', 'FIN', 'FJI', 'FLK', 'FRA', 'FRO', 'FSM',
  'GAB', 'GBR', 'GEO', 'GGY', 'GHA', 'GIB', 'GIN', 'GLP', 'GMB', 'GNB', 'GNQ', 'GRC', 'GRD',
  'GRL', 'GTM', 'GUF', 'GUM', 'GUY', 'HKG', 'HMD', 'HND', 'HRV', 'HTI', 'HUN', 'IDN', 'IMN',
  'IND', 'IOT', 'IRL', 'IRN', 'IRQ', 'ISL', 'ISR', 'ITA', 'JAM', 'JEY', 'JOR', 'JPN', 'KAZ',
  'KEN', 'KGZ', 'KHM', 'KIR', 'KNA', 'KOR', 'KWT', 'LAO', 'LBN', 'LBR', 'LBY', 'LCA', 'LIE',
  'LKA', 'LSO', 'LTU', 'LUX', 'LVA', 'MAC', 'MAF', 'MAR', 'MCO', 'MDA', 'MDG', 'MDV', 'MEX',
  'MHL', 'MKD', 'MLI', 'MLT', 'MMR', 'MNE', 'MNG', 'MNP', 'MOZ', 'MRT', 'MSR', 'MTQ', 'MUS',
  'MWI', 'MYS', 'MYT', 'NAM', 'NCL', 'NER', 'NFK', 'NGA', 'NIC', 'NIU', 'NLD', 'NOR', 'NPL',
  'NRU', 'NZL', 'OMN', 'PAK', 'PAN', 'PCN', 'PER', 'PHL', 'PLW', 'PNG', 'POL', 'PRI', 'PRK',
  'PRT', 'PRY', 'PSE', 'PYF', 'QAT', 'REU', 'ROU', 'RUS', 'RWA', 'SAU', 'SDN', 'SEN', 'SGP',
  'SGS', 'SHN', 'SJM', 'SLB', 'SLE', 'SLV', 'SMR', 'SOM', 'SPM', 'SRB', 'SSD', 'STP', 'SUR',
  'SVK', 'SVN', 'SWE', 'SWZ', 'SXM', 'SYC', 'SYR', 'TCA', 'TCD', 'TGO', 'THA', 'TJK', 'TKL',
  'TKM', 'TLS', 'TON', 'TTO', 'TUN', 'TUR', 'TUV', 'TWN', 'TZA', 'UGA', 'UKR', 'UMI', 'URY',
  'USA', 'UZB', 'VAT', 'VCT', 'VEN', 'VGB', 'VIR', 'VNM', 'VUT', 'WLF', 'WSM', 'YEM', 'ZAF',
  'ZMB', 'ZWE',
]);

export interface DeliveryInput {
  shippingMethod: unknown;
  destinationCountryAlpha3: unknown;
  expectedShipDate: unknown;
  shippingRequirements: unknown;
}

export interface Delivery {
  shippingMethod: ShippingMethod;
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
}

/**
 * Privacy filter for customer free text. This mirrors the frozen approved
 * Phase 3C rule: customer notes must never collect email, phone or street
 * address details; delivery contact happens offline through sales.
 */
export function checkPrivacyViolations(text: string): { hasViolation: boolean; message?: string } {
  if (!text) return { hasViolation: false };

  const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  if (emailRegex.test(text)) {
    return {
      hasViolation: true,
      message:
        'Privacy check: email addresses are not allowed in notes. Contact details are handled offline by sales.',
    };
  }

  const phoneRegex = /(\+?\d{1,4}[\s-]?)?\(?\d{2,4}\)?[\s-]?\d{3,4}[\s-]?\d{3,4}/;
  if (phoneRegex.test(text)) {
    return {
      hasViolation: true,
      message:
        'Privacy check: phone numbers are not allowed in notes. Contact details are handled offline by sales.',
    };
  }

  const addressKeywords = [
    'street', 'st.', 'avenue', 'ave', 'road', 'rd.', 'blvd', 'suite', 'apt', 'room',
    '街道', '路', '弄', '号楼', '室', '大厦', '邮政编码', 'zipcode', 'postal',
  ];
  const lower = text.toLowerCase();
  for (const keyword of addressKeywords) {
    if (lower.includes(keyword)) {
      return {
        hasViolation: true,
        message:
          'Privacy check: street addresses are not allowed. The destination country is selected above; final delivery details are handled offline.',
      };
    }
  }

  return { hasViolation: false };
}

function validIsoDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 2000 || year > 2100) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function validateDelivery(input: DeliveryInput): Delivery {
  if (
    typeof input.shippingMethod !== 'string' ||
    !SHIPPING_METHODS.includes(input.shippingMethod as ShippingMethod)
  ) {
    throw new HttpError(
      400,
      'invalid_shipping_method',
      'shippingMethod must be Express, Air, Sea, Customer Pickup or Other.'
    );
  }
  const country =
    typeof input.destinationCountryAlpha3 === 'string'
      ? input.destinationCountryAlpha3.trim().toUpperCase()
      : '';
  if (!ISO_ALPHA3_CODES.has(country)) {
    throw new HttpError(
      400,
      'invalid_destination_country',
      'destinationCountryAlpha3 must be an assigned ISO 3166-1 alpha-3 country code.'
    );
  }
  const expectedShipDate =
    typeof input.expectedShipDate === 'string' ? input.expectedShipDate.trim() : '';
  if (!validIsoDate(expectedShipDate)) {
    throw new HttpError(
      400,
      'invalid_expected_ship_date',
      'expectedShipDate must be a real calendar date in YYYY-MM-DD format.'
    );
  }
  if (input.shippingRequirements !== undefined && typeof input.shippingRequirements !== 'string') {
    throw new HttpError(400, 'invalid_request', 'shippingRequirements must be text.');
  }
  const shippingRequirements = String(input.shippingRequirements ?? '').trim();
  if (shippingRequirements.length > MAX_SHIPPING_REQUIREMENTS) {
    throw new HttpError(
      400,
      'invalid_request',
      `shippingRequirements must be at most ${MAX_SHIPPING_REQUIREMENTS} characters.`
    );
  }
  const privacy = checkPrivacyViolations(shippingRequirements);
  if (privacy.hasViolation) {
    throw new HttpError(422, 'privacy_violation', privacy.message ?? 'Privacy check failed.');
  }

  return {
    shippingMethod: input.shippingMethod as ShippingMethod,
    destinationCountryAlpha3: country,
    expectedShipDate,
    shippingRequirements,
  };
}

export function validateOrderQuantity(value: unknown, field = 'quantity'): number {
  if (
    typeof value !== 'number' ||
    !Number.isInteger(value) ||
    value < SKU_MOQ ||
    value > MAX_ORDER_QUANTITY
  ) {
    throw new HttpError(
      400,
      'invalid_quantity',
      `${field} must be a whole number from ${SKU_MOQ} to ${MAX_ORDER_QUANTITY}.`
    );
  }
  return value;
}

export function multiplyCents(unitPriceCents: number, quantity: number): number {
  if (
    !Number.isInteger(unitPriceCents) ||
    unitPriceCents <= 0 ||
    unitPriceCents > MAX_PRICE_CENTS
  ) {
    throw new HttpError(422, 'invalid_price', 'The configured unit price is invalid.');
  }
  const total = unitPriceCents * quantity;
  if (!Number.isSafeInteger(total) || total <= 0 || total > MAX_ORDER_TOTAL_CENTS) {
    throw new HttpError(
      422,
      'amount_overflow',
      'The order amount exceeds the supported integer-cent range.'
    );
  }
  return total;
}

export function sumCents(values: number[]): number {
  let total = 0;
  for (const value of values) {
    total += value;
    if (!Number.isSafeInteger(total) || total > MAX_ORDER_TOTAL_CENTS) {
      throw new HttpError(
        422,
        'amount_overflow',
        'The order amount exceeds the supported integer-cent range.'
      );
    }
  }
  if (total <= 0) {
    throw new HttpError(422, 'invalid_amount', 'A confirmed order must have a positive total.');
  }
  return total;
}

/** YYYY-MM-DD in the configured business time zone. */
export function orderBusinessDate(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/** YYMMDD in the configured business time zone. */
export function orderNumberDatePart(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}${value('month')}${value('day')}`;
}

export function formatOrderNumber(datePart: string, sequence: number): string {
  if (!/^[0-9]{6}$/.test(datePart) || !Number.isInteger(sequence) || sequence < 1 || sequence > 9999) {
    throw new HttpError(500, 'order_number_failed', 'The order number could not be generated.');
  }
  return `OD-${datePart}-${String(sequence).padStart(4, '0')}`;
}

/**
 * Canonical digest of the submit payload. Key order is fixed so a retry with
 * an equivalent body matches, while a changed delivery field or cart revision
 * is rejected under the same idempotency key.
 */
export function orderPayloadDigest(
  delivery: Delivery,
  expectedCartRevision: number
): string {
  const canonical = JSON.stringify({
    destinationCountryAlpha3: delivery.destinationCountryAlpha3,
    expectedCartRevision,
    expectedShipDate: delivery.expectedShipDate,
    shippingMethod: delivery.shippingMethod,
    shippingRequirements: delivery.shippingRequirements,
  });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
