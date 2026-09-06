const DB_PROPERTY_SPREADSHEET_ID = 'operationsDatabaseSpreadsheetId';
const DB_NAME = 'Reposicion - Base de datos';
const DB_SCHEMA_VERSION = '3';
const DB_TIME_ZONE = 'America/Montevideo';

const DB_SCHEMA = {
  configuracion: {
    headers: ['clave', 'valor', 'descripcion', 'actualizado_en'],
  },
  locales: {
    headers: ['id', 'codigo', 'nombre', 'direccion', 'activo', 'creado_en', 'actualizado_en'],
    validations: { activo: ['SI', 'NO'] },
  },
  usuarios: {
    headers: [
      'id', 'cedula', 'email', 'nombre', 'rol_global', 'activo', 'pin_hash',
      'pin_estado', 'activation_hash', 'activation_expires_en',
      'intentos_fallidos', 'bloqueado_hasta', 'creado_en', 'actualizado_en',
    ],
    validations: {
      rol_global: ['USUARIO', 'SUPERADMIN'],
      activo: ['SI', 'NO'],
      pin_estado: ['PENDIENTE', 'ACTIVO', 'RESET_HABILITADO'],
    },
  },
  usuarios_locales: {
    headers: ['id', 'usuario_id', 'local_id', 'rol', 'activo', 'creado_en', 'actualizado_en'],
    validations: {
      rol: ['REPONEDOR', 'ENCARGADO', 'COMPRADOR', 'ADMINISTRADOR'],
      activo: ['SI', 'NO'],
    },
  },
  turnos: {
    headers: ['id', 'local_id', 'usuario_id', 'estado', 'inicio_en', 'fin_en', 'notas', 'creado_en'],
    validations: { estado: ['ABIERTO', 'CERRADO', 'CANCELADO'] },
  },
  observaciones_stock: {
    headers: [
      'id', 'request_id', 'local_id', 'turno_id', 'articulo_codigo', 'codigo_barra', 'descripcion_snapshot',
      'estado_stock', 'cantidad_observada', 'unidad', 'sector', 'notas',
      'usuario_id', 'observado_en', 'creado_en',
    ],
    validations: {
      estado_stock: ['SUFICIENTE', 'POCO_STOCK', 'FALTANTE_GONDOLA', 'FALTANTE_TOTAL', 'SIN_VERIFICAR'],
    },
    nonNegative: ['cantidad_observada'],
  },
  tareas_reposicion: {
    headers: [
      'id', 'request_id', 'local_id', 'observacion_id', 'articulo_codigo', 'codigo_barra',
      'descripcion_snapshot', 'estado', 'prioridad', 'cantidad_solicitada',
      'cantidad_repuesta', 'unidad', 'asignado_a', 'creado_por', 'creado_en',
      'iniciado_en', 'completado_en', 'verificado_por', 'verificado_en', 'notas',
      'version', 'actualizado_en',
    ],
    validations: {
      estado: [
        'PENDIENTE', 'ASIGNADA', 'EN_CURSO', 'SIN_STOCK_DEPOSITO',
        'PENDIENTE_COMPRA', 'COMPLETADA', 'VERIFICADA', 'CANCELADA',
      ],
      prioridad: ['BAJA', 'NORMAL', 'ALTA', 'CRITICA'],
    },
    nonNegative: ['cantidad_solicitada', 'cantidad_repuesta'],
  },
  eventos_reposicion: {
    headers: [
      'id', 'tarea_id', 'local_id', 'turno_id', 'usuario_id', 'tipo_evento', 'estado_anterior',
      'estado_nuevo', 'cantidad', 'unidad', 'detalle', 'ocurrido_en',
    ],
    nonNegative: ['cantidad'],
  },
  solicitudes_compra: {
    headers: [
      'id', 'local_id', 'tarea_id', 'articulo_codigo', 'codigo_barra',
      'descripcion_snapshot', 'cantidad_solicitada', 'unidad', 'estado', 'prioridad',
      'proveedor', 'solicitado_por', 'asignado_a', 'solicitado_en', 'actualizado_en', 'notas',
    ],
    validations: {
      estado: ['BORRADOR', 'PENDIENTE', 'APROBADA', 'PEDIDA', 'EN_TRANSITO', 'RECIBIDA', 'CANCELADA'],
      prioridad: ['BAJA', 'NORMAL', 'ALTA', 'CRITICA'],
    },
    nonNegative: ['cantidad_solicitada'],
  },
  recepciones_compra: {
    headers: [
      'id', 'solicitud_id', 'local_id', 'articulo_codigo', 'codigo_barra',
      'descripcion_snapshot', 'cantidad_recibida', 'unidad', 'recibido_por',
      'recibido_en', 'documento_referencia', 'notas',
    ],
    nonNegative: ['cantidad_recibida'],
  },
  sesiones: {
    headers: [
      'id', 'token_hash', 'usuario_id', 'creado_en', 'expira_en',
      'revocado_en', 'ultimo_uso_en',
    ],
  },
  auditoria: {
    headers: [
      'id', 'request_id', 'usuario_id', 'local_id', 'accion', 'entidad',
      'entidad_id', 'antes_json', 'despues_json', 'resultado', 'ocurrido_en',
    ],
    validations: { resultado: ['EXITO', 'RECHAZADO', 'ERROR'] },
  },
};

