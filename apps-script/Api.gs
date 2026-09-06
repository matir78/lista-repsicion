const API_SESSION_HOURS = 12;
const API_MAX_BODY_LENGTH = 20000;
const API_MAX_LOGIN_ATTEMPTS = 5;
const API_LOGIN_BLOCK_MINUTES = 15;

function doPost(event) {
  let requestId = '';
  try {
    const body = parseApiRequest_(event);
    requestId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId || '')
      ? body.requestId
      : Utilities.getUuid();
    const data = dispatchApiAction_(body.action, body.payload || {}, body.token || '', requestId);
    return jsonResponse_({ ok: true, data, requestId });
  } catch (error) {
    console.error(error && error.stack ? error.stack : error);
    return jsonResponse_({
      ok: false,
      error: {
        code: error && error.code ? error.code : 'INTERNAL_ERROR',
        message: error && error.publicMessage ? error.publicMessage : 'No se pudo completar la operacion.',
      },
      requestId,
    });
  }
}

function dispatchApiAction_(action, payload, token, requestId) {
  const publicActions = {
    'auth.identify': () => identifyUser_(payload),
    'auth.setPin': () => withApiLock_(() => setUserPin_(payload, requestId)),
    'auth.login': () => withApiLock_(() => loginUser_(payload, requestId)),
  };
  if (publicActions[action]) return publicActions[action]();

  const actions = {
    'auth.logout': (context) => logoutUser_(context, requestId),
    'session.get': (context) => sessionPayload_(context),
    'tasks.list': (context) => listTasks_(context, payload),
    'tasks.create': (context) => createTask_(context, payload, requestId),
    'tasks.complete': (context) => completeTask_(context, payload, requestId),
    'tasks.outOfStock': (context) => markTaskOutOfStock_(context, payload, requestId),
    'purchases.list': (context) => listPendingPurchases_(context, payload),
    'purchases.order': (context) => orderPurchase_(context, payload, requestId),
    'purchases.receive': (context) => receivePurchase_(context, payload, requestId),
    'reports.supervision': (context) => supervisionReport_(context, payload),
    'admin.users.list': (context) => listUsers_(context),
    'admin.users.create': (context) => createUser_(context, payload, requestId),
    'admin.users.enablePinReset': (context) => enablePinReset_(context, payload, requestId),
    'admin.locales.create': (context) => createStore_(context, payload, requestId),
    'admin.memberships.assign': (context) => assignMembership_(context, payload, requestId),
  };
  if (!actions[action]) throw apiError_('UNKNOWN_ACTION', 'Accion no reconocida.');
  const readActions = ['session.get', 'tasks.list', 'purchases.list', 'reports.supervision', 'admin.users.list'];
  if (readActions.indexOf(action) !== -1) return actions[action](requireSession_(token));
  return withApiLock_(() => actions[action](requireSession_(token)));
}

function parseApiRequest_(event) {
  const contents = event && event.postData ? event.postData.contents : '';
  if (!contents || contents.length > API_MAX_BODY_LENGTH) {
    throw apiError_('INVALID_REQUEST', 'Solicitud vacia o demasiado grande.');
  }
  try {
    const body = JSON.parse(contents);
    if (!body || typeof body.action !== 'string') throw new Error('Missing action');
    return body;
  } catch (error) {
    throw apiError_('INVALID_JSON', 'La solicitud no tiene un formato valido.');
  }
}

function identifyUser_(payload) {
  const cedula = validateCedula_(payload.cedula);
  const match = findUserByCedula_(cedula);
  if (!match || match.record.activo !== 'SI') {
    throw apiError_('USER_NOT_FOUND', 'Usuario no habilitado.');
  }
  return {
    cedula,
    name: match.record.nombre,
    mode: match.record.pin_estado === 'ACTIVO' && match.record.pin_hash ? 'ENTER_PIN' : 'SET_PIN',
  };
}

function setUserPin_(payload, requestId) {
  const cedula = validateCedula_(payload.cedula);
  const pin = validatePin_(payload.pin);
  const activationCode = validateActivationCode_(payload.activationCode);
  const match = findUserByCedula_(cedula);
  if (!match || match.record.activo !== 'SI') {
    throw apiError_('USER_NOT_FOUND', 'Usuario no habilitado.');
  }
  if (match.record.pin_estado !== 'PENDIENTE' && match.record.pin_estado !== 'RESET_HABILITADO') {
    throw apiError_('PIN_ALREADY_SET', 'El PIN ya fue configurado.');
  }
  const blockedUntil = dateValue_(match.record.bloqueado_hasta);
  if (blockedUntil && blockedUntil.getTime() > Date.now()) {
    throw apiError_('LOGIN_BLOCKED', 'Acceso bloqueado temporalmente. Intenta nuevamente mas tarde.');
  }
  const activationExpires = dateValue_(match.record.activation_expires_en);
  if (!activationExpires || activationExpires.getTime() <= Date.now()
      || hashActivationCode_(match.record.id, activationCode) !== match.record.activation_hash) {
    const failedAttempts = Number(match.record.intentos_fallidos || 0) + 1;
    const updates = { intentos_fallidos: failedAttempts, actualizado_en: new Date() };
    if (failedAttempts >= API_MAX_LOGIN_ATTEMPTS) {
      updates.intentos_fallidos = 0;
      updates.bloqueado_hasta = new Date(Date.now() + API_LOGIN_BLOCK_MINUTES * 60000);
    }
    updateTableRow_(match.sheet, match.headers, match.record._row, updates);
    appendAudit_({
      request_id: requestId,
      usuario_id: match.record.id,
      accion: 'ACTIVACION_RECHAZADA',
      entidad: 'usuario',
      entidad_id: match.record.id,
      resultado: 'RECHAZADO',
    });
    throw apiError_('INVALID_ACTIVATION', 'El codigo de activacion es incorrecto o vencio.');
  }

  updateTableRow_(match.sheet, match.headers, match.record._row, {
    pin_hash: hashPin_(match.record.id, pin),
    pin_estado: 'ACTIVO',
    activation_hash: '',
    activation_expires_en: '',
    intentos_fallidos: 0,
    bloqueado_hasta: '',
    actualizado_en: new Date(),
  });
  revokeUserSessions_(match.record.id);
  appendAudit_({
    request_id: requestId,
    usuario_id: match.record.id,
    accion: 'CONFIGURAR_PIN',
    entidad: 'usuario',
    entidad_id: match.record.id,
    resultado: 'EXITO',
  });
  return createSessionPayload_(match.record.id);
}

