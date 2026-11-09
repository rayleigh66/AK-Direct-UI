import React, { useEffect, useMemo, useState } from 'react';
import { Check, Search, ShoppingBag, ShoppingCart, X } from 'lucide-react';
import { listCustomerBrands, listCustomerProducts, listCustomerSeries, listCustomerTags } from '../api';
import { useRealCart, usdFromCents } from '../cart';
import type { CustomerProductDto, CustomerBrandDto, SeriesDto, TagDto } from '../types';
import { ErrorBlock, LoadingBlock } from '../RealWorkspace';
import { QuantityField } from '../../components/ui/QuantityField';
import { HelpTooltip } from '../../components/ui/HelpTooltip';

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const CustomerCatalogView: React.FC<{ onOpenCart?: () => void }> = ({ onOpenCart }) => {
  const [products, setProducts] = useState<CustomerProductDto[]>([]);
  const [brands, setBrands] = useState<CustomerBrandDto[]>([]);
  const [series, setSeries] = useState<SeriesDto[]>([]);
  const [tags, setTags] = useState<TagDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [brandId, setBrandId] = useState('');
  const [seriesId, setSeriesId] = useState('');
  const [tagId, setTagId] = useState('');
  const [selected, setSelected] = useState<CustomerProductDto | null>(null);
  const { cart, setItem } = useRealCart();
  const [skuQuantities, setSkuQuantities] = useState<Record<string, string>>({});
  const [addError, setAddError] = useState('');
  const [addingSku, setAddingSku] = useState<string | null>(null);
  const [addedSku, setAddedSku] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError('');
    Promise.all([
      listCustomerProducts(),
      listCustomerBrands(),
      listCustomerSeries(),
      listCustomerTags(),
    ])
      .then(([items, brandItems, seriesItems, tagItems]) => {
        setProducts(items);
        setBrands(brandItems);
        setSeries(seriesItems);
        setTags(tagItems);
      })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!selected) return;
    const next: Record<string, string> = {};
    for (const sku of selected.skus) {
      const existing = cart?.items.find(item => item.skuId === sku.id);
      next[sku.id] = String(existing?.quantity ?? 10);
    }
    setSkuQuantities(next);
    setAddError('');
    setAddedSku(null);
    // Only re-initialise when a product is opened; cart changes must not clear
    // the "Added" confirmation while the detail stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  const addSku = async (skuId: string) => {
    const quantity = Number(skuQuantities[skuId]);
    if (!Number.isInteger(quantity) || quantity < 10) {
      setAddError('Minimum 10 whole PCS per SKU.');
      return;
    }
    setAddingSku(skuId);
    setAddError('');
    setAddedSku(null);
    try {
      await setItem(skuId, quantity);
      setAddedSku(skuId);
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'The SKU could not be added to the cart.');
    } finally {
      setAddingSku(null);
    }
  };

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return products.filter(product => {
      if (brandId && product.brandId !== brandId) return false;
      if (seriesId && product.seriesId !== seriesId) return false;
      if (tagId && !product.tagIds.includes(tagId)) return false;
      if (
        needle &&
        !`${product.productCode} ${product.title} ${product.titleEn}`.toLowerCase().includes(needle)
      ) {
        return false;
      }
      return true;
    });
  }, [products, search, brandId, seriesId, tagId]);

  if (loading) return <LoadingBlock label="Loading catalogue…" />;
  if (error) return <ErrorBlock message={error} onRetry={load} />;
  if (!products.length) {
    return (
      <div className="bg-white border border-slate-200 rounded-2xl p-8 text-center text-sm text-slate-500">
        No authorised products are published for your company yet.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-extrabold">Wholesale catalogue</h2>
          <p className="text-[11px] text-slate-500">Authorised products · reference USD prices</p>
        </div>
        {onOpenCart && (
          <button
            type="button"
            onClick={onOpenCart}
            data-testid="real-catalog-cart-entry"
            className="relative inline-flex min-h-[42px] items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-xs font-bold text-slate-800"
          >
            <span className="relative inline-flex">
              <ShoppingCart className="h-4 w-4" aria-hidden="true" />
              {(cart?.totalQuantity ?? 0) > 0 && (
                <span className="absolute -right-2.5 -top-2.5 grid h-4 min-w-[16px] place-items-center rounded-full bg-[#ff681e] px-1 text-[9px] font-bold leading-none text-white">
                  {(cart?.totalQuantity ?? 0) > 99 ? '99+' : cart?.totalQuantity}
                </span>
              )}
            </span>
            Order list
          </button>
        )}
      </div>
      <section className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 h-10 px-3 rounded-xl border border-slate-300 text-sm flex-1 min-w-[220px]">
            <Search className="w-4 h-4 text-slate-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Search product code or name"
              className="flex-1 outline-none bg-transparent"
              data-testid="catalog-search"
            />
          </label>
          <select
            value={brandId}
            onChange={event => setBrandId(event.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
          >
            <option value="">All brands</option>
            {brands.map(brand => (
              <option key={brand.id} value={brand.id}>
                {brand.nameEn}
              </option>
            ))}
          </select>
          <select
            value={seriesId}
            onChange={event => setSeriesId(event.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
          >
            <option value="">All series</option>
            {series.map(item => (
              <option key={item.id} value={item.id}>
                {item.nameEn}
              </option>
            ))}
          </select>
          <select
            value={tagId}
            onChange={event => setTagId(event.target.value)}
            className="h-10 px-3 rounded-xl border border-slate-300 text-sm bg-white"
          >
            <option value="">All features</option>
            {tags.map(tag => (
              <option key={tag.id} value={tag.id}>
                {tag.nameEn}
              </option>
            ))}
          </select>
        </div>
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
          <span>
            Showing {visible.length} of {products.length} authorised products.
          </span>
          <HelpTooltip label="Catalogue price and visibility details">
            Prices are reference USD wholesale prices in cents. Only products published for your
            authorised brands are shown.
          </HelpTooltip>
        </p>
      </section>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {visible.map(product => {
          const primary = product.images.find(image => image.isPrimary) ?? product.images[0];
          const active = product.skus.filter(sku => sku.sellableStatus === 'active');
          const min = Math.min(...active.map(sku => sku.basePriceCents));
          const totalAvailable = active.reduce((sum, sku) => sum + sku.available, 0);
          return (
            <button
              key={product.id}
              type="button"
              onClick={() => setSelected(product)}
              data-testid="catalog-product-card"
              className="text-left bg-white border border-slate-200 rounded-2xl overflow-hidden hover:border-[#ff681e] transition-colors"
            >
              <div className="aspect-[4/3] bg-[#f3f3f1] overflow-hidden">
                {primary && (
                  <img
                    src={primary.url}
                    alt={product.titleEn}
                    className="w-full h-full object-cover"
                    loading="lazy"
                  />
                )}
              </div>
              <div className="p-4 space-y-1.5">
                <div className="text-[10px] font-mono text-slate-400">{product.productCode}</div>
                <div className="text-sm font-bold leading-snug">{product.titleEn}</div>
                <div className="text-xs text-slate-500 line-clamp-2">{product.descriptionEn}</div>
                <div className="flex items-center justify-between pt-1">
                  <span className="text-sm font-extrabold text-[#ff681e]">
                    {Number.isFinite(min) ? `${usd(min)} / pc` : 'Unavailable'}
                  </span>
                  <span
                    className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      totalAvailable > 0
                        ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                        : 'bg-amber-50 text-amber-700 border border-amber-200'
                    }`}
                  >
                    {totalAvailable > 0 ? `${totalAvailable} available` : 'Restocking'}
                  </span>
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {selected && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-0 sm:p-6"
          role="dialog"
          aria-modal="true"
          data-testid="catalog-detail"
        >
          <div className="bg-white w-full sm:max-w-3xl max-h-[92vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl">
            <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-slate-200">
              <div>
                <div className="text-[10px] font-mono text-slate-400">{selected.productCode}</div>
                <h2 className="text-lg font-bold">{selected.titleEn}</h2>
                <div className="text-xs text-slate-500">{selected.brandName}</div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                className="w-9 h-9 rounded-full border border-slate-200 grid place-items-center"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 sm:p-5 space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {selected.images.map(image => (
                  <img
                    key={image.id}
                    src={image.url}
                    alt={selected.titleEn}
                    className="w-full aspect-square object-cover rounded-xl border border-slate-200"
                  />
                ))}
              </div>
              <p className="text-sm text-slate-600 leading-relaxed">{selected.descriptionEn}</p>
              <dl className="grid sm:grid-cols-2 gap-2 text-xs">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <dt className="text-slate-400">Material</dt>
                  <dd className="font-semibold">{selected.material}</dd>
                </div>
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <dt className="text-slate-400">Size / capacity</dt>
                  <dd className="font-semibold">{selected.capacityOrSize}</dd>
                </div>
              </dl>
              <div className="space-y-2">
                <div className="text-xs font-bold text-slate-700">Colours</div>
                {addError && (
                  <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-800">
                    {addError}
                  </div>
                )}
                {selected.skus.map(sku => {
                  const inCart = cart?.items.find(item => item.skuId === sku.id);
                  const disabled = sku.available < 10;
                  return (
                    <div
                      key={sku.id}
                      className="p-3 rounded-xl border border-slate-200 space-y-2"
                      data-testid="catalog-sku-row"
                      data-sku-code={sku.skuCode}
                    >
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <span
                          className="w-5 h-5 rounded-full border border-slate-300"
                          style={{ backgroundColor: sku.colorHex }}
                        />
                        <span className="font-semibold">{sku.colorNameEn}</span>
                        <span className="font-mono text-[10px] text-slate-400">{sku.skuCode}</span>
                        {inCart && (
                          <span className="px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-bold">
                            In cart: {inCart.quantity}
                          </span>
                        )}
                        <span className="ml-auto text-right">
                          <span className="font-bold">{usdFromCents(sku.basePriceCents)}</span>
                          <span className="text-[10px] text-slate-400 ml-2">
                            {sku.available} pcs available
                          </span>
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="text-[11px] text-slate-500">
                          Quantity (MOQ 10)
                          <QuantityField
                            min={10}
                            max={sku.available}
                            value={skuQuantities[sku.id] ?? '10'}
                            onValueChange={value =>
                              setSkuQuantities(prev => ({ ...prev, [sku.id]: value }))
                            }
                            disabled={disabled}
                            className="ml-2 w-24 h-9 px-2 rounded-lg border border-slate-300 text-center text-xs disabled:bg-slate-100"
                            testId="catalog-add-qty"
                            ariaLabel={`Quantity for ${sku.skuCode}`}
                          />
                        </label>
                        <button
                          type="button"
                          disabled={disabled || addingSku === sku.id}
                          onClick={() => void addSku(sku.id)}
                          data-testid="catalog-add-submit"
                          className="min-h-[38px] px-3 rounded-xl bg-[#ff681e] text-white text-xs font-bold disabled:opacity-40"
                        >
                          {addingSku === sku.id
                            ? 'Saving…'
                            : inCart
                              ? 'Update cart'
                              : 'Add to cart'}
                        </button>
                        {addedSku === sku.id && (
                          <span className="text-[11px] text-emerald-700 flex items-center gap-1">
                            <Check className="w-3.5 h-3.5" /> Added to the company shared cart
                          </span>
                        )}
                        {disabled && (
                          <span className="text-[11px] text-amber-700">
                            Fewer than 10 PCS available.
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="rounded-xl bg-[#fff7f2] border border-[#ffeadb] p-3 text-[11px] text-[#8a4d2c] flex items-start gap-2">
                <ShoppingBag className="w-4 h-4 mt-0.5 shrink-0" />
                <span className="flex flex-wrap items-center gap-1.5">
                  <span>Shared company cart · order requests do not reserve stock.</span>
                  <HelpTooltip label="Shared cart and reservation details" align="right">
                    The cart is shared by every account of your company. Submitting an order creates
                    a pending request; it does not reserve stock.
                  </HelpTooltip>
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