/**
 * Creates the operational database or updates its structure without deleting data.
 * Run this function manually once from the Apps Script editor.
 */
function setupDatabase() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);

  try {
    const result = openOrCreateDatabase_();
    const spreadsheet = result.spreadsheet;

    spreadsheet.setSpreadsheetTimeZone(DB_TIME_ZONE);
    spreadsheet.setSpreadsheetLocale('es_UY');

    Object.keys(DB_SCHEMA).forEach((sheetName) => {
      ensureDatabaseSheet_(spreadsheet, sheetName, DB_SCHEMA[sheetName]);
    });

    seedDatabaseConfiguration_(spreadsheet);
    seedInitialSuperadmin_(spreadsheet);
    removeInitialSheet_(spreadsheet, result.created);
    SpreadsheetApp.flush();

    const validation = validateDatabase_(spreadsheet);
    const info = {
      spreadsheetId: spreadsheet.getId(),
      spreadsheetUrl: spreadsheet.getUrl(),
      schemaVersion: DB_SCHEMA_VERSION,
      sheets: validation.sheets,
    };
    console.log(JSON.stringify(info, null, 2));
    return info;
  } finally {
    lock.releaseLock();
  }
}

/** Returns the current database location and verifies its schema. */
function getDatabaseInfo() {
  const spreadsheet = getDatabaseSpreadsheet_();
  const validation = validateDatabase_(spreadsheet);
  return {
    spreadsheetId: spreadsheet.getId(),
    spreadsheetUrl: spreadsheet.getUrl(),
    schemaVersion: DB_SCHEMA_VERSION,
    sheets: validation.sheets,
  };
}

function openOrCreateDatabase_() {
  const properties = PropertiesService.getScriptProperties();
  const spreadsheetId = properties.getProperty(DB_PROPERTY_SPREADSHEET_ID);

  if (spreadsheetId) {
    return { spreadsheet: openDatabaseById_(spreadsheetId), created: false };
  }

  const spreadsheet = SpreadsheetApp.create(DB_NAME);
  properties.setProperty(DB_PROPERTY_SPREADSHEET_ID, spreadsheet.getId());
  return { spreadsheet, created: true };
}

function getDatabaseSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(DB_PROPERTY_SPREADSHEET_ID);
  if (!spreadsheetId) {
    throw new Error('La base no existe. Ejecute setupDatabase primero.');
  }
  return openDatabaseById_(spreadsheetId);
}

function openDatabaseById_(spreadsheetId) {
  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      `No se pudo abrir la base ${spreadsheetId}. Verifique que exista y que el propietario del script tenga acceso.`,
    );
  }
}

function ensureDatabaseSheet_(spreadsheet, sheetName, definition) {
  const sheet = spreadsheet.getSheetByName(sheetName) || spreadsheet.insertSheet(sheetName);
  if (sheet.getMaxRows() < 2) sheet.insertRowsAfter(1, 1);
  const headers = ensureHeaders_(sheet, definition.headers);

  sheet.setFrozenRows(1);
  sheet.setHiddenGridlines(true);
  formatHeader_(sheet, headers.length);
  formatColumns_(sheet, headers);
  applyValidations_(sheet, headers, definition.validations || {});
  applyNumericValidations_(sheet, headers, definition.nonNegative || []);
  ensureFilter_(sheet, headers.length);
}