function loginUser_(payload, requestId) {
  const cedula = validateCedula_(payload.cedula);
  const pin = validatePin_(payload.pin);
  const match = findUserByCedula_(cedula);
  const genericError = () => apiError_('INVALID_CREDENTIALS', 'Cedula o PIN incorrectos.');
  if (!match || match.record.activo !== 'SI' || match.record.pin_estado !== 'ACTIVO') {
    throw genericError();
  }

  const blockedUntil = dateValue_(match.record.bloqueado_hasta);
  if (blockedUntil && blockedUntil.getTime() > Date.now()) {
    throw apiError_('LOGIN_BLOCKED', 'Acceso bloqueado temporalmente. Intenta nuevamente mas tarde.');
  }

  if (hashPin_(match.record.id, pin) !== match.record.pin_hash) {
    const failedAttempts = Number(match.record.intentos_fallidos || 0) + 1;
    const updates = { intentos_fallidos: failedAttempts, actualizado_en: new Date() };
    if (failedAttempts >= API_MAX_LOGIN_ATTEMPTS) {
      updates.intentos_fallidos = 0;
      updates.bloqueado_hasta = new Date(Date.now() + API_LOGIN_BLOCK_MINUTES * 60000);
    }
    updateTableRow_(match.sheet, match.headers, match.record._row, updates);
    appendAudit_({
      request_id: requestId,
      usuario_id: match.record.id,
      accion: 'LOGIN_RECHAZADO',
      entidad: 'sesion',
      resultado: 'RECHAZADO',
    });
    throw genericError();
  }

  updateTableRow_(match.sheet, match.headers, match.record._row, {
    intentos_fallidos: 0,
    bloqueado_hasta: '',
    actualizado_en: new Date(),
  });
  return createSessionPayload_(match.record.id);
}

