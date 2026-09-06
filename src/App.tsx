import { KeyboardEvent, useDeferredValue, useEffect, useRef, useState } from 'react';
import { AlertCircle, BarChart3, Barcode, Check, LogOut, PackageOpen, PackageX, Plus, RefreshCw, Search, Settings } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import AdminPanel from './AdminPanel';
import LoginScreen from './LoginScreen';
import ReportsPanel from './ReportsPanel';
import { clearSessionToken, getSessionToken, operationsApi, OperationsApiError, operationsApiConfigured } from './operationsApi';
import { CatalogProduct, CatalogResponse, OperationsSession, RemoteTask } from './types';

type SearchableProduct = CatalogProduct & {
  searchText: string;
  compactDescriptionSearch: string;
  descriptionSearch: string;
};

const driveCatalogUrl = 'https://script.google.com/macros/s/AKfycbzGtfW9XfGlPKtY_Cy90-g2XgQO1S0mVQ8wSs0uMaP2bs_smU4Mbis8Tn4nsS505-M/exec';
const localCatalogUrl = `${import.meta.env.BASE_URL}data/articles.json`;
const selectedStoreKey = 'restock_selected_store';

const normalizeSearch = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

const formatArticleCode = (value: string | number) => String(value).replace(/^0+/, '') || '0';