function ensureHeaders_(sheet, expectedHeaders) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const currentHeaders = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map((header) => String(header).trim());
  const hasHeaders = currentHeaders.some((header) => header !== '');

  if (!hasHeaders) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    return expectedHeaders.slice();
  }

  const populatedHeaders = currentHeaders.filter((header) => header !== '');
  const duplicateHeaders = populatedHeaders.filter((header, index) => populatedHeaders.indexOf(header) !== index);
  if (duplicateHeaders.length) {
    throw new Error(`${sheet.getName()}: hay encabezados duplicados: ${[...new Set(duplicateHeaders)].join(', ')}`);
  }

  const missingHeaders = expectedHeaders.filter((header) => currentHeaders.indexOf(header) === -1);
  if (missingHeaders.length) {
    sheet.getRange(1, lastColumn + 1, 1, missingHeaders.length).setValues([missingHeaders]);
  }
  return currentHeaders.concat(missingHeaders);
}

function formatHeader_(sheet, columnCount) {
  sheet.getRange(1, 1, 1, columnCount)
    .setBackground('#1d4ed8')
    .setFontColor('#ffffff')
    .setFontWeight('bold')
    .setHorizontalAlignment('center')
    .setWrap(true);
  sheet.setRowHeight(1, 36);
}

function formatColumns_(sheet, headers) {
  const bodyRowCount = Math.max(sheet.getMaxRows() - 1, 1);

  headers.forEach((header, index) => {
    const column = index + 1;
    const range = sheet.getRange(2, column, bodyRowCount, 1);

    if (header === 'id' || /_id$/.test(header) || header === 'articulo_codigo' || header === 'codigo_barra') {
      range.setNumberFormat('@');
    } else if (/_en$/.test(header)) {
      range.setNumberFormat('yyyy-mm-dd hh:mm:ss');
    } else if (/^cantidad_/.test(header) || header === 'cantidad') {
      range.setNumberFormat('0.###');
    }

    const wideColumn = header === 'descripcion_snapshot' || header === 'notas' || header === 'detalle';
    sheet.setColumnWidth(column, wideColumn ? 280 : 140);
  });
}

function applyValidations_(sheet, headers, validations) {
  const bodyRowCount = Math.max(sheet.getMaxRows() - 1, 1);

  Object.keys(validations).forEach((header) => {
    const columnIndex = headers.indexOf(header);
    if (columnIndex === -1) return;

    const rule = SpreadsheetApp.newDataValidation()
      .requireValueInList(validations[header], true)
      .setAllowInvalid(false)
      .setHelpText(`Valores permitidos: ${validations[header].join(', ')}`)
      .build();
    sheet.getRange(2, columnIndex + 1, bodyRowCount, 1).setDataValidation(rule);
  });
}

function applyNumericValidations_(sheet, headers, columns) {
  const bodyRowCount = Math.max(sheet.getMaxRows() - 1, 1);
  const rule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThanOrEqualTo(0)
    .setAllowInvalid(false)
    .setHelpText('Ingrese un numero mayor o igual a cero')
    .build();

  columns.forEach((header) => {
    const columnIndex = headers.indexOf(header);
    if (columnIndex !== -1) {
      sheet.getRange(2, columnIndex + 1, bodyRowCount, 1).setDataValidation(rule);
    }
  });
}

function ensureFilter_(sheet, columnCount) {
  const currentFilter = sheet.getFilter();
  if (!currentFilter) {
    sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).createFilter();
    return;
  }

  const currentRange = currentFilter.getRange();
  if (currentRange.getNumColumns() === columnCount && currentRange.getNumRows() === sheet.getMaxRows()) return;

  const criteria = [];
  for (let column = 1; column <= currentRange.getNumColumns(); column += 1) {
    criteria.push(currentFilter.getColumnFilterCriteria(column));
  }
  currentFilter.remove();
  const newFilter = sheet.getRange(1, 1, sheet.getMaxRows(), columnCount).createFilter();
  criteria.forEach((criterion, index) => {
    if (criterion && index < columnCount) newFilter.setColumnFilterCriteria(index + 1, criterion);
  });
}

function seedDatabaseConfiguration_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('configuracion');
  const existingKeys = new Map();
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getDisplayValues()
      .forEach((row, index) => existingKeys.set(String(row[0]).trim(), index + 2));
  }

  const now = new Date();
  if (existingKeys.has('schema_version')) {
    sheet.getRange(existingKeys.get('schema_version'), 2, 1, 3)
      .setValues([[DB_SCHEMA_VERSION, 'Version de la estructura de datos', now]]);
  }

  const defaults = [
    ['schema_version', DB_SCHEMA_VERSION, 'Version de la estructura de datos', now],
    ['timezone', DB_TIME_ZONE, 'Zona horaria usada por el sistema', now],
    ['catalog_source', 'XLSX', 'El catalogo de articulos se mantiene en el archivo XLSX', now],
    ['stock_data_kind', 'OBSERVADO', 'Las cantidades son observaciones, no stock contable', now],
  ].filter((row) => !existingKeys.has(row[0]));

  if (defaults.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, defaults.length, defaults[0].length)
      .setValues(defaults);
  }
}

