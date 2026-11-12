import { findCountry } from '../data/isoCountries';
import type { ShippingMethod } from './types';

export const SHIPPING_METHODS: ShippingMethod[] = [
  'Express',
  'Air',
  'Sea',
  'Customer Pickup',
  'Other',
];

export const DRAFT_VERSION = 1;

export interface ShippingDraft {
  shippingMethod: ShippingMethod | '';
  destinationCountryAlpha3: string;
  expectedShipDate: string;
  shippingRequirements: string;
}

export const EMPTY_DRAFT: ShippingDraft = {
  shippingMethod: 'Sea',
  destinationCountryAlpha3: '',
  expectedShipDate: '',
  shippingRequirements: '',
};

export const isShippingMethod = (value: unknown): value is ShippingMethod =>
  typeof value === 'string' && SHIPPING_METHODS.includes(value as ShippingMethod);

export function shippingDraftKey(companyId: string | undefined): string {
  return `aoking.real.shippingDraft.${companyId ?? 'unknown'}`;
}

/**
 * A valid saved method wins; an empty or malformed old draft falls back to Sea.
 * Destination text is accepted only when it resolves in the ISO dictionary.
 */
export function readShippingDraft(companyId: string | undefined): ShippingDraft {
  try {
    const raw = window.localStorage.getItem(shippingDraftKey(companyId));
    if (!raw) return EMPTY_DRAFT;
    const parsed = JSON.parse(raw) as Partial<ShippingDraft> & { version?: number };
    if (parsed.version !== DRAFT_VERSION) return EMPTY_DRAFT;
    return {
      shippingMethod: isShippingMethod(parsed.shippingMethod) ? parsed.shippingMethod : 'Sea',
      destinationCountryAlpha3:
        typeof parsed.destinationCountryAlpha3 === 'string' &&
        findCountry(parsed.destinationCountryAlpha3)
          ? parsed.destinationCountryAlpha3.toUpperCase()
          : '',
      expectedShipDate: parsed.expectedShipDate ?? '',
      shippingRequirements: parsed.shippingRequirements ?? '',
    };
  } catch {
    return EMPTY_DRAFT;
  }
}
