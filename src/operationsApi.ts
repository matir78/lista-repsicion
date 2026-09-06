import { ActivePurchase, ManagedUser, OperationsSession, RemoteTask, StoreAccess, SupervisionReport } from './types';

const defaultOperationsApiUrl = 'https://script.google.com/macros/s/AKfycbyD3cOqs5bU6hX1W5hu0vYyuFWptfQn01tNQ1AmwNayaXrlOEKDr8wGtiqJkLwJRACZQA/exec';
const operationsApiUrl = import.meta.env.VITE_OPERATIONS_API_URL || defaultOperationsApiUrl;
const sessionTokenKey = 'restock_session_token';

interface ApiEnvelope<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export class OperationsApiError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export const operationsApiConfigured = Boolean(operationsApiUrl);

export const getSessionToken = () => sessionStorage.getItem(sessionTokenKey) || '';

export const clearSessionToken = () => sessionStorage.removeItem(sessionTokenKey);

const request = async <T>(action: string, payload: Record<string, unknown> = {}, authenticated = true): Promise<T> => {
  if (!operationsApiUrl) throw new OperationsApiError('NOT_CONFIGURED', 'Falta configurar la URL del sistema.');

  const response = await fetch(operationsApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({
      action,
      payload,
      requestId: crypto.randomUUID(),
      token: authenticated ? getSessionToken() : undefined,
    }),
  });
  if (!response.ok) throw new OperationsApiError('NETWORK_ERROR', 'No se pudo contactar al sistema.');

  const envelope = await response.json() as ApiEnvelope<T>;
  if (!envelope.ok || !envelope.data) {
    throw new OperationsApiError(envelope.error?.code || 'API_ERROR', envelope.error?.message || 'Operacion rechazada.');
  }
  return envelope.data;
};

type AuthResponse = OperationsSession & { token: string; expiresAt: string };

const keepSession = (response: AuthResponse) => {
  sessionStorage.setItem(sessionTokenKey, response.token);
  return { user: response.user, stores: response.stores };
};

export const operationsApi = {
  identify: (cedula: string) => request<{ cedula: string; name: string; mode: 'ENTER_PIN' | 'SET_PIN' }>(
    'auth.identify', { cedula }, false,
  ),
  login: (cedula: string, pin: string) => request<AuthResponse>('auth.login', { cedula, pin }, false).then(keepSession),
  setPin: (cedula: string, pin: string, activationCode: string) => request<AuthResponse>(
    'auth.setPin', { cedula, pin, activationCode }, false,
  ).then(keepSession),
  getSession: () => request<OperationsSession>('session.get'),
  logout: async () => {
    try {
      await request<{ loggedOut: boolean }>('auth.logout');
    } finally {
      clearSessionToken();
    }
  },
  listTasks: (localId: string) => request<{ tasks: RemoteTask[]; store: StoreAccess }>('tasks.list', { localId }),
  createTask: (payload: {
    localId: string;
    actorId: string;
    clientTaskId: string;
    description: string;
    quantity?: string;
    articleCode?: string;
    barcode?: string;
  }) => request<{ task: RemoteTask }>('tasks.create', payload),
  completeTask: (taskId: string, expectedVersion: number, actorId: string, quantity?: string) => request<{
    taskId: string;
    version?: number;
    alreadyClosed?: boolean;
  }>('tasks.complete', { taskId, expectedVersion, actorId, quantity }),
  markOutOfStock: (taskId: string, expectedVersion: number, actorId: string) => request<{
    task: RemoteTask;
    alreadyMarked?: boolean;
    purchaseRequestCreated?: boolean;
  }>('tasks.outOfStock', { taskId, expectedVersion, actorId }),
  listPurchases: (localId: string) => request<{ purchases: ActivePurchase[]; store: StoreAccess }>('purchases.list', { localId }),
  orderPurchase: (purchaseRequestId: string, localId: string, actorId: string) => request<{
    purchase: ActivePurchase;
    alreadyOrdered?: boolean;
  }>('purchases.order', { purchaseRequestId, localId, actorId }),
  receivePurchase: (purchaseRequestId: string, localId: string, actorId: string, quantity?: string) => request<{
    purchase: ActivePurchase;
    alreadyReceived?: boolean;
  }>('purchases.receive', { purchaseRequestId, localId, actorId, quantity }),
  getSupervisionReport: (payload: { localId?: string; from: string; to: string; userId?: string }) => request<SupervisionReport>(
    'reports.supervision', payload,
  ),
  listUsers: () => request<{ users: ManagedUser[] }>('admin.users.list'),
  createUser: (payload: { cedula: string; name: string; email?: string; storeId?: string; role?: string }) => request<{
    user: ManagedUser;
    activationCode: string;
  }>(
    'admin.users.create', payload,
  ),
  enablePinReset: (userId: string) => request<{ userId: string; pinStatus: string; activationCode: string }>(
    'admin.users.enablePinReset', { userId },
  ),
  createStore: (payload: { code: string; name: string; address?: string }) => request<{ store: StoreAccess }>(
    'admin.locales.create', payload,
  ),
  assignMembership: (userId: string, storeId: string, role: string) => request<{ userId: string }>(
    'admin.memberships.assign', { userId, storeId, role },
  ),
};