function seedInitialSuperadmin_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName('usuarios');
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map((header) => String(header).trim());
  const emailColumn = headers.indexOf('email');
  const roleColumn = headers.indexOf('rol_global');
  const activeColumn = headers.indexOf('activo');
  const pinHashColumn = headers.indexOf('pin_hash');
  const pinStatusColumn = headers.indexOf('pin_estado');
  const activationHashColumn = headers.indexOf('activation_hash');
  const activationExpiresColumn = headers.indexOf('activation_expires_en');
  const updatedAtColumn = headers.indexOf('actualizado_en');
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    : [];
  const superadminIndex = rows.findIndex((row) => (
    row[roleColumn] === 'SUPERADMIN' && row[activeColumn] === 'SI'
  ));

  const email = Session.getEffectiveUser().getEmail();
  if (!email) {
    console.warn('Google no informo el correo del usuario. Cree manualmente el primer SUPERADMIN.');
    return;
  }

  const now = new Date();
  const existingUserIndex = rows.findIndex((row) => (
    String(row[emailColumn]).trim().toLowerCase() === email.toLowerCase()
  ));
  let userIndex = existingUserIndex;

  if (superadminIndex === -1 && existingUserIndex === -1) {
    const userId = Utilities.getUuid();
    appendDatabaseRecord_(sheet, {
      id: userId,
      cedula: '',
      email: email.toLowerCase(),
      nombre: email,
      rol_global: 'SUPERADMIN',
      activo: 'SI',
      pin_estado: 'PENDIENTE',
      intentos_fallidos: 0,
      creado_en: now,
      actualizado_en: now,
    });
    userIndex = sheet.getLastRow() - 2;
  } else if (superadminIndex === -1) {
    userIndex = existingUserIndex;
    const rowNumber = userIndex + 2;
    sheet.getRange(rowNumber, roleColumn + 1).setValue('SUPERADMIN');
    sheet.getRange(rowNumber, activeColumn + 1).setValue('SI');
    sheet.getRange(rowNumber, updatedAtColumn + 1).setValue(now);
  } else {
    userIndex = superadminIndex;
  }

  const rowNumber = userIndex + 2;
  const cedula = sheet.getRange(rowNumber, headers.indexOf('cedula') + 1).getDisplayValue();
  const pinHash = sheet.getRange(rowNumber, pinHashColumn + 1).getDisplayValue();
  const pinStatus = sheet.getRange(rowNumber, pinStatusColumn + 1).getDisplayValue();
  if (!pinStatus) {
    sheet.getRange(rowNumber, pinStatusColumn + 1).setValue(pinHash ? 'ACTIVO' : 'PENDIENTE');
    sheet.getRange(rowNumber, updatedAtColumn + 1).setValue(now);
  }
  const activationHash = sheet.getRange(rowNumber, activationHashColumn + 1).getDisplayValue();
  const activationExpires = sheet.getRange(rowNumber, activationExpiresColumn + 1).getValue();
  const activationExpired = !(activationExpires instanceof Date) || activationExpires.getTime() <= Date.now();
  if (!pinHash && !cedula) {
    console.warn('Complete la cedula y el nombre del SUPERADMIN en usuarios y vuelva a ejecutar setupDatabase.');
  } else if (!pinHash && (!activationHash || activationExpired)) {
    const activationCode = generateActivationCode_();
    const userId = sheet.getRange(rowNumber, headers.indexOf('id') + 1).getDisplayValue();
    sheet.getRange(rowNumber, activationHashColumn + 1).setValue(hashActivationCode_(userId, activationCode));
    sheet.getRange(rowNumber, activationExpiresColumn + 1).setValue(new Date(Date.now() + 24 * 60 * 60 * 1000));
    console.log(`Codigo de activacion inicial del SUPERADMIN: ${activationCode}`);
  }
}

function generateActivationCode_() {
  const value = parseInt(Utilities.getUuid().replace(/-/g, '').slice(0, 8), 16) % 1000000;
  return String(value).padStart(6, '0');
}

