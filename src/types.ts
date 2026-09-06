export interface StockItem {
  id: string;
  text: string;
  name?: string;
  quantity?: string;
  articleCode?: string;
  barcode?: string;
  createdAt: number;
  localId?: string;
  status?: string;
  priority?: string;
  version?: number;
  createdBy?: string;
}

export interface CatalogProduct {
  articleCode: string;
  description: string;
  barcode: string | null;
}

export interface CatalogResponse {
  meta: {
    schemaVersion: number;
    totalRecords: number;
  };
  products: CatalogProduct[];
}

export interface OperationsUser {
  id: string;
  name: string;
  globalRole: 'USUARIO' | 'SUPERADMIN';
}

export interface StoreAccess {
  id: string;
  code: string;
  name: string;
  address: string;
  role: string;
}

export interface OperationsSession {
  user: OperationsUser;
  stores: StoreAccess[];
}

export interface RemoteTask {
  id: string;
  localId: string;
  name: string;
  quantity: string | null;
  articleCode: string | null;
  barcode: string | null;
  status: string;
  priority: string;
  version: number;
  createdAt: string | null;
  createdBy: string;
  syncStatus?: 'pending';
}

export interface ManagedUser extends OperationsUser {
  cedula: string;
  active: boolean;
  pinStatus: 'PENDIENTE' | 'ACTIVO' | 'RESET_HABILITADO';
  memberships: Array<{ storeId: string; role: string }>;
}

export interface SupervisionWorker {
  userId: string;
  name: string;
  tasksCreated: number;
  tasksCompleted: number;
  outOfStockReported: number;
  openAssignedNow: number;
}

export interface SupervisionIncident {
  eventId?: string;
  taskId: string;
  localId: string;
  storeName: string;
  articleCode: string | null;
  barcode: string | null;
  description: string;
  reportedBy?: { id: string; name: string } | null;
  reportedAt?: string | null;
  taskStatusNow?: string | null;
  purchaseRequestId?: string | null;
  quantity?: number | null;
  status?: string;
  createdAt?: string | null;
  purchaseStatus?: string | null;
  dataIssue?: string | null;
}

export interface ActivePurchase {
  purchaseRequestId: string;
  taskId: string;
  localId: string;
  description: string;
  articleCode: string | null;
  barcode: string | null;
  quantity: string | null;
  unit: string;
  status: string;
  priority: string;
  supplier: string;
  requestedBy: string;
  requestedAt: string | null;
  canOrder: boolean;
  canReceive: boolean;
}

export interface PendingPurchase {
  purchaseRequestId: string;
  taskId: string;
  localId: string;
  storeName: string;
  articleCode: string | null;
  barcode: string | null;
  description: string;
  requestedQuantity: number | null;
  unit: string;
  status: string;
  priority: string;
  supplier: string;
  requestedBy: { id: string; name: string } | null;
  requestedAt: string | null;
  updatedAt: string | null;
  ageHours: number;
}

export interface SupervisionActivity {
  eventId: string;
  occurredAt: string | null;
  localId: string;
  storeName: string;
  taskId: string;
  type: string;
  description: string;
  actor: { id: string; name: string } | null;
  previousStatus: string | null;
  newStatus: string | null;
  quantity: number | null;
  unit: string;
}

export interface SupervisionReport {
  scope: { localIds: string[]; from: string; to: string; timezone: string; asOf: string };
  summary: {
    tasksCreated: number;
    tasksCompleted: number;
    outOfStockIncidents: number;
    openTasksNow: number;
    pendingPurchasesNow: number;
    averageCompletionMinutes: number | null;
  };
  people: Array<{ id: string; name: string }>;
  workers: SupervisionWorker[];
  outOfStock: { incidentTotal: number; openTotal: number; incidents: SupervisionIncident[]; openNow: SupervisionIncident[] };
  pendingPurchases: { total: number; items: PendingPurchase[] };
  activity: { total: number; items: SupervisionActivity[] };
  warnings: Array<{ code: string; taskId: string }>;
}
