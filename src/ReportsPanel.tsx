import { type ReactNode, useEffect, useRef, useState } from 'react';
import { AlertTriangle, ArrowLeft, CalendarDays, CheckCircle2, Clock3, PackageSearch, RefreshCw, ShoppingCart, Users } from 'lucide-react';
import { operationsApi, OperationsApiError } from './operationsApi';
import { StoreAccess, SupervisionReport } from './types';

interface ReportsPanelProps {
  stores: StoreAccess[];
  allowAllStores: boolean;
  onClose: () => void;
  onAuthFailure: () => void;
}

const inputDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const initialFrom = () => {
  const date = new Date();
  date.setDate(date.getDate() - 6);
  return inputDate(date);
};

const formatDateTime = (value?: string | null) => value
  ? new Intl.DateTimeFormat('es-UY', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value))
  : 'Sin fecha';

const formatDuration = (minutes: number | null) => {
  if (minutes === null) return 'Sin datos';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
};

const eventLabels: Record<string, string> = {
  CREADA: 'Agregó a reposición',
  COMPLETADA: 'Marcó como repuesto',
  SIN_STOCK_DEPOSITO: 'Informó sin stock en depósito',
};

export default function ReportsPanel({ stores, allowAllStores, onClose, onAuthFailure }: ReportsPanelProps) {
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(() => inputDate(new Date()));
  const [storeId, setStoreId] = useState(allowAllStores ? '' : stores[0]?.id || '');
  const [userId, setUserId] = useState('');
  const [report, setReport] = useState<SupervisionReport | null>(null);
  const [people, setPeople] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const requestRef = useRef(0);

  const loadReport = async () => {
    const requestId = ++requestRef.current;
    setLoading(true);
    setError('');
    setReport(null);
    try {
      const response = await operationsApi.getSupervisionReport({
        localId: storeId || undefined,
        from,
        to,
        userId: userId || undefined,
      });
      if (requestId === requestRef.current) {
        setReport(response);
        setPeople(response.people);
      }
    } catch (caught) {
      if (caught instanceof OperationsApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(caught.code)) {
        onAuthFailure();
        return;
      }
      if (requestId === requestRef.current) {
        setError(caught instanceof Error ? caught.message : 'No se pudo generar el reporte.');
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    loadReport();
  }, [from, to, storeId, userId]);

  return (
    <main className="min-h-screen bg-neutral-100 text-neutral-900 sm:p-6">
      <section className="mx-auto min-h-screen max-w-6xl overflow-hidden bg-white sm:min-h-0 sm:rounded-3xl sm:shadow-xl">
        <header className="border-b border-neutral-200 px-5 py-5 sm:px-7">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <button onClick={onClose} className="rounded-xl p-2 text-neutral-500 hover:bg-neutral-100" aria-label="Volver a reposicion"><ArrowLeft size={22} /></button>
              <div>
                <h1 className="text-xl font-bold">Supervision operativa</h1>
                <p className="text-sm text-neutral-500">Actividad registrada, faltantes y compras</p>
              </div>
            </div>
            <button onClick={loadReport} disabled={loading} className="flex items-center gap-2 rounded-xl border border-neutral-300 px-3 py-2 text-sm font-semibold hover:bg-neutral-50 disabled:opacity-50"><RefreshCw size={17} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Actualizar</span></button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-4">
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-neutral-500">Desde</span><input type="date" value={from} max={to} onChange={(event) => setFrom(event.target.value)} className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 outline-none focus:border-blue-500" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-neutral-500">Hasta</span><input type="date" value={to} min={from} max={inputDate(new Date())} onChange={(event) => setTo(event.target.value)} className="w-full rounded-xl border border-neutral-300 px-3 py-2.5 outline-none focus:border-blue-500" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-neutral-500">Local</span><select value={storeId} onChange={(event) => { setStoreId(event.target.value); setUserId(''); setPeople([]); }} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:border-blue-500">{allowAllStores && <option value="">Todos los locales</option>}{stores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-neutral-500">Funcionario</span><select value={userId} onChange={(event) => setUserId(event.target.value)} className="w-full rounded-xl border border-neutral-300 bg-white px-3 py-2.5 outline-none focus:border-blue-500"><option value="">Todos</option>{people.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          </div>
        </header>

        <div className="space-y-9 p-5 sm:p-7">
          {error && <p role="alert" className="rounded-xl bg-red-50 px-4 py-3 text-sm font-medium text-red-700">{error}</p>}
          {loading && !report ? <div className="h-48 animate-pulse rounded-2xl bg-neutral-100" /> : report && (
            <>
              <section aria-label="Resumen del periodo">
                <div className="grid grid-cols-2 divide-x divide-y divide-neutral-200 overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 sm:grid-cols-3 sm:divide-y-0">
                  <SummaryValue icon={<CalendarDays size={18} />} label="Agregadas a reposicion" value={report.summary.tasksCreated} />
                  <SummaryValue icon={<CheckCircle2 size={18} />} label="Marcadas como repuestas" value={report.summary.tasksCompleted} />
                  <SummaryValue icon={<AlertTriangle size={18} />} label="Sin stock informados" value={report.summary.outOfStockIncidents} />
                  <SummaryValue icon={<PackageSearch size={18} />} label="Abiertas ahora" value={report.summary.openTasksNow} />
                  <SummaryValue icon={<ShoppingCart size={18} />} label="Compras pendientes" value={report.summary.pendingPurchasesNow} />
                  <SummaryValue icon={<Clock3 size={18} />} label="Creación a reposición" value={formatDuration(report.summary.averageCompletionMinutes)} />
                </div>
                <p className="mt-2 text-xs text-neutral-400">Las cifras del periodo son eventos registrados. Abiertas y compras pendientes son una fotografía actual.</p>
              </section>

              <section>
                <div className="mb-3 flex items-center gap-2"><Users size={20} className="text-blue-600" /><h2 className="text-lg font-bold">Trabajo por funcionario</h2></div>
                <div className="overflow-x-auto rounded-2xl border border-neutral-200">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="bg-neutral-100 text-xs uppercase tracking-wide text-neutral-500"><tr><th className="px-4 py-3">Funcionario</th><th className="px-4 py-3 text-right">Agregadas</th><th className="px-4 py-3 text-right">Repuestas</th><th className="px-4 py-3 text-right">Sin stock</th><th className="px-4 py-3 text-right">Asignadas abiertas</th></tr></thead>
                    <tbody className="divide-y divide-neutral-200">{report.workers.map((worker) => <tr key={worker.userId}><td className="px-4 py-3 font-semibold">{worker.name}</td><td className="px-4 py-3 text-right tabular-nums">{worker.tasksCreated}</td><td className="px-4 py-3 text-right font-semibold tabular-nums text-green-700">{worker.tasksCompleted}</td><td className="px-4 py-3 text-right tabular-nums text-red-700">{worker.outOfStockReported}</td><td className="px-4 py-3 text-right tabular-nums">{worker.openAssignedNow}</td></tr>)}</tbody>
                  </table>
                  {!report.workers.length && <p className="p-6 text-center text-sm text-neutral-500">No hubo actividad atribuible en este periodo.</p>}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><AlertTriangle size={20} className="text-red-600" /><h2 className="text-lg font-bold">Sin stock abierto</h2></div><span className="text-sm font-semibold text-red-700">{report.outOfStock.openNow.length} de {report.outOfStock.openTotal}</span></div>
                <div className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200">
                  {report.outOfStock.openNow.map((item) => <div key={item.taskId} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{item.description}</p><p className="mt-1 text-sm text-neutral-500">{item.storeName}{item.articleCode ? ` · Art. ${item.articleCode}` : ''}</p></div><div className="text-left sm:text-right"><p className="text-sm font-bold text-red-700">{item.purchaseStatus ? `Compra ${item.purchaseStatus.toLowerCase()}` : 'Sin solicitud de compra'}</p><p className="text-xs text-neutral-400">Desde {formatDateTime(item.createdAt)}</p></div></div>)}
                  {!report.outOfStock.openNow.length && <p className="p-6 text-center text-sm text-neutral-500">No hay faltantes de depósito abiertos.</p>}
                </div>
              </section>

              <section>
                <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><ShoppingCart size={20} className="text-amber-600" /><h2 className="text-lg font-bold">Compras pendientes</h2></div><span className="text-sm font-semibold text-amber-700">{report.pendingPurchases.items.length} de {report.pendingPurchases.total}</span></div>
                <div className="divide-y divide-neutral-200 rounded-2xl border border-neutral-200">
                  {report.pendingPurchases.items.map((purchase) => <div key={purchase.purchaseRequestId} className="grid gap-2 px-4 py-4 sm:grid-cols-[1fr_auto] sm:items-center"><div><p className="font-semibold">{purchase.description}</p><p className="mt-1 text-sm text-neutral-500">{purchase.storeName} · solicitó {purchase.requestedBy?.name || 'Usuario'}</p></div><div className="text-left sm:text-right"><p className="text-sm font-bold text-amber-700">{purchase.status.toLowerCase().replace('_', ' ')}</p><p className="text-xs text-neutral-400">Pendiente hace {purchase.ageHours} h</p></div></div>)}
                  {!report.pendingPurchases.items.length && <p className="p-6 text-center text-sm text-neutral-500">No hay compras pendientes.</p>}
                </div>
              </section>

              <section>
                <h2 className="text-lg font-bold">Actividad cronológica</h2>
                <div className="mt-3 divide-y divide-neutral-200 border-y border-neutral-200">
                  {report.activity.items.map((activity) => <div key={activity.eventId} className="grid gap-1 py-4 sm:grid-cols-[160px_1fr_auto] sm:items-center sm:gap-4"><time className="text-xs font-medium text-neutral-400">{formatDateTime(activity.occurredAt)}</time><div><p className="font-semibold">{eventLabels[activity.type] || activity.type}: {activity.description}</p><p className="text-sm text-neutral-500">{activity.actor?.name || 'Sin autor'} · {activity.storeName}</p></div>{activity.quantity !== null && <span className="text-sm font-bold tabular-nums text-blue-700">x {activity.quantity}</span>}</div>)}
                  {!report.activity.items.length && <p className="py-6 text-center text-sm text-neutral-500">No hay eventos en este periodo.</p>}
                  {report.activity.total > report.activity.items.length && <p className="py-3 text-center text-xs font-semibold text-neutral-500">Mostrando {report.activity.items.length} de {report.activity.total} eventos.</p>}
                </div>
              </section>
            </>
          )}
        </div>
      </section>
    </main>
  );
}

function SummaryValue({ icon, label, value }: { icon: ReactNode; label: string; value: ReactNode }) {
  return <div className="p-4"><div className="flex items-center gap-2 text-neutral-500">{icon}<span className="text-xs font-semibold">{label}</span></div><p className="mt-2 text-xl font-bold tabular-nums text-neutral-900">{value}</p></div>;
}
