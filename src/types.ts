export interface StockItem {
  id: string;
  text: string;
  name?: string;
  quantity?: string;
  articleCode?: string;
  barcode?: string;
  createdAt: number;
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
