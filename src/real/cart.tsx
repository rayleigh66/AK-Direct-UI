import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AuthUserDto } from '../auth/api';
import { AuthApiError } from '../auth/api';
import {
  clearCart as clearCartApi,
  getCart,
  removeCartItem as removeCartItemApi,
  setCartItem as setCartItemApi,
} from './api';
import type { CartDto } from './types';

interface RealCartContextValue {
  cart: CartDto | null;
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
  setItem: (skuId: string, quantity: number) => Promise<CartDto>;
  removeItem: (skuId: string) => Promise<CartDto>;
  clear: () => Promise<CartDto>;
}

const RealCartContext = createContext<RealCartContextValue | undefined>(undefined);

function latestCart(error: unknown): CartDto | null {
  if (error instanceof AuthApiError) {
    const candidate = error.details.cart as CartDto | undefined;
    if (candidate && Array.isArray(candidate.items)) return candidate;
  }
  return null;
}

export const RealCartProvider: React.FC<{
  user: AuthUserDto;
  children: React.ReactNode;
}> = ({ user, children }) => {
  const isCustomer = user.type === 'customer';
  const [cart, setCart] = useState<CartDto | null>(null);
  const [loading, setLoading] = useState(isCustomer);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!isCustomer) return;
    setError('');
    try {
      setCart(await getCart());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The cart could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [isCustomer]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const apply = useCallback(
    async (action: () => Promise<CartDto>): Promise<CartDto> => {
      setError('');
      try {
        const next = await action();
        setCart(next);
        return next;
      } catch (err) {
        const serverCart = latestCart(err);
        if (serverCart) setCart(serverCart);
        setError(err instanceof Error ? err.message : 'The cart could not be updated.');
        throw err;
      }
    },
    []
  );

  const revision = () => {
    if (!cart) throw new Error('The cart is still loading. Try again.');
    return cart.revision;
  };

  const value: RealCartContextValue = {
    cart,
    loading,
    error,
    refresh,
    setItem: (skuId, quantity) => apply(() => setCartItemApi(skuId, quantity, revision())),
    removeItem: skuId => apply(() => removeCartItemApi(skuId, revision())),
    clear: () => apply(() => clearCartApi(revision())),
  };

  return <RealCartContext.Provider value={value}>{children}</RealCartContext.Provider>;
};

export function useRealCart(): RealCartContextValue {
  const value = useContext(RealCartContext);
  if (!value) throw new Error('useRealCart must be used inside RealCartProvider.');
  return value;
}

/** USD display helper shared by the real cart and order screens. */
export function usdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}
