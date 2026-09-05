const SOURCE_FILE_ID = '1JQjnEPhZwj5Btr7ltGem4ZjMriZKqzrD';
const SCHEMA_VERSION = 1;
const PROPERTY_SOURCE_VERSION = 'catalogSourceVersion';
const PROPERTY_OUTPUT_FILE_ID = 'catalogOutputFileId';

const REQUIRED_HEADERS = {
  'cod.articulo': 'articleCode',
  'articulo': 'description',
  'cod.barra': 'barcode',
};

/**
 * Web App endpoint. Use ?meta=1 for lightweight metadata or ?refresh=1 to
 * force regeneration. The deployment must execute as the script owner.
 */
function doGet(event) {
  try {
    const parameters = (event && event.parameter) || {};
    const json = getCatalogJson_(parameters.refresh === '1');
    const response = parameters.meta === '1' ? JSON.stringify(JSON.parse(json).meta) : json;
    return ContentService.createTextOutput(response).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      error: String(error && error.message ? error.message : error),
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

/** Run this once in the editor to authorize Drive and generate the catalog. */
function setupCatalog() {
  const catalog = JSON.parse(getCatalogJson_(true));
  console.log(JSON.stringify(catalog.meta, null, 2));
}

function getCatalogJson_(forceRefresh) {
  const sourceFile = DriveApp.getFileById(SOURCE_FILE_ID);
  const sourceVersion = [
    sourceFile.getLastUpdated().toISOString(),
    sourceFile.getSize(),
  ].join(':');
  const properties = PropertiesService.getScriptProperties();

  if (!forceRefresh && properties.getProperty(PROPERTY_SOURCE_VERSION) === sourceVersion) {
    const cached = readOutputFile_(properties.getProperty(PROPERTY_OUTPUT_FILE_ID));
    if (cached) return cached;
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!forceRefresh && properties.getProperty(PROPERTY_SOURCE_VERSION) === sourceVersion) {
      const cached = readOutputFile_(properties.getProperty(PROPERTY_OUTPUT_FILE_ID));
      if (cached) return cached;
    }

    const catalog = buildCatalog_(sourceFile);
    const json = JSON.stringify(catalog);
    const newOutput = DriveApp.createFile(
      Utilities.newBlob(json, 'application/json', 'articulos-reposicion.json')
    );
    const previousOutputId = properties.getProperty(PROPERTY_OUTPUT_FILE_ID);

    properties.setProperties({
      [PROPERTY_SOURCE_VERSION]: sourceVersion,
      [PROPERTY_OUTPUT_FILE_ID]: newOutput.getId(),
    });

    if (previousOutputId && previousOutputId !== newOutput.getId()) {
      try {
        DriveApp.getFileById(previousOutputId).setTrashed(true);
      } catch (error) {
        console.warn(`No se pudo eliminar el JSON anterior: ${error.message}`);
      }
    }
    return json;
  } finally {
    lock.releaseLock();
  }
}

function readOutputFile_(fileId) {
  if (!fileId) return null;
  try {
    return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
  } catch (error) {
    return null;
  }
}

function buildCatalog_(sourceFile) {
  const convertedFile = Drive.Files.create(
    {
      name: `catalogo-temporal-${Date.now()}`,
      mimeType: 'application/vnd.google-apps.spreadsheet',
    },
    sourceFile.getBlob(),
    { fields: 'id' }
  );

  try {
    const spreadsheet = openConvertedSpreadsheet_(convertedFile.id);
    const match = findCatalogSheet_(spreadsheet);
    const products = [];
    const skippedRows = [];

    for (let rowIndex = match.headerRowIndex + 1; rowIndex < match.parameterRowIndex; rowIndex += 1) {
      const row = match.values[rowIndex];
      const articleCode = String(row[match.columns.articleCode] || '').trim();
      const description = String(row[match.columns.description] || '').trim();
      const barcode = String(row[match.columns.barcode] || '').trim();

      if (!articleCode && !description && !barcode) continue;
      if (!articleCode || !description) {
        skippedRows.push(rowIndex + 1);
        continue;
      }
      products.push({
        articleCode,
        description,
        barcode: barcode || null,
      });
    }

    if (!products.length) throw new Error('No se encontraron artículos válidos');

    return {
      meta: {
        schemaVersion: SCHEMA_VERSION,
        source: sourceFile.getName(),
        driveFileId: sourceFile.getId(),
        sourceModifiedAt: sourceFile.getLastUpdated().toISOString(),
        sourceSize: sourceFile.getSize(),
        generatedAt: new Date().toISOString(),
        sheet: match.sheet.getName(),
        headerRow: match.headerRowIndex + 1,
        firstDataRow: match.headerRowIndex + 2,
        lastDataRow: match.parameterRowIndex,
        sourceRows: match.parameterRowIndex - match.headerRowIndex - 1,
        totalRecords: products.length,
        skippedRows,
        duplicateArticleCodes: duplicateSummary_(products, 'articleCode'),
        duplicateBarcodes: duplicateSummary_(products, 'barcode'),
      },
      products,
    };
  } finally {
    DriveApp.getFileById(convertedFile.id).setTrashed(true);
  }
}

function openConvertedSpreadsheet_(spreadsheetId) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      lastError = error;
      Utilities.sleep(1000 * (attempt + 1));
    }
  }
  throw lastError;
}

function findCatalogSheet_(spreadsheet) {
  for (const sheet of spreadsheet.getSheets()) {
    const values = sheet.getDataRange().getDisplayValues();
    for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
      const labels = {};
      values[rowIndex].forEach((value, columnIndex) => {
        if (value !== '') labels[normalizeLabel_(value)] = columnIndex;
      });
      if (Object.keys(REQUIRED_HEADERS).every((label) => labels[label] !== undefined)) {
        const parameterRowIndex = findParameterRow_(values, rowIndex + 1);
        return {
          sheet,
          values,
          headerRowIndex: rowIndex,
          parameterRowIndex,
          columns: Object.fromEntries(
            Object.entries(REQUIRED_HEADERS).map(([label, field]) => [field, labels[label]])
          ),
        };
      }
    }
  }
  throw new Error(`No se encontraron los encabezados requeridos: ${Object.keys(REQUIRED_HEADERS).join(', ')}`);
}

function findParameterRow_(values, startIndex) {
  for (let rowIndex = startIndex; rowIndex < values.length; rowIndex += 1) {
    if (values[rowIndex].some((value) => normalizeLabel_(value) === 'parametros')) {
      return rowIndex;
    }
  }
  return values.length;
}

function normalizeLabel_(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function duplicateSummary_(products, key) {
  const counts = new Map();
  products.forEach((product) => {
    const value = product[key];
    if (value) counts.set(value, (counts.get(value) || 0) + 1);
  });
  const duplicates = [...counts.entries()]
    .filter((entry) => entry[1] > 1)
    .map((entry) => entry[0])
    .sort();
  return { count: duplicates.length, sample: duplicates.slice(0, 10) };
}
