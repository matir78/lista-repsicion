import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, PackageCheck, RefreshCw, ShoppingCart, Truck } from 'lucide-react';
import { operationsApi, OperationsApiError } from './operationsApi';
import { ActivePurchase, StoreAccess } from './types';

interface PurchasesPanelProps {
  store: StoreAccess;
  actorId: string;
  canOrder: boolean;
  onClose: () => void;
  onReceived: () => void;
  onAuthFailure: () => void;
}

const statusLabels: Record<string, string> = {
  PENDIENTE: 'Pendiente',
  APROBADA: 'Aprobada',
  PEDIDA: 'Pedida',
  EN_TRANSITO: 'En transito',
  RECIBIDA: 'Recibida',
  CANCELADA: 'Cancelada',
};

const formatDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('es-UY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Sin fecha';

export default function PurchasesPanel({ store, actorId, canOrder, onClose, onReceived, onAuthFailure }: PurchasesPanelProps) {
  const [purchases, setPurchases] = useState<ActivePurchase[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState('');
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const handleApiFailure = (caught: unknown) => {
    if (caught instanceof OperationsApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED', 'SESSION_IDENTITY_CHANGED'].includes(caught.code)) {
      onAuthFailure();
      return;
    }
    setError(caught instanceof Error ? caught.message : 'No se pudo completar la operacion.');
  };

  const loadPurchases = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    try {
      const response = await operationsApi.listPurchases(store.id);
      if (requestId === requestRef.current) setPurchases(response.purchases);
    } catch (caught) {
      if (caught instanceof OperationsApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED', 'SESSION_IDENTITY_CHANGED'].includes(caught.code)) {
        onAuthFailure();
        return;
      }
      if (requestId === requestRef.current) setError(caught instanceof Error ? caught.message : 'No se pudieron cargar las compras.');
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadPurchases();
  }, [store.id]);

  const handleOrder = async (purchase: ActivePurchase) => {
    if (busyId) return;
    setBusyId(purchase.purchaseRequestId);
    setError('');
    try {
      await operationsApi.orderPurchase(purchase.purchaseRequestId, purchase.localId, actorId);
      loadPurchases();
    } catch (caught) {
      handleApiFailure(caught);
    } finally {
      setBusyId('');
    }
  };

  const handleReceive = async (purchase: ActivePurchase) => {
    if (busyId) return;
    setBusyId(purchase.purchaseRequestId);
    setError('');
    try {
      await operationsApi.receivePurchase(purchase.purchaseRequestId, purchase.localId, actorId);
      onReceived();
      loadPurchases();
    } catch (caught) {
      handleApiFailure(caught);
    } finally {
      setBusyId('');
    }
  };

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-900 sm:p-6">
      <section className="mx-auto flex min-h-screen max-w-3xl flex-col overflow-hidden bg-white sm:min-h-0 sm:rounded-3xl sm:shadow-xl">
        <header className="border-b border-neutral-200 px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button onClick={onClose} className="rounded-xl p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Volver a reposicion"><ArrowLeft size={22} /></button>
              <div>
                <h1 className="text-xl font-bold">Compras</h1>
                <p className="text-sm text-neutral-500">{store.name}</p>
              </div>
            </div>
            <button onClick={loadPurchases} disabled={loading} className="flex items-center gap-2 rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Actualizar</span></button>
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            {canOrder
              ? 'Marca la compra como pedida al proveedor y recibila cuando llegue la mercaderia.'
              : 'Cuando el encargado la pida, podras marcar la recepcion de la mercaderia.'}
          </p>
        </header>

        <div className="flex-1 space-y-3 overflow-y-auto p-5 sm:p-7">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
          {loading && !purchases.length ? (
            <div className="space-y-3" aria-label="Cargando compras">
              {[0, 1, 2].map((value) => <div key={value} className="h-20 animate-pulse rounded-2xl bg-neutral-100" />)}
            </div>
          ) : purchases.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center py-16 text-neutral-400">
              <ShoppingCart size={56} className="mb-4 text-neutral-300" strokeWidth={1.5} />
              <p className="text-lg font-medium text-neutral-500">No hay compras pendientes</p>
              <p className="mt-1 max-w-[260px] text-center text-sm">Las compras aparecen cuando se informa falta de stock en deposito.</p>
            </div>
          ) : purchases.map((purchase) => (
            <article key={purchase.purchaseRequestId} className="rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-snug">{purchase.description}</p>
                  <p className="mt-1 text-sm text-neutral-500">
                    {purchase.articleCode && `Art. ${purchase.articleCode} · `}
                    {purchase.quantity || '1'} {purchase.unit || 'u'}
                  </p>
                  <p className="mt-0.5 text-xs text-neutral-400">Solicito {purchase.requestedBy} · {formatDateTime(purchase.requestedAt)}</p>
                </div>
                <span className={`shrink-0 rounded-lg px-2 py-1 text-xs font-bold ${purchase.status === 'PENDIENTE' || purchase.status === 'APROBADA' ? 'bg-amber-50 text-amber-700' : 'bg-blue-50 text-blue-700'}`}>
                  {statusLabels[purchase.status] || purchase.status}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                {canOrder && purchase.canOrder && (
                  <button onClick={() => handleOrder(purchase)} disabled={busyId === purchase.purchaseRequestId} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-amber-600 active:scale-95 disabled:opacity-50">
                    {busyId === purchase.purchaseRequestId ? <RefreshCw size={17} className="animate-spin" /> : <Truck size={17} />} Marcar pedida
                  </button>
                )}
                {purchase.canReceive && (
                  <button onClick={() => handleReceive(purchase)} disabled={busyId === purchase.purchaseRequestId} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-green-600 px-4 py-2.5 text-sm font-bold text-white transition-all hover:bg-green-700 active:scale-95 disabled:opacity-50">
                    {busyId === purchase.purchaseRequestId ? <RefreshCw size={17} className="animate-spin" /> : <PackageCheck size={17} />} Recibir
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