export default function App() {
  const [authStatus, setAuthStatus] = useState<'CHECKING' | 'ERROR' | 'SIGNED_OUT' | 'SIGNED_IN'>('CHECKING');
  const [session, setSession] = useState<OperationsSession | null>(null);
  const [selectedStoreId, setSelectedStoreId] = useState('');
  const [showAdmin, setShowAdmin] = useState(false);
  const [showReports, setShowReports] = useState(false);
  const [items, setItems] = useState<RemoteTask[]>([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [operationError, setOperationError] = useState('');
  const [descriptionValue, setDescriptionValue] = useState('');
  const [quantityValue, setQuantityValue] = useState('');
  const [catalog, setCatalog] = useState<SearchableProduct[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [catalogSource, setCatalogSource] = useState<'drive' | 'local'>('drive');
  const [selectedProduct, setSelectedProduct] = useState<CatalogProduct | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [activeSuggestion, setActiveSuggestion] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const quantityRef = useRef<HTMLInputElement>(null);
  const selectedStoreIdRef = useRef('');
  const tasksRequestRef = useRef(0);
  const pendingTasksRef = useRef(new Map<string, RemoteTask | null>());
  const deferredDescription = useDeferredValue(descriptionValue);

  const mergePendingTasks = (serverTasks: RemoteTask[]) => {
    const merged = serverTasks
      .filter((task) => pendingTasksRef.current.get(task.id) !== null)
      .map((task) => pendingTasksRef.current.get(task.id) || task);
    pendingTasksRef.current.forEach((task, id) => {
      if (task && !serverTasks.some((serverTask) => serverTask.id === id)) merged.unshift(task);
    });
    return merged;
  };

  const query = normalizeSearch(deferredDescription);
  const compactQuery = query.replace(/\s+/g, '');
  const suggestions = query.length < 2
    ? []
    : catalog
        .filter((product) => (
          query.split(/\s+/).every((token) => product.searchText.includes(token))
          || product.compactDescriptionSearch.includes(compactQuery)
        ))
        .sort((left, right) => {
          const leftRank = left.descriptionSearch.startsWith(query) ? 0 : left.articleCode.toLowerCase().startsWith(query) || left.barcode?.startsWith(query) ? 1 : 2;
          const rightRank = right.descriptionSearch.startsWith(query) ? 0 : right.articleCode.toLowerCase().startsWith(query) || right.barcode?.startsWith(query) ? 1 : 2;
          return leftRank - rightRank || left.description.localeCompare(right.description, 'es');
        })
        .slice(0, 8);

  const selectInitialStore = (nextSession: OperationsSession) => {
    const savedStore = localStorage.getItem(selectedStoreKey);
    const storeId = nextSession.stores.some((store) => store.id === savedStore)
      ? savedStore || ''
      : nextSession.stores[0]?.id || '';
    setSelectedStoreId(storeId);
    selectedStoreIdRef.current = storeId;
  };

  const restoreSession = async () => {
    setAuthStatus('CHECKING');
    setOperationError('');
    try {
      const nextSession = await operationsApi.getSession();
      setSession(nextSession);
      selectInitialStore(nextSession);
      setAuthStatus('SIGNED_IN');
    } catch (caught) {
      if (caught instanceof OperationsApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED'].includes(caught.code)) {
        clearSessionToken();
        setAuthStatus('SIGNED_OUT');
      } else {
        setOperationError(caught instanceof Error ? caught.message : 'No se pudo verificar la sesion.');
        setAuthStatus('ERROR');
      }
    }
  };

  useEffect(() => {
    if (!operationsApiConfigured || !getSessionToken()) {
      setAuthStatus('SIGNED_OUT');
      return;
    }
    restoreSession();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const configuredCatalogUrl = import.meta.env.VITE_CATALOG_URL || driveCatalogUrl;

    const loadCatalog = async () => {
      const urls = configuredCatalogUrl === localCatalogUrl
        ? [localCatalogUrl]
        : [configuredCatalogUrl, localCatalogUrl];

      for (const url of urls) {
        try {
          const response = await fetch(url, { signal: controller.signal });
          if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
          const data = await response.json() as CatalogResponse;
          if (data.meta.schemaVersion !== 1 || data.meta.totalRecords !== data.products.length) {
            throw new Error('Invalid catalog contract');
          }
          const seenProducts = new Set<string>();
          setCatalog(data.products.filter((product) => {
            const key = `${product.articleCode}\u0000${product.barcode ?? ''}\u0000${product.description}`;
            if (seenProducts.has(key)) return false;
            seenProducts.add(key);
            return true;
          }).map((product) => {
            const descriptionSearch = normalizeSearch(product.description);
            const codeWithoutLeadingZeros = product.articleCode.replace(/^0+/, '');
            return {
              ...product,
              compactDescriptionSearch: descriptionSearch.replace(/\s+/g, ''),
              descriptionSearch,
              searchText: `${descriptionSearch} ${product.articleCode.toLowerCase()} ${codeWithoutLeadingZeros.toLowerCase()} ${product.barcode ?? ''}`,
            };
          }));
          setCatalogSource(url === localCatalogUrl ? 'local' : 'drive');
          setCatalogStatus('ready');
          return;
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
        }
      }
      throw new Error('No catalog source is available');
    };

    loadCatalog().catch((error) => {
      if (!(error instanceof DOMException && error.name === 'AbortError')) setCatalogStatus('error');
    });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (authStatus !== 'SIGNED_IN' || !selectedStoreId) {
      setItems([]);
      return;
    }
    localStorage.setItem(selectedStoreKey, selectedStoreId);
    selectedStoreIdRef.current = selectedStoreId;
    setItems([]);
    let active = true;

    const refresh = async (quiet = false) => {
      if (!quiet) setLoadingItems(true);
      const requestId = ++tasksRequestRef.current;
      try {
        const response = await operationsApi.listTasks(selectedStoreId);
        if (active && requestId === tasksRequestRef.current) {
          setItems(mergePendingTasks(response.tasks));
          setOperationError('');
        }
      } catch (caught) {
        if (active) handleApiFailure(caught);
      } finally {
        if (active && !quiet) setLoadingItems(false);
      }
    };

    refresh();
    const intervalId = window.setInterval(() => refresh(true), 30000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
  }, [authStatus, selectedStoreId]);

  const handleApiFailure = (caught: unknown) => {
    if (caught instanceof OperationsApiError && ['SESSION_EXPIRED', 'UNAUTHORIZED', 'SESSION_IDENTITY_CHANGED'].includes(caught.code)) {
      clearSessionToken();
      setSession(null);
      setAuthStatus('SIGNED_OUT');
      return;
    }
    if (caught instanceof OperationsApiError && caught.code === 'FORBIDDEN') {
      setItems([]);
      operationsApi.getSession().then((nextSession) => {
        setSession(nextSession);
        selectInitialStore(nextSession);
      }).catch(() => {
        clearSessionToken();
        setSession(null);
        setAuthStatus('SIGNED_OUT');
      });
    }
    setOperationError(caught instanceof Error ? caught.message : 'No se pudo completar la operacion.');
  };

  const handleAuthenticated = (nextSession: OperationsSession) => {
    setSession(nextSession);
    selectInitialStore(nextSession);
    setAuthStatus('SIGNED_IN');
  };

  const handleLogout = async () => {
    await operationsApi.logout().catch(() => clearSessionToken());
    setSession(null);
    setItems([]);
    setAuthStatus('SIGNED_OUT');
  };

  const refreshTasks = async (quiet = false) => {
    if (!selectedStoreId) return;
    const storeId = selectedStoreId;
    const requestId = ++tasksRequestRef.current;
    if (!quiet) setLoadingItems(true);
    try {
      const response = await operationsApi.listTasks(storeId);
      if (selectedStoreIdRef.current === storeId && requestId === tasksRequestRef.current) {
        setItems(mergePendingTasks(response.tasks));
        setOperationError('');
      }
    } catch (caught) {
      handleApiFailure(caught);
    } finally {
      if (!quiet) setLoadingItems(false);
    }
  };

  const handleAddItem = async () => {
    const trimmedDescription = descriptionValue.trim();
    if (!trimmedDescription || !selectedStoreId) return;
    const storeId = selectedStoreId;
    const quantity = quantityValue.trim() || null;
    const product = selectedProduct;
    const temporaryId = crypto.randomUUID();
    const optimisticTask: RemoteTask = {
      id: temporaryId,
      localId: storeId,
      name: trimmedDescription,
      quantity,
      articleCode: product?.articleCode || null,
      barcode: product?.barcode || null,
      status: 'PENDIENTE',
      priority: 'NORMAL',
      version: 0,
      createdAt: new Date().toISOString(),
      createdBy: session.user.name,
      syncStatus: 'pending',
    };
    pendingTasksRef.current.set(temporaryId, optimisticTask);
    setItems((current) => [optimisticTask, ...current]);
    setOperationError('');
    setDescriptionValue('');
    setQuantityValue('');
    setSelectedProduct(null);
    setShowSuggestions(false);
    requestAnimationFrame(() => inputRef.current?.focus());
    try {
      const response = await operationsApi.createTask({
        localId: storeId,
        actorId: session.user.id,
        clientTaskId: temporaryId,
        description: trimmedDescription,
        quantity: quantity || undefined,
        articleCode: product?.articleCode,
        barcode: product?.barcode ?? undefined,
      });
      pendingTasksRef.current.delete(temporaryId);
      if (selectedStoreIdRef.current === response.task.localId) {
        setItems((current) => current.map((item) => item.id === temporaryId ? response.task : item));
      }
      refreshTasks(true);
    } catch (caught) {
      pendingTasksRef.current.delete(temporaryId);
      setItems((current) => current.filter((item) => item.id !== temporaryId));
      handleApiFailure(caught);
    }
  };

  const handleCompleteItem = async (item: RemoteTask) => {
    if (item.syncStatus || pendingTasksRef.current.has(item.id)) return;
    pendingTasksRef.current.set(item.id, null);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setOperationError('');
    try {
      await operationsApi.completeTask(item.id, item.version, session.user.id, item.quantity || undefined);
      pendingTasksRef.current.delete(item.id);
      refreshTasks(true);
    } catch (caught) {
      pendingTasksRef.current.delete(item.id);
      handleApiFailure(caught);
      if (caught instanceof OperationsApiError && caught.code === 'VERSION_CONFLICT') {
        refreshTasks();
      } else if (selectedStoreIdRef.current === item.localId) {
        setItems((current) => current.some((candidate) => candidate.id === item.id) ? current : [item, ...current]);
      }
    }
  };

  const handleOutOfStock = async (item: RemoteTask) => {
    if (item.syncStatus || pendingTasksRef.current.has(item.id) || item.status === 'SIN_STOCK_DEPOSITO') return;
    pendingTasksRef.current.set(item.id, null);
    setItems((current) => current.filter((candidate) => candidate.id !== item.id));
    setOperationError('');
    try {
      await operationsApi.markOutOfStock(item.id, item.version, session.user.id);
      pendingTasksRef.current.delete(item.id);
      refreshTasks(true);
    } catch (caught) {
      pendingTasksRef.current.delete(item.id);
      handleApiFailure(caught);
      if (caught instanceof OperationsApiError && caught.code === 'VERSION_CONFLICT') {
        refreshTasks();
      } else if (selectedStoreIdRef.current === item.localId) {
        setItems((current) => current.some((candidate) => candidate.id === item.id) ? current : [item, ...current]);
      }
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (event.currentTarget === inputRef.current && showSuggestions && suggestions.length) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const direction = event.key === 'ArrowDown' ? 1 : -1;
        setActiveSuggestion((current) => (current + direction + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === 'Escape') {
        setShowSuggestions(false);
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        selectProduct(suggestions[activeSuggestion] ?? suggestions[0]);
        return;
      }
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      handleAddItem();
    }
  };

  const selectProduct = (product: CatalogProduct) => {
    setDescriptionValue(product.description);
    setSelectedProduct(product);
    setShowSuggestions(false);
    setActiveSuggestion(0);
    requestAnimationFrame(() => quantityRef.current?.focus());
  };

  if (!operationsApiConfigured) {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-100 p-6 text-neutral-900">
        <section className="max-w-md rounded-2xl bg-white p-7 shadow-lg">
          <AlertCircle className="text-amber-500" size={32} />
          <h1 className="mt-4 text-xl font-bold">Falta conectar la base</h1>
          <p className="mt-2 text-sm leading-relaxed text-neutral-600">
            Configura <code className="rounded bg-neutral-100 px-1.5 py-0.5">VITE_OPERATIONS_API_URL</code> con la URL del Web App de Google Apps Script.
          </p>
        </section>
      </main>
    );
  }

  if (authStatus === 'CHECKING') {
    return <main className="grid min-h-screen place-items-center bg-neutral-100 text-sm font-medium text-neutral-500">Verificando sesion...</main>;
  }

  if (authStatus === 'ERROR') {
    return (
      <main className="grid min-h-screen place-items-center bg-neutral-100 p-6 text-neutral-900">
        <section className="max-w-sm rounded-2xl bg-white p-7 text-center shadow-lg">
          <AlertCircle className="mx-auto text-amber-500" size={32} />
          <h1 className="mt-4 text-xl font-bold">No se pudo conectar</h1>
          <p className="mt-2 text-sm text-neutral-600">{operationError}</p>
          <button onClick={restoreSession} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white hover:bg-blue-700">Reintentar</button>
        </section>
      </main>
    );
  }

  if (authStatus === 'SIGNED_OUT' || !session) return <LoginScreen onAuthenticated={handleAuthenticated} />;

  if (showAdmin && session.user.globalRole === 'SUPERADMIN') {
    return <AdminPanel session={session} onClose={() => setShowAdmin(false)} onSessionChange={(nextSession) => {
      setSession(nextSession);
      selectInitialStore(nextSession);
    }} />;
  }

  const reportStores = session.user.globalRole === 'SUPERADMIN'
    ? session.stores
    : session.stores.filter((store) => ['ENCARGADO', 'ADMINISTRADOR'].includes(store.role));

  if (showReports && reportStores.length) {
    return (
      <ReportsPanel
        stores={reportStores}
        allowAllStores={session.user.globalRole === 'SUPERADMIN'}
        onClose={() => setShowReports(false)}
        onAuthFailure={() => {
          clearSessionToken();
          setSession(null);
          setAuthStatus('SIGNED_OUT');
        }}
      />
    );
  }

  const selectedStore = session.stores.find((store) => store.id === selectedStoreId);

  return (
    <div className="relative min-h-screen bg-neutral-100 font-sans text-neutral-900 sm:p-6 md:p-8">
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col overflow-hidden bg-white sm:min-h-[85vh] sm:rounded-3xl sm:border sm:border-neutral-200 sm:shadow-xl">
        <header className="z-20 bg-blue-600 px-5 pb-5 pt-6 text-white shadow-md">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-3"><PackageOpen size={27} /><h1 className="text-2xl font-bold tracking-tight">Reposicion</h1></div>
              <p className="mt-1 truncate text-sm text-blue-100">{session.user.name}</p>
            </div>
            <div className="flex shrink-0 gap-1">
              {reportStores.length > 0 && (
                <button onClick={() => setShowReports(true)} className="rounded-xl p-2.5 text-blue-100 hover:bg-white/10 hover:text-white" aria-label="Ver supervision"><BarChart3 size={20} /></button>
              )}
              {session.user.globalRole === 'SUPERADMIN' && (
                <button onClick={() => setShowAdmin(true)} className="rounded-xl p-2.5 text-blue-100 hover:bg-white/10 hover:text-white" aria-label="Administrar sistema"><Settings size={20} /></button>
              )}
              <button onClick={handleLogout} className="rounded-xl p-2.5 text-blue-100 hover:bg-white/10 hover:text-white" aria-label="Cerrar sesion"><LogOut size={20} /></button>
            </div>
          </div>
          {session.stores.length > 0 && (
            <select
              value={selectedStoreId}
              onChange={(event) => {
                selectedStoreIdRef.current = event.target.value;
                setSelectedStoreId(event.target.value);
              }}
              className="mt-4 w-full rounded-xl border border-blue-400 bg-blue-700/40 px-3 py-2.5 text-sm font-semibold text-white outline-none focus:ring-2 focus:ring-white/70"
              aria-label="Local activo"
            >
              {session.stores.map((store) => <option key={store.id} className="bg-white text-neutral-900" value={store.id}>{store.code} · {store.name}</option>)}
            </select>
          )}
        </header>

        {!selectedStore ? (
          <div className="flex flex-1 flex-col items-center justify-center p-8 text-center">
            <PackageOpen size={56} className="text-neutral-300" strokeWidth={1.5} />
            <h2 className="mt-4 text-lg font-bold">No hay locales disponibles</h2>
            <p className="mt-2 max-w-xs text-sm text-neutral-500">{session.user.globalRole === 'SUPERADMIN' ? 'Abre Administracion para crear el primer local.' : 'Solicita al superadmin que te asigne un local.'}</p>
            {session.user.globalRole === 'SUPERADMIN' && <button onClick={() => setShowAdmin(true)} className="mt-5 rounded-xl bg-blue-600 px-5 py-3 font-bold text-white">Crear local</button>}
          </div>
        ) : (
          <>
            <div className="sticky top-0 z-10 border-b border-neutral-100 bg-white p-4 shadow-sm">
              <div className="relative flex gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={descriptionValue}
                  onChange={(event) => {
                    setDescriptionValue(event.target.value);
                    setSelectedProduct(null);
                    setShowSuggestions(true);
                    setActiveSuggestion(0);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={() => window.setTimeout(() => setShowSuggestions(false), 120)}
                  onKeyDown={handleKeyDown}
                  placeholder="Buscar articulo o codigo"
                  className="h-auto min-h-14 min-w-0 flex-1 resize-none overflow-hidden rounded-2xl border-none bg-neutral-100 px-5 py-4 text-lg leading-[15px] outline-none transition-all placeholder:text-neutral-400 focus:bg-white focus:ring-2 focus:ring-blue-500"
                  onInput={(event) => {
                    const target = event.target as HTMLTextAreaElement;
                    target.style.height = 'auto';
                    target.style.height = `${target.scrollHeight}px`;
                  }}
                  autoFocus
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={showSuggestions && suggestions.length > 0}
                  aria-controls="catalog-suggestions"
                  aria-activedescendant={showSuggestions && suggestions.length ? `catalog-option-${activeSuggestion}` : undefined}
                />
                <div className="flex w-18 shrink-0 items-center rounded-2xl bg-neutral-100 px-2 transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500">
                  <input ref={quantityRef} type="number" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} onKeyDown={handleKeyDown} placeholder="12" min="1" className="w-full appearance-none bg-transparent p-2 text-center text-xl font-bold outline-none placeholder:text-neutral-300" />
                </div>
                <button onClick={handleAddItem} disabled={!descriptionValue.trim()} className="flex shrink-0 items-center justify-center rounded-2xl bg-blue-600 px-5 py-4 text-white shadow-md transition-all hover:bg-blue-700 active:scale-95 disabled:bg-neutral-300 disabled:shadow-none" aria-label="Anadir articulo">
                  <Plus size={28} strokeWidth={2.5} />
                </button>

                {showSuggestions && query.length >= 2 && (
                  <div id="catalog-suggestions" role="listbox" className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 max-h-80 overflow-y-auto rounded-2xl border border-neutral-200 bg-white p-1.5 shadow-2xl">
                    {suggestions.length ? suggestions.map((product, index) => (
                      <button id={`catalog-option-${index}`} key={`${product.articleCode}-${product.barcode ?? ''}`} type="button" role="option" aria-selected={activeSuggestion === index} onMouseDown={(event) => event.preventDefault()} onMouseEnter={() => setActiveSuggestion(index)} onClick={() => selectProduct(product)} className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left ${activeSuggestion === index ? 'bg-blue-50' : 'hover:bg-neutral-50'}`}>
                        <Search size={18} className="mt-0.5 shrink-0 text-blue-500" />
                        <span className="min-w-0 flex-1">
                          <span className="block font-semibold leading-snug text-neutral-900">{product.description}</span>
                          <span className="mt-1 flex items-center justify-between gap-3">
                            {product.barcode && <span className="flex min-w-0 items-center gap-1 truncate text-sm font-semibold text-neutral-600"><Barcode size={15} className="shrink-0" /> {product.barcode}</span>}
                            <span className="ml-auto shrink-0 text-xs text-neutral-400">Art. {formatArticleCode(product.articleCode)}</span>
                          </span>
                        </span>
                      </button>
                    )) : <p className="px-4 py-5 text-center text-sm text-neutral-500">Sin coincidencias. Puedes agregarlo manualmente.</p>}
                  </div>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-3 px-1 text-xs">
                <p className={catalogStatus === 'error' ? 'text-amber-700' : 'text-neutral-400'}>
                  {catalogStatus === 'loading' && 'Cargando catalogo...'}
                  {catalogStatus === 'ready' && `${catalog.length.toLocaleString('es-UY')} articulos · ${catalogSource === 'drive' ? 'Drive' : 'copia local'}`}
                  {catalogStatus === 'error' && 'Catalogo no disponible; puedes cargar manualmente.'}
                </p>
                <button onClick={() => refreshTasks()} disabled={loadingItems} className="flex items-center gap-1 font-semibold text-blue-600 disabled:text-neutral-400"><RefreshCw size={14} className={loadingItems ? 'animate-spin' : ''} /> Actualizar</button>
              </div>
              {operationError && <p role="alert" className="mt-3 rounded-xl bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{operationError}</p>}
            </div>

            <div className="relative flex-1 overflow-y-auto bg-neutral-50/50 p-4 pb-24">
              {loadingItems && !items.filter((item) => item.localId === selectedStoreId).length ? (
                <div className="space-y-3" aria-label="Cargando tareas">
                  {[0, 1, 2].map((value) => <div key={value} className="h-24 animate-pulse rounded-2xl bg-neutral-200/70" />)}
                </div>
              ) : items.filter((item) => item.localId === selectedStoreId).length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center pb-8 pt-12 text-neutral-400">
                  <PackageOpen size={64} className="mb-4 text-neutral-300" strokeWidth={1.5} />
                  <p className="text-lg font-medium text-neutral-500">Todo listo por ahora</p>
                  <p className="mt-1 max-w-[250px] text-center text-sm">No hay reposiciones pendientes en {selectedStore.name}.</p>
                </div>
              ) : (
                <ul className="flex flex-col gap-3 pb-8">
                  <AnimatePresence mode="popLayout">
                    {items.filter((item) => item.localId === selectedStoreId).map((item) => (
                      <motion.li layout initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: 20 }} transition={{ duration: 0.18 }} key={item.id} className="flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white p-3 pl-5 shadow-sm">
                        <div className="min-w-0 flex-1">
                          <p className="text-base font-semibold leading-snug text-neutral-800">{item.name}</p>
                          {item.barcode && <p className="mt-1 flex items-center gap-1 truncate text-sm font-semibold text-neutral-600"><Barcode size={15} className="shrink-0" /> {item.barcode}</p>}
                          <div className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-neutral-400">
                            {item.articleCode && <span>Art. {formatArticleCode(item.articleCode)}</span>}
                           <span>por {item.createdBy}</span>
                            {item.syncStatus === 'pending' && <span className="inline-flex items-center gap-1 font-semibold text-blue-600"><RefreshCw size={11} className="animate-spin" /> Guardando</span>}
                          </div>
                        </div>
                        <div className="flex shrink-0 items-center rounded-xl border border-blue-100 bg-blue-50 px-2 py-1.5 text-sm font-bold text-blue-700"><span className="mr-0.5 text-blue-400">x</span>{item.quantity || '1'}</div>
                        <button onClick={() => handleOutOfStock(item)} disabled={item.syncStatus === 'pending'} className="shrink-0 rounded-xl bg-red-50 p-3 text-red-700 transition-all hover:bg-red-100 active:scale-90 disabled:opacity-50" aria-label={`Marcar ${item.name} sin stock`}>
                          <PackageX size={26} />
                        </button>
                        <button onClick={() => handleCompleteItem(item)} disabled={item.syncStatus === 'pending'} className="ml-1 shrink-0 rounded-xl bg-green-100 p-3 text-green-700 transition-all hover:bg-green-200 active:scale-90 disabled:opacity-50" aria-label={`Marcar ${item.name} como repuesto`}>
                          <Check size={28} strokeWidth={3} />
                        </button>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