function createSessionPayload_(userId) {
  const token = `${Utilities.getUuid().replace(/-/g, '')}${Utilities.getUuid().replace(/-/g, '')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + API_SESSION_HOURS * 60 * 60 * 1000);
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('sesiones'), {
    id: Utilities.getUuid(),
    token_hash: hashToken_(token),
    usuario_id: userId,
    creado_en: now,
    expira_en: expiresAt,
    ultimo_uso_en: now,
  });
  const context = requireSession_(token);
  const payload = sessionPayload_(context);
  payload.token = token;
  payload.expiresAt = expiresAt.toISOString();
  return payload;
}

function requireSession_(token) {
  if (!token) throw apiError_('UNAUTHORIZED', 'Debes iniciar sesion.');
  const sessions = readTable_('sesiones');
  const tokenHash = hashToken_(token);
  const session = sessions.records.find((record) => record.token_hash === tokenHash);
  if (!session || session.revocado_en || !dateValue_(session.expira_en) || dateValue_(session.expira_en).getTime() <= Date.now()) {
    throw apiError_('SESSION_EXPIRED', 'La sesion vencio. Ingresa nuevamente.');
  }

  const users = readTable_('usuarios');
  const user = users.records.find((record) => record.id === session.usuario_id && record.activo === 'SI');
  if (!user) throw apiError_('UNAUTHORIZED', 'Usuario no habilitado.');

  const lastUse = dateValue_(session.ultimo_uso_en);
  if (!lastUse || Date.now() - lastUse.getTime() > 5 * 60 * 1000) {
    updateTableRow_(sessions.sheet, sessions.headers, session._row, { ultimo_uso_en: new Date() });
  }
  return { token, session, user };
}

function sessionPayload_(context) {
  return {
    user: publicUser_(context.user),
    stores: accessibleStores_(context.user),
  };
}

function logoutUser_(context, requestId) {
  const sessions = readTable_('sesiones');
  const session = sessions.records.find((record) => record.id === context.session.id);
  if (session) updateTableRow_(sessions.sheet, sessions.headers, session._row, { revocado_en: new Date() });
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    accion: 'CERRAR_SESION',
    entidad: 'sesion',
    entidad_id: context.session.id,
    resultado: 'EXITO',
  });
  return { loggedOut: true };
}

function accessibleStores_(user) {
  const stores = readTable_('locales').records.filter((store) => store.activo === 'SI');
  if (user.rol_global === 'SUPERADMIN') {
    return stores.map((store) => publicStore_(store, 'SUPERADMIN'));
  }

  const memberships = readTable_('usuarios_locales').records
    .filter((membership) => membership.usuario_id === user.id && membership.activo === 'SI');
  return stores
    .map((store) => {
      const membership = memberships.find((item) => item.local_id === store.id);
      return membership ? publicStore_(store, membership.rol) : null;
    })
    .filter(Boolean);
}

function requireStoreAccess_(user, storeId) {
  if (!storeId) throw apiError_('STORE_REQUIRED', 'Selecciona un local.');
  const store = accessibleStores_(user).find((item) => item.id === storeId);
  if (!store) throw apiError_('FORBIDDEN', 'No tienes acceso a este local.');
  return store;
}

function requireExpectedActor_(context, payload) {
  if (String(payload.actorId || '') !== context.user.id) {
    throw apiError_('SESSION_IDENTITY_CHANGED', 'La identidad de esta ventana cambio. Vuelve a iniciar sesion.');
  }
}

function requireStoreRole_(user, storeId, roles) {
  const store = requireStoreAccess_(user, storeId);
  if (roles.indexOf(store.role) === -1) {
    throw apiError_('FORBIDDEN', 'No tienes permisos para esta operacion en el local.');
  }
  return store;
}

function listPendingPurchases_(context, payload) {
  const store = requireStoreAccess_(context.user, String(payload.localId || ''));
  const activeStates = ['PENDIENTE', 'APROBADA', 'PEDIDA', 'EN_TRANSITO'];
  const purchases = readTable_('solicitudes_compra').records
    .filter((request) => request.local_id === store.id && activeStates.indexOf(request.estado) !== -1)
    .sort((left, right) => dateMillis_(right.solicitado_en) - dateMillis_(left.solicitado_en))
    .map((request) => publicPurchase_(request));
  return { purchases, store };
}

function publicPurchase_(request) {
  const usersById = userNamesById_();
  return {
    purchaseRequestId: request.id,
    taskId: request.tarea_id,
    localId: request.local_id,
    description: request.descripcion_snapshot,
    articleCode: request.articulo_codigo === '' ? null : String(request.articulo_codigo),
    barcode: request.codigo_barra === '' ? null : String(request.codigo_barra),
    quantity: request.cantidad_solicitada === '' ? null : String(request.cantidad_solicitada),
    unit: request.unidad || '',
    status: request.estado,
    priority: request.prioridad,
    supplier: request.proveedor || '',
    requestedBy: usersById[request.solicitado_por] || 'Usuario',
    requestedAt: dateIso_(request.solicitado_en),
    canOrder: ['PENDIENTE', 'APROBADA'].indexOf(request.estado) !== -1,
    canReceive: ['PEDIDA', 'EN_TRANSITO'].indexOf(request.estado) !== -1,
  };
}

function orderPurchase_(context, payload, requestId) {
  requireExpectedActor_(context, payload);
  const store = requireStoreRole_(context.user, String(payload.localId || ''), ['ENCARGADO', 'ADMINISTRADOR', 'SUPERADMIN']);
  const purchases = readTable_('solicitudes_compra');
  const request = purchases.records.find((record) => record.id === String(payload.purchaseRequestId || ''));
  if (!request || request.local_id !== store.id) throw apiError_('PURCHASE_NOT_FOUND', 'La solicitud de compra no existe.');
  if (['PEDIDA', 'EN_TRANSITO', 'RECIBIDA', 'CANCELADA'].indexOf(request.estado) !== -1) {
    return { purchase: publicPurchase_(request), alreadyOrdered: true };
  }
  if (request.estado !== 'PENDIENTE' && request.estado !== 'APROBADA') {
    throw apiError_('INVALID_PURCHASE_STATE', 'La compra no puede pedirse en su estado actual.');
  }

  const now = new Date();
  const updates = {
    estado: 'PEDIDA',
    asignado_a: context.user.id,
    actualizado_en: now,
  };
  updateTableRow_(purchases.sheet, purchases.headers, request._row, updates);
  const ordered = { ...request, ...updates };
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: store.id,
    accion: 'PEDIR_COMPRA',
    entidad: 'solicitud_compra',
    entidad_id: request.id,
    antes_json: JSON.stringify({ estado: request.estado }),
    despues_json: JSON.stringify({ estado: 'PEDIDA' }),
    resultado: 'EXITO',
  });
  return { purchase: publicPurchase_(ordered) };
}

function receivePurchase_(context, payload, requestId) {
  requireExpectedActor_(context, payload);
  const store = requireStoreRole_(context.user, String(payload.localId || ''), ['REPONEDOR', 'ENCARGADO', 'ADMINISTRADOR', 'SUPERADMIN']);
  const purchases = readTable_('solicitudes_compra');
  const request = purchases.records.find((record) => record.id === String(payload.purchaseRequestId || ''));
  if (!request || request.local_id !== store.id) throw apiError_('PURCHASE_NOT_FOUND', 'La solicitud de compra no existe.');
  if (request.estado === 'RECIBIDA') return { purchase: publicPurchase_(request), alreadyReceived: true };
  if (['PENDIENTE', 'APROBADA'].indexOf(request.estado) !== -1) {
    throw apiError_('PURCHASE_NOT_ORDERED', 'La compra todavia no fue pedida.');
  }
  if (request.estado === 'CANCELADA') throw apiError_('PURCHASE_CANCELLED', 'La compra fue cancelada.');

  const now = new Date();
  const receivedQuantity = optionalQuantity_(payload.quantity === undefined ? request.cantidad_solicitada : payload.quantity);
  updateTableRow_(purchases.sheet, purchases.headers, request._row, {
    estado: 'RECIBIDA',
    actualizado_en: now,
  });
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('recepciones_compra'), {
    id: Utilities.getUuid(),
    solicitud_id: request.id,
    local_id: store.id,
    articulo_codigo: request.articulo_codigo || '',
    codigo_barra: request.codigo_barra || '',
    descripcion_snapshot: request.descripcion_snapshot,
    cantidad_recibida: receivedQuantity,
    unidad: request.unidad || '',
    recibido_por: context.user.id,
    recibido_en: now,
    documento_referencia: optionalText_(payload.reference, 80),
    notas: '',
  });

  const tasks = readTable_('tareas_reposicion');
  const task = tasks.records.find((record) => record.id === request.tarea_id);
  if (task && ['SIN_STOCK_DEPOSITO', 'PENDIENTE_COMPRA'].indexOf(task.estado) !== -1) {
    const currentVersion = Number(task.version || 1);
    updateTableRow_(tasks.sheet, tasks.headers, task._row, {
      estado: 'PENDIENTE',
      version: currentVersion + 1,
      actualizado_en: now,
    });
    appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('eventos_reposicion'), {
      id: Utilities.getUuid(),
      tarea_id: task.id,
      local_id: task.local_id,
      usuario_id: context.user.id,
      tipo_evento: 'MERCADERIA_RECIBIDA',
      estado_anterior: task.estado,
      estado_nuevo: 'PENDIENTE',
      cantidad: receivedQuantity,
      ocurrido_en: now,
    });
  }

  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: store.id,
    accion: 'RECIBIR_COMPRA',
    entidad: 'solicitud_compra',
    entidad_id: request.id,
    antes_json: JSON.stringify({ estado: request.estado }),
    despues_json: JSON.stringify({ estado: 'RECIBIDA' }),
    resultado: 'EXITO',
  });
  return { purchase: publicPurchase_({ ...request, estado: 'RECIBIDA', actualizado_en: now }) };
}

function listTasks_(context, payload) {
  const store = requireStoreAccess_(context.user, String(payload.localId || ''));
  const usersById = {};
  readTable_('usuarios').records.forEach((user) => { usersById[user.id] = user.nombre; });
  const closedStates = ['COMPLETADA', 'VERIFICADA', 'CANCELADA', 'SIN_STOCK_DEPOSITO', 'PENDIENTE_COMPRA'];
  const tasks = readTable_('tareas_reposicion').records
    .filter((task) => task.local_id === store.id && closedStates.indexOf(task.estado) === -1)
    .sort((left, right) => dateMillis_(right.creado_en) - dateMillis_(left.creado_en))
    .map((task) => publicTask_(task, usersById));
  return { tasks, store };
}

function supervisionReport_(context, payload) {
  const scope = reportScope_(context.user, payload);
  const from = parseReportDay_(payload.from, 'from');
  const finalDay = parseReportDay_(payload.to, 'to');
  const to = new Date(finalDay.getTime() + 24 * 60 * 60 * 1000);
  if (to.getTime() <= from.getTime()) throw apiError_('INVALID_PERIOD', 'El final debe ser posterior al inicio.');
  if (to.getTime() - from.getTime() > 31 * 24 * 60 * 60 * 1000) {
    throw apiError_('INVALID_PERIOD', 'El periodo maximo es de 31 dias.');
  }

  const asOf = new Date();
  const selectedUserId = optionalText_(payload.userId, 80);
  const limit = Math.min(Math.max(Number(payload.limit) || 100, 20), 200);
  const users = readTable_('usuarios').records;
  const stores = readTable_('locales').records;
  const tasks = readTable_('tareas_reposicion').records;
  const events = readTable_('eventos_reposicion').records;
  const purchaseRequests = readTable_('solicitudes_compra').records;
  const memberships = readTable_('usuarios_locales').records;
  const usersById = {};
  const storesById = {};
  const tasksById = {};
  users.forEach((user) => { usersById[user.id] = user; });
  stores.forEach((store) => { storesById[store.id] = store; });
  tasks.forEach((task) => { tasksById[task.id] = task; });

  const scopedTasks = tasks.filter((task) => scope.localIds.indexOf(task.local_id) !== -1);
  const reportUserIds = new Set();
  memberships
    .filter((membership) => membership.activo === 'SI' && scope.localIds.indexOf(membership.local_id) !== -1)
    .forEach((membership) => reportUserIds.add(membership.usuario_id));
  events.filter((event) => scope.localIds.indexOf(event.local_id) !== -1)
    .forEach((event) => { if (event.usuario_id) reportUserIds.add(event.usuario_id); });
  scopedTasks.forEach((task) => {
    if (task.creado_por) reportUserIds.add(task.creado_por);
    if (task.asignado_a) reportUserIds.add(task.asignado_a);
  });
  if (selectedUserId && !reportUserIds.has(selectedUserId)) {
    throw apiError_('INVALID_USER_FILTER', 'El funcionario no pertenece al ambito seleccionado.');
  }
  const selectedTaskIds = new Set();
  if (selectedUserId) {
    scopedTasks.forEach((task) => {
      if (task.creado_por === selectedUserId || task.asignado_a === selectedUserId) selectedTaskIds.add(task.id);
    });
    events.forEach((event) => {
      if (scope.localIds.indexOf(event.local_id) !== -1 && event.usuario_id === selectedUserId) selectedTaskIds.add(event.tarea_id);
    });
  }
  const periodEvents = events
    .filter((event) => {
      const occurredAt = dateMillis_(event.ocurrido_en);
      return scope.localIds.indexOf(event.local_id) !== -1
        && occurredAt >= from.getTime()
        && occurredAt < to.getTime()
        && (!selectedUserId || event.usuario_id === selectedUserId);
    })
    .sort((left, right) => dateMillis_(right.ocurrido_en) - dateMillis_(left.ocurrido_en));

  const workerStats = {};
  const completionDurations = [];
  const taskSets = { CREADA: new Set(), COMPLETADA: new Set(), SIN_STOCK_DEPOSITO: new Set() };
  periodEvents.forEach((event) => {
    if (taskSets[event.tipo_evento]) taskSets[event.tipo_evento].add(event.tarea_id);
    if (!event.usuario_id) return;
    if (!workerStats[event.usuario_id]) {
      workerStats[event.usuario_id] = {
        userId: event.usuario_id,
        name: usersById[event.usuario_id] ? usersById[event.usuario_id].nombre : 'Usuario eliminado',
        tasksCreated: 0,
        tasksCompleted: 0,
        outOfStockReported: 0,
        openAssignedNow: 0,
      };
    }
    const stats = workerStats[event.usuario_id];
    if (event.tipo_evento === 'CREADA') stats.tasksCreated += 1;
    if (event.tipo_evento === 'SIN_STOCK_DEPOSITO') stats.outOfStockReported += 1;
    if (event.tipo_evento === 'COMPLETADA') {
      stats.tasksCompleted += 1;
      const task = tasksById[event.tarea_id];
      const createdAt = task ? dateMillis_(task.creado_en) : 0;
      if (createdAt && dateMillis_(event.ocurrido_en) >= createdAt) {
        const duration = (dateMillis_(event.ocurrido_en) - createdAt) / 60000;
        completionDurations.push(duration);
      }
    }
  });

  const closedStates = ['COMPLETADA', 'VERIFICADA', 'CANCELADA'];
  const openTasks = scopedTasks.filter((task) => closedStates.indexOf(task.estado) === -1);
  openTasks.forEach((task) => {
    if (!task.asignado_a || (selectedUserId && task.asignado_a !== selectedUserId)) return;
    if (!workerStats[task.asignado_a]) {
      workerStats[task.asignado_a] = {
        userId: task.asignado_a,
        name: usersById[task.asignado_a] ? usersById[task.asignado_a].nombre : 'Usuario eliminado',
        tasksCreated: 0,
        tasksCompleted: 0,
        outOfStockReported: 0,
        openAssignedNow: 0,
      };
    }
    workerStats[task.asignado_a].openAssignedNow += 1;
  });

  const activePurchaseStates = ['PENDIENTE', 'APROBADA', 'PEDIDA', 'EN_TRANSITO'];
  const scopedPurchases = purchaseRequests.filter((request) => (
    scope.localIds.indexOf(request.local_id) !== -1
    && activePurchaseStates.indexOf(request.estado) !== -1
    && (!selectedUserId || selectedTaskIds.has(request.tarea_id))
  ));
  const purchasesByTaskId = {};
  purchaseRequests
    .filter((request) => request.estado !== 'CANCELADA')
    .forEach((request) => {
      if (!purchasesByTaskId[request.tarea_id]) purchasesByTaskId[request.tarea_id] = [];
      purchasesByTaskId[request.tarea_id].push(request);
    });

  const outOfStockEvents = periodEvents.filter((event) => event.tipo_evento === 'SIN_STOCK_DEPOSITO');
  const outOfStockOpen = scopedTasks
    .filter((task) => ['SIN_STOCK_DEPOSITO', 'PENDIENTE_COMPRA'].indexOf(task.estado) !== -1)
    .filter((task) => !selectedUserId || selectedTaskIds.has(task.id));
  const warnings = [];

  const workers = Object.keys(workerStats).map((userId) => {
    const stats = workerStats[userId];
    return {
      userId: stats.userId,
      name: stats.name,
      tasksCreated: stats.tasksCreated,
      tasksCompleted: stats.tasksCompleted,
      outOfStockReported: stats.outOfStockReported,
      openAssignedNow: stats.openAssignedNow,
    };
  }).sort((left, right) => right.tasksCompleted - left.tasksCompleted || left.name.localeCompare(right.name));

  return {
    scope: {
      localIds: scope.localIds,
      from: from.toISOString(),
      to: to.toISOString(),
      timezone: DB_TIME_ZONE,
      asOf: asOf.toISOString(),
    },
    summary: {
      tasksCreated: taskSets.CREADA.size,
      tasksCompleted: taskSets.COMPLETADA.size,
      outOfStockIncidents: taskSets.SIN_STOCK_DEPOSITO.size,
      openTasksNow: openTasks.filter((task) => !selectedUserId || selectedTaskIds.has(task.id)).length,
      pendingPurchasesNow: scopedPurchases.length,
      averageCompletionMinutes: completionDurations.length
        ? Math.round(completionDurations.reduce((sum, value) => sum + value, 0) / completionDurations.length)
        : null,
    },
    people: [...reportUserIds]
      .map((userId) => usersById[userId])
      .filter(Boolean)
      .map((user) => ({ id: user.id, name: user.nombre }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    workers,
    outOfStock: {
      incidentTotal: outOfStockEvents.length,
      openTotal: outOfStockOpen.length,
      incidents: outOfStockEvents.slice(0, limit).map((event) => reportIncident_(event, tasksById, usersById, storesById, purchasesByTaskId)),
      openNow: outOfStockOpen.slice(0, limit).map((task) => {
        const requests = purchasesByTaskId[task.id] || [];
        if (!requests.length) warnings.push({ code: 'MISSING_PURCHASE_REQUEST', taskId: task.id });
        if (requests.length > 1) warnings.push({ code: 'MULTIPLE_ACTIVE_PURCHASE_REQUESTS', taskId: task.id });
        return {
          taskId: task.id,
          localId: task.local_id,
          storeName: storesById[task.local_id] ? storesById[task.local_id].nombre : 'Local eliminado',
          articleCode: task.articulo_codigo === '' ? null : String(task.articulo_codigo),
          barcode: task.codigo_barra === '' ? null : String(task.codigo_barra),
          description: task.descripcion_snapshot,
          quantity: task.cantidad_solicitada === '' ? null : task.cantidad_solicitada,
          status: task.estado,
          createdAt: dateIso_(task.creado_en),
          purchaseStatus: requests[0] ? requests[0].estado : null,
          dataIssue: !requests.length ? 'MISSING_PURCHASE_REQUEST' : requests.length > 1 ? 'MULTIPLE_ACTIVE_PURCHASE_REQUESTS' : null,
        };
      }),
    },
    pendingPurchases: {
      total: scopedPurchases.length,
      items: scopedPurchases.sort((left, right) => dateMillis_(left.solicitado_en) - dateMillis_(right.solicitado_en)).slice(0, limit).map((request) => ({
        purchaseRequestId: request.id,
        taskId: request.tarea_id,
        localId: request.local_id,
        storeName: storesById[request.local_id] ? storesById[request.local_id].nombre : 'Local eliminado',
        articleCode: request.articulo_codigo === '' ? null : String(request.articulo_codigo),
        barcode: request.codigo_barra === '' ? null : String(request.codigo_barra),
        description: request.descripcion_snapshot,
        requestedQuantity: request.cantidad_solicitada === '' ? null : request.cantidad_solicitada,
        unit: request.unidad || '',
        status: request.estado,
        priority: request.prioridad,
        supplier: request.proveedor || '',
        requestedBy: actor_(request.solicitado_por, usersById),
        requestedAt: dateIso_(request.solicitado_en),
        updatedAt: dateIso_(request.actualizado_en),
        ageHours: Math.max(0, Math.round((asOf.getTime() - dateMillis_(request.solicitado_en)) / 3600000)),
      })),
    },
    activity: {
      total: periodEvents.length,
      items: periodEvents.slice(0, limit).map((event) => reportActivity_(event, tasksById, usersById, storesById)),
    },
    warnings,
  };
}

function reportScope_(user, payload) {
  const localId = String(payload.localId || '');
  if (user.rol_global === 'SUPERADMIN') {
    const allStores = readTable_('locales').records;
    if (localId && !allStores.some((store) => store.id === localId)) {
      throw apiError_('STORE_NOT_FOUND', 'Local inexistente.');
    }
    return { localIds: localId ? [localId] : allStores.map((store) => store.id) };
  }

  if (!localId) throw apiError_('STORE_REQUIRED', 'Selecciona un local.');
  const store = requireStoreAccess_(user, localId);
  if (['ENCARGADO', 'ADMINISTRADOR'].indexOf(store.role) === -1) {
    throw apiError_('FORBIDDEN', 'No tienes permisos de supervision en este local.');
  }
  return { localIds: [localId] };
}

function parseReportDay_(value, field) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw apiError_('INVALID_PERIOD', `La fecha ${field} debe usar YYYY-MM-DD.`);
  }
  let date;
  try {
    date = Utilities.parseDate(`${text} 00:00:00`, DB_TIME_ZONE, 'yyyy-MM-dd HH:mm:ss');
  } catch (error) {
    throw apiError_('INVALID_PERIOD', `La fecha ${field} no es valida.`);
  }
  if (Number.isNaN(date.getTime())) throw apiError_('INVALID_PERIOD', `La fecha ${field} no es valida.`);
  if (Utilities.formatDate(date, DB_TIME_ZONE, 'yyyy-MM-dd') !== text) {
    throw apiError_('INVALID_PERIOD', `La fecha ${field} no es valida.`);
  }
  return date;
}

function reportIncident_(event, tasksById, usersById, storesById, purchasesByTaskId) {
  const task = tasksById[event.tarea_id] || {};
  const requests = purchasesByTaskId[event.tarea_id] || [];
  return {
    eventId: event.id,
    taskId: event.tarea_id,
    localId: event.local_id,
    storeName: storesById[event.local_id] ? storesById[event.local_id].nombre : 'Local eliminado',
    articleCode: task.articulo_codigo === '' || task.articulo_codigo === undefined ? null : String(task.articulo_codigo),
    barcode: task.codigo_barra === '' || task.codigo_barra === undefined ? null : String(task.codigo_barra),
    description: task.descripcion_snapshot || 'Articulo eliminado',
    reportedBy: actor_(event.usuario_id, usersById),
    reportedAt: dateIso_(event.ocurrido_en),
    taskStatusNow: task.estado || null,
    purchaseRequestId: requests[0] ? requests[0].id : null,
  };
}

function reportActivity_(event, tasksById, usersById, storesById) {
  const task = tasksById[event.tarea_id] || {};
  return {
    eventId: event.id,
    occurredAt: dateIso_(event.ocurrido_en),
    localId: event.local_id,
    storeName: storesById[event.local_id] ? storesById[event.local_id].nombre : 'Local eliminado',
    taskId: event.tarea_id,
    type: event.tipo_evento,
    description: task.descripcion_snapshot || event.detalle || 'Actividad',
    actor: actor_(event.usuario_id, usersById),
    previousStatus: event.estado_anterior || null,
    newStatus: event.estado_nuevo || null,
    quantity: event.cantidad === '' ? null : event.cantidad,
    unit: event.unidad || '',
  };
}

function actor_(userId, usersById) {
  if (!userId) return null;
  return { id: userId, name: usersById[userId] ? usersById[userId].nombre : 'Usuario eliminado' };
}

function createTask_(context, payload, requestId) {
  requireExpectedActor_(context, payload);
  const store = requireStoreAccess_(context.user, String(payload.localId || ''));
  const existing = readTable_('tareas_reposicion').records
    .find((task) => task.request_id === requestId);
  if (existing) return { task: publicTask_(existing, userNamesById_()), duplicated: true };

  const description = requiredText_(payload.description, 'descripcion', 300);
  const quantity = optionalQuantity_(payload.quantity);
  const articleCode = optionalText_(payload.articleCode, 80);
  const barcode = optionalText_(payload.barcode, 80);
  const now = new Date();
  const observationId = Utilities.getUuid();
  const clientTaskId = String(payload.clientTaskId || '');
  const taskId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clientTaskId)
    ? clientTaskId
    : Utilities.getUuid();

  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('observaciones_stock'), {
    id: observationId,
    request_id: requestId,
    local_id: store.id,
    articulo_codigo: articleCode,
    codigo_barra: barcode,
    descripcion_snapshot: description,
    estado_stock: 'FALTANTE_GONDOLA',
    usuario_id: context.user.id,
    observado_en: now,
    creado_en: now,
  });

  const taskRecord = {
    id: taskId,
    request_id: requestId,
    local_id: store.id,
    observacion_id: observationId,
    articulo_codigo: articleCode,
    codigo_barra: barcode,
    descripcion_snapshot: description,
    estado: 'PENDIENTE',
    prioridad: 'NORMAL',
    cantidad_solicitada: quantity,
    creado_por: context.user.id,
    creado_en: now,
    version: 1,
    actualizado_en: now,
  };
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('tareas_reposicion'), taskRecord);
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('eventos_reposicion'), {
    id: Utilities.getUuid(),
    tarea_id: taskId,
    local_id: store.id,
    usuario_id: context.user.id,
    tipo_evento: 'CREADA',
    estado_nuevo: 'PENDIENTE',
    cantidad: quantity,
    ocurrido_en: now,
  });
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: store.id,
    accion: 'CREAR_TAREA',
    entidad: 'tarea_reposicion',
    entidad_id: taskId,
    despues_json: JSON.stringify(taskRecord),
    resultado: 'EXITO',
  });
  return { task: publicTask_(taskRecord, userNamesById_()) };
}

function completeTask_(context, payload, requestId) {
  requireExpectedActor_(context, payload);
  const tasks = readTable_('tareas_reposicion');
  const task = tasks.records.find((record) => record.id === String(payload.taskId || ''));
  if (!task) throw apiError_('TASK_NOT_FOUND', 'La tarea ya no existe.');
  requireStoreAccess_(context.user, task.local_id);

  const expectedVersion = Number(payload.expectedVersion);
  const currentVersion = Number(task.version || 1);
  if (expectedVersion !== currentVersion) {
    throw apiError_('VERSION_CONFLICT', 'La tarea cambio en otro dispositivo. Actualiza la lista.');
  }
  if (['COMPLETADA', 'VERIFICADA', 'CANCELADA'].indexOf(task.estado) !== -1) {
    return { taskId: task.id, alreadyClosed: true };
  }
  if (task.estado === 'SIN_STOCK_DEPOSITO') {
    throw apiError_('PURCHASE_PENDING', 'La tarea tiene una compra pendiente y no puede cerrarse como repuesta.');
  }

  const now = new Date();
  const quantity = optionalQuantity_(payload.quantity === undefined ? task.cantidad_solicitada : payload.quantity);
  const updates = {
    estado: 'COMPLETADA',
    cantidad_repuesta: quantity,
    asignado_a: task.asignado_a || context.user.id,
    iniciado_en: task.iniciado_en || now,
    completado_en: now,
    version: currentVersion + 1,
    actualizado_en: now,
  };
  updateTableRow_(tasks.sheet, tasks.headers, task._row, updates);
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('eventos_reposicion'), {
    id: Utilities.getUuid(),
    tarea_id: task.id,
    local_id: task.local_id,
    usuario_id: context.user.id,
    tipo_evento: 'COMPLETADA',
    estado_anterior: task.estado,
    estado_nuevo: 'COMPLETADA',
    cantidad: quantity,
    ocurrido_en: now,
  });
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: task.local_id,
    accion: 'COMPLETAR_TAREA',
    entidad: 'tarea_reposicion',
    entidad_id: task.id,
    antes_json: JSON.stringify(task),
    despues_json: JSON.stringify(updates),
    resultado: 'EXITO',
  });
  return { taskId: task.id, version: currentVersion + 1 };
}

function markTaskOutOfStock_(context, payload, requestId) {
  requireExpectedActor_(context, payload);
  const tasks = readTable_('tareas_reposicion');
  const task = tasks.records.find((record) => record.id === String(payload.taskId || ''));
  if (!task) throw apiError_('TASK_NOT_FOUND', 'La tarea ya no existe.');
  requireStoreAccess_(context.user, task.local_id);

  const expectedVersion = Number(payload.expectedVersion);
  const currentVersion = Number(task.version || 1);
  if (['SIN_STOCK_DEPOSITO', 'PENDIENTE_COMPRA'].indexOf(task.estado) !== -1) {
    const purchaseRequestCreated = ensureOutOfStockRecords_(task, context.user.id, requestId, new Date());
    return { task: publicTask_(task, userNamesById_()), alreadyMarked: true, purchaseRequestCreated };
  }
  if (expectedVersion !== currentVersion) {
    throw apiError_('VERSION_CONFLICT', 'La tarea cambio en otro dispositivo. Actualiza la lista.');
  }
  if (['COMPLETADA', 'VERIFICADA', 'CANCELADA'].indexOf(task.estado) !== -1) {
    throw apiError_('TASK_CLOSED', 'La tarea ya fue cerrada.');
  }

  const now = new Date();
  const purchaseRequestCreated = ensureOutOfStockRecords_(task, context.user.id, requestId, now);
  const updates = {
    estado: 'PENDIENTE_COMPRA',
    version: currentVersion + 1,
    actualizado_en: now,
  };
  updateTableRow_(tasks.sheet, tasks.headers, task._row, updates);
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('eventos_reposicion'), {
    id: Utilities.getUuid(),
    tarea_id: task.id,
    local_id: task.local_id,
    usuario_id: context.user.id,
    tipo_evento: 'SIN_STOCK_DEPOSITO',
    estado_anterior: task.estado,
    estado_nuevo: 'PENDIENTE_COMPRA',
    ocurrido_en: now,
  });

  return {
    task: publicTask_({ ...task, ...updates }, userNamesById_()),
    purchaseRequestCreated,
  };
}

function ensureOutOfStockRecords_(task, userId, requestId, now) {
  const purchaseRequests = readTable_('solicitudes_compra');
  const existingRequest = purchaseRequests.records.find((request) => (
    request.tarea_id === task.id && request.estado !== 'CANCELADA'
  ));
  if (!existingRequest) {
    appendDatabaseRecord_(purchaseRequests.sheet, {
      id: Utilities.getUuid(),
      local_id: task.local_id,
      tarea_id: task.id,
      articulo_codigo: task.articulo_codigo || '',
      codigo_barra: task.codigo_barra || '',
      descripcion_snapshot: task.descripcion_snapshot,
      cantidad_solicitada: task.cantidad_solicitada,
      unidad: task.unidad || '',
      estado: 'PENDIENTE',
      prioridad: task.prioridad || 'NORMAL',
      solicitado_por: userId,
      solicitado_en: now,
      actualizado_en: now,
      notas: 'Generada al informar falta de stock en deposito',
    });
  }

  appendAudit_({
    request_id: requestId,
    usuario_id: userId,
    local_id: task.local_id,
    accion: 'INFORMAR_SIN_STOCK',
    entidad: 'tarea_reposicion',
    entidad_id: task.id,
    despues_json: JSON.stringify({ estado: 'PENDIENTE_COMPRA' }),
    resultado: 'EXITO',
  });
  return !existingRequest;
}

function listUsers_(context) {
  requireSuperadmin_(context.user);
  const memberships = readTable_('usuarios_locales').records;
  return {
    users: readTable_('usuarios').records.map((user) => ({
      ...publicUser_(user),
      cedula: user.cedula,
      active: user.activo === 'SI',
      pinStatus: user.pin_estado || 'PENDIENTE',
      memberships: memberships
        .filter((membership) => membership.usuario_id === user.id && membership.activo === 'SI')
        .map((membership) => ({ storeId: membership.local_id, role: membership.rol })),
    })),
  };
}

function createUser_(context, payload, requestId) {
  requireSuperadmin_(context.user);
  const cedula = validateCedula_(payload.cedula);
  if (findUserByCedula_(cedula)) throw apiError_('DUPLICATE_USER', 'Ya existe un usuario con esa cedula.');
  if (payload.storeId) {
    const allowedRoles = ['REPONEDOR', 'ENCARGADO', 'ADMINISTRADOR'];
    if (allowedRoles.indexOf(String(payload.role || '').toUpperCase()) === -1) {
      throw apiError_('INVALID_ROLE', 'Rol local invalido.');
    }
    if (!readTable_('locales').records.some((store) => store.id === payload.storeId && store.activo === 'SI')) {
      throw apiError_('STORE_NOT_FOUND', 'Local inexistente.');
    }
  }
  const now = new Date();
  const activationCode = generateActivationCode_();
  const userId = Utilities.getUuid();
  const record = {
    id: userId,
    cedula,
    email: optionalText_(payload.email, 200).toLowerCase(),
    nombre: requiredText_(payload.name, 'nombre', 160),
    rol_global: payload.globalRole === 'SUPERADMIN' ? 'SUPERADMIN' : 'USUARIO',
    activo: 'SI',
    pin_estado: 'PENDIENTE',
    activation_hash: hashActivationCode_(userId, activationCode),
    activation_expires_en: new Date(now.getTime() + 24 * 60 * 60 * 1000),
    intentos_fallidos: 0,
    creado_en: now,
    actualizado_en: now,
  };
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('usuarios'), record);
  if (payload.storeId) {
    assignMembership_(context, {
      userId: record.id,
      storeId: payload.storeId,
      role: payload.role || 'REPONEDOR',
    }, requestId);
  }
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    accion: 'CREAR_USUARIO',
    entidad: 'usuario',
    entidad_id: record.id,
    despues_json: JSON.stringify({ ...record, pin_hash: undefined }),
    resultado: 'EXITO',
  });
  return {
    user: {
      ...publicUser_(record),
      cedula,
      active: true,
      pinStatus: 'PENDIENTE',
      memberships: payload.storeId ? [{ storeId: payload.storeId, role: payload.role || 'REPONEDOR' }] : [],
    },
    activationCode,
  };
}

function enablePinReset_(context, payload, requestId) {
  requireSuperadmin_(context.user);
  const users = readTable_('usuarios');
  const user = users.records.find((record) => record.id === String(payload.userId || ''));
  if (!user) throw apiError_('USER_NOT_FOUND', 'Usuario inexistente.');
  const activationCode = generateActivationCode_();
  updateTableRow_(users.sheet, users.headers, user._row, {
    pin_hash: '',
    pin_estado: 'RESET_HABILITADO',
    activation_hash: hashActivationCode_(user.id, activationCode),
    activation_expires_en: new Date(Date.now() + 24 * 60 * 60 * 1000),
    intentos_fallidos: 0,
    bloqueado_hasta: '',
    actualizado_en: new Date(),
  });
  revokeUserSessions_(user.id);
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    accion: 'HABILITAR_RESET_PIN',
    entidad: 'usuario',
    entidad_id: user.id,
    resultado: 'EXITO',
  });
  return { userId: user.id, pinStatus: 'RESET_HABILITADO', activationCode };
}

function createStore_(context, payload, requestId) {
  requireSuperadmin_(context.user);
  const stores = readTable_('locales');
  const code = requiredText_(payload.code, 'codigo', 40).toUpperCase();
  if (stores.records.some((store) => String(store.codigo).toUpperCase() === code)) {
    throw apiError_('DUPLICATE_STORE', 'Ya existe un local con ese codigo.');
  }
  const now = new Date();
  const record = {
    id: Utilities.getUuid(),
    codigo: code,
    nombre: requiredText_(payload.name, 'nombre', 120),
    direccion: optionalText_(payload.address, 250),
    activo: 'SI',
    creado_en: now,
    actualizado_en: now,
  };
  appendDatabaseRecord_(stores.sheet, record);
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: record.id,
    accion: 'CREAR_LOCAL',
    entidad: 'local',
    entidad_id: record.id,
    despues_json: JSON.stringify(record),
    resultado: 'EXITO',
  });
  return { store: publicStore_(record, 'SUPERADMIN') };
}

function assignMembership_(context, payload, requestId) {
  requireSuperadmin_(context.user);
  const userId = String(payload.userId || '');
  const storeId = String(payload.storeId || '');
  const role = String(payload.role || '').toUpperCase();
  const allowedRoles = ['REPONEDOR', 'ENCARGADO', 'ADMINISTRADOR'];
  if (allowedRoles.indexOf(role) === -1) throw apiError_('INVALID_ROLE', 'Rol local invalido.');
  if (!readTable_('usuarios').records.some((user) => user.id === userId)) {
    throw apiError_('USER_NOT_FOUND', 'Usuario inexistente.');
  }
  if (!readTable_('locales').records.some((store) => store.id === storeId && store.activo === 'SI')) {
    throw apiError_('STORE_NOT_FOUND', 'Local inexistente.');
  }

  const memberships = readTable_('usuarios_locales');
  const existing = memberships.records.find((item) => item.usuario_id === userId && item.local_id === storeId);
  const now = new Date();
  if (existing) {
    updateTableRow_(memberships.sheet, memberships.headers, existing._row, {
      rol: role,
      activo: 'SI',
      actualizado_en: now,
    });
  } else {
    appendDatabaseRecord_(memberships.sheet, {
      id: Utilities.getUuid(),
      usuario_id: userId,
      local_id: storeId,
      rol: role,
      activo: 'SI',
      creado_en: now,
      actualizado_en: now,
    });
  }
  appendAudit_({
    request_id: requestId,
    usuario_id: context.user.id,
    local_id: storeId,
    accion: 'ASIGNAR_USUARIO_LOCAL',
    entidad: 'usuario_local',
    entidad_id: existing ? existing.id : userId,
    despues_json: JSON.stringify({ userId, storeId, role }),
    resultado: 'EXITO',
  });
  return { userId, storeId, role };
}

function requireSuperadmin_(user) {
  if (user.rol_global !== 'SUPERADMIN') throw apiError_('FORBIDDEN', 'Acceso reservado al superadmin.');
}

function revokeUserSessions_(userId) {
  const sessions = readTable_('sesiones');
  const now = new Date();
  sessions.records
    .filter((session) => session.usuario_id === userId && !session.revocado_en)
    .forEach((session) => updateTableRow_(sessions.sheet, sessions.headers, session._row, { revocado_en: now }));
}

function findUserByCedula_(cedula) {
  const users = readTable_('usuarios');
  const record = users.records.find((user) => normalizeCedula_(user.cedula) === cedula);
  return record ? { sheet: users.sheet, headers: users.headers, record } : null;
}

function readTable_(sheetName) {
  const sheet = getDatabaseSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw apiError_('DATABASE_SCHEMA_ERROR', `Falta la hoja ${sheetName}.`);
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map((header) => String(header).trim());
  if (sheet.getLastRow() < 2) return { sheet, headers, records: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
  const records = values
    .map((row, index) => {
      const record = { _row: index + 2 };
      headers.forEach((header, column) => { if (header) record[header] = row[column]; });
      return record;
    })
    .filter((record) => headers.some((header) => header && record[header] !== ''));
  return { sheet, headers, records };
}

function updateTableRow_(sheet, headers, rowNumber, updates) {
  Object.keys(updates).forEach((header) => {
    const column = headers.indexOf(header);
    if (column === -1) throw apiError_('DATABASE_SCHEMA_ERROR', `Falta la columna ${header}.`);
    sheet.getRange(rowNumber, column + 1).setValue(safeCellValue_(updates[header]));
  });
}

function appendAudit_(record) {
  appendDatabaseRecord_(getDatabaseSpreadsheet_().getSheetByName('auditoria'), {
    id: Utilities.getUuid(),
    request_id: record.request_id || '',
    usuario_id: record.usuario_id || '',
    local_id: record.local_id || '',
    accion: record.accion,
    entidad: record.entidad,
    entidad_id: record.entidad_id || '',
    antes_json: record.antes_json || '',
    despues_json: record.despues_json || '',
    resultado: record.resultado,
    ocurrido_en: new Date(),
  });
}

function publicUser_(user) {
  return {
    id: user.id,
    name: user.nombre,
    globalRole: user.rol_global || 'USUARIO',
  };
}

function publicStore_(store, role) {
  return { id: store.id, code: store.codigo, name: store.nombre, address: store.direccion || '', role };
}

function publicTask_(task, usersById) {
  return {
    id: task.id,
    localId: task.local_id,
    name: task.descripcion_snapshot,
    quantity: task.cantidad_solicitada === '' ? null : String(task.cantidad_solicitada),
    articleCode: task.articulo_codigo === '' ? null : String(task.articulo_codigo),
    barcode: task.codigo_barra === '' ? null : String(task.codigo_barra),
    status: task.estado,
    priority: task.prioridad,
    version: Number(task.version || 1),
    createdAt: dateIso_(task.creado_en),
    createdBy: usersById[task.creado_por] || 'Usuario',
  };
}

function userNamesById_() {
  const names = {};
  readTable_('usuarios').records.forEach((user) => { names[user.id] = user.nombre; });
  return names;
}

function validateCedula_(value) {
  const cedula = normalizeCedula_(value);
  if (!/^\d{6,12}$/.test(cedula)) throw apiError_('INVALID_CEDULA', 'Ingresa una cedula valida.');
  return cedula;
}

function normalizeCedula_(value) {
  return String(value || '').replace(/\D/g, '');
}

function validatePin_(value) {
  const pin = String(value || '');
  if (!/^\d{6}$/.test(pin)) throw apiError_('INVALID_PIN', 'El PIN debe tener 6 numeros.');
  return pin;
}

function validateActivationCode_(value) {
  const code = String(value || '');
  if (!/^\d{6}$/.test(code)) throw apiError_('INVALID_ACTIVATION', 'El codigo de activacion debe tener 6 numeros.');
  return code;
}

function requiredText_(value, field, maxLength) {
  const text = optionalText_(value, maxLength);
  if (!text) throw apiError_('INVALID_FIELD', `El campo ${field} es obligatorio.`);
  return text;
}

function optionalText_(value, maxLength) {
  const text = String(value || '').trim();
  if (text.length > maxLength) throw apiError_('INVALID_FIELD', 'Uno de los textos es demasiado largo.');
  return safeCellValue_(text);
}

function optionalQuantity_(value) {
  if (value === undefined || value === null || value === '') return '';
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity < 0) throw apiError_('INVALID_QUANTITY', 'Cantidad invalida.');
  return quantity;
}

function safeCellValue_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function hashToken_(token) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(token)),
  );
}

function dateValue_(value) {
  if (value instanceof Date) return value;
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function dateMillis_(value) {
  const date = dateValue_(value);
  return date ? date.getTime() : 0;
}

function dateIso_(value) {
  const date = dateValue_(value);
  return date ? date.toISOString() : null;
}

function withApiLock_(callback) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function apiError_(code, publicMessage) {
  const error = new Error(publicMessage);
  error.code = code;
  error.publicMessage = publicMessage;
  return error;
}

function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body))
    .setMimeType(ContentService.MimeType.JSON);
}