function ensureAuthSecret_() {
  const properties = PropertiesService.getScriptProperties();
  let secret = properties.getProperty('operationsAuthSecret');
  if (!secret) {
    secret = `${Utilities.getUuid()}${Utilities.getUuid()}`;
    properties.setProperty('operationsAuthSecret', secret);
  }
  return secret;
}

function hashPin_(userId, pin) {
  const signature = Utilities.computeHmacSha256Signature(`${userId}:${pin}`, ensureAuthSecret_());
  return Utilities.base64EncodeWebSafe(signature);
}

function hashActivationCode_(userId, code) {
  const signature = Utilities.computeHmacSha256Signature(`activation:${userId}:${code}`, ensureAuthSecret_());
  return Utilities.base64EncodeWebSafe(signature);
}

function appendDatabaseRecord_(sheet, record) {
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map((header) => String(header).trim());
  sheet.appendRow(headers.map((header) => (
    record[header] === undefined ? '' : safeDatabaseValue_(record[header])
  )));
}

function safeDatabaseValue_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? `'${value}` : value;
}

function removeInitialSheet_(spreadsheet, databaseWasCreated) {
  if (!databaseWasCreated) return;

  spreadsheet.getSheets().forEach((sheet) => {
    if (DB_SCHEMA[sheet.getName()]) return;
    if (sheet.getLastRow() === 0 || sheet.getDataRange().isBlank()) {
      spreadsheet.deleteSheet(sheet);
    }
  });
}

function validateDatabase_(spreadsheet) {
  const errors = [];
  const sheets = [];

  Object.keys(DB_SCHEMA).forEach((sheetName) => {
    const sheet = spreadsheet.getSheetByName(sheetName);
    if (!sheet) {
      errors.push(`Falta la hoja ${sheetName}`);
      return;
    }

    const headers = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1))
      .getDisplayValues()[0]
      .map((header) => String(header).trim());
    const populatedHeaders = headers.filter((header) => header !== '');
    const missingHeaders = DB_SCHEMA[sheetName].headers
      .filter((header) => headers.indexOf(header) === -1);
    const duplicateHeaders = populatedHeaders
      .filter((header, index) => populatedHeaders.indexOf(header) !== index);
    if (missingHeaders.length) {
      errors.push(`${sheetName}: faltan ${missingHeaders.join(', ')}`);
    }
    if (duplicateHeaders.length) {
      errors.push(`${sheetName}: encabezados duplicados ${[...new Set(duplicateHeaders)].join(', ')}`);
    }
    sheets.push({ name: sheetName, columns: populatedHeaders.length });
  });

  validateUniqueData_(spreadsheet, errors);

  if (errors.length) {
    throw new Error(`La base no paso la validacion: ${errors.join(' | ')}`);
  }
  return { sheets };
}

function validateUniqueData_(spreadsheet, errors) {
  Object.keys(DB_SCHEMA).forEach((sheetName) => {
    validateUniqueColumns_(spreadsheet.getSheetByName(sheetName), ['id'], errors);
  });
  validateUniqueColumns_(spreadsheet.getSheetByName('configuracion'), ['clave'], errors);
  validateUniqueColumns_(spreadsheet.getSheetByName('usuarios'), ['cedula'], errors, false, false);
  validateUniqueColumns_(spreadsheet.getSheetByName('usuarios'), ['email'], errors, true, false);
  validateUniqueColumns_(spreadsheet.getSheetByName('usuarios_locales'), ['usuario_id', 'local_id'], errors);
}

function validateUniqueColumns_(sheet, columnNames, errors, normalizeCase, required) {
  if (!sheet || sheet.getLastRow() < 2) return;

  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0]
    .map((header) => String(header).trim());
  const indexes = columnNames.map((columnName) => headers.indexOf(columnName));
  if (indexes.some((index) => index === -1)) return;

  const seen = new Set();
  const duplicates = new Set();
  sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getDisplayValues()
    .forEach((row, index) => {
      if (row.every((value) => String(value).trim() === '')) return;
      const parts = indexes.map((index) => String(row[index]).trim());
      if (parts.some((part) => part === '')) {
        if (required !== false) {
          errors.push(`${sheet.getName()}: falta ${columnNames.join(' + ')} en la fila ${index + 2}`);
        }
        return;
      }
      const key = normalizeCase ? parts.join('\u0000').toLowerCase() : parts.join('\u0000');
      if (seen.has(key)) duplicates.add(parts.join(' + '));
      seen.add(key);
    });

  if (duplicates.size) {
    errors.push(`${sheet.getName()}: valores duplicados en ${columnNames.join(' + ')}: ${[...duplicates].join(', ')}`);
  }
}
