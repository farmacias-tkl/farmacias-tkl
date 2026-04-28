export interface BranchBalance {
  branchId: string;
  branchName: string;
  total: number;
  accounts: Array<{
    bankName: string;
    accountLabel: string;
    balance: number;
    checks: number | null;
    prevBalance: number | null;
  }>;
}

export interface BranchSales {
  branchId: string;
  branchName: string;
  totalSales: number;
  units: number;
  receipts: number;
  avgTicket: number;
  vsYesterday: number | null;
  dataSource?: string | null;
  rawData?: Record<string, unknown> | null;
}

export interface DashboardKPIs {
  totalBankBalance: number;
  totalSales: number;
  totalUnits: number;
  totalReceipts: number;
  avgTicket: number;
  salesVariation: number | null;
}

// ============================================================================
// Estructura del rawData cuando dataSource === "siaf"
// (Compatibilidad: rawData sigue tipado como Record<string, unknown> | null
//  en BranchSales para que también acepte el formato "demo" legacy.)
// ============================================================================
export interface SiafVendor {
  codigo:     string;
  nombre:     string;
  ventas:     number;
  tickets:    number;
  descuentos: number;
}

export interface SiafObraSocial {
  codigo:       string;
  nombre:       string;
  ventas_bruto: number;
  descuentos:   number;
  ventas_neto:  number;
  tickets:      number;
  unidades:     number;
}

export interface SiafSalesRawData {
  source:         "siaf";
  efectivo:       number;
  tarjeta:        number;
  obra_social:    number;
  vendedores:     SiafVendor[];
  obras_sociales: SiafObraSocial[];
}

// ============================================================================
// ComparativeSection — response de /api/dashboard/comparative
// ============================================================================
export interface ComparativeMetric {
  current:   number;
  yearAgo:   number;
  variation: number | null;
}

export interface ComparativeBranchRow {
  branchId:   string;
  branchName: string;
  sales:      ComparativeMetric;
  units:      ComparativeMetric;
  tickets:    ComparativeMetric;
  currentDaysWithData: number;
}

export interface ComparativeResponse {
  period:    string;
  branchId:  string;
  anchorDate?: string | null;
  aggregate: {
    sales:   ComparativeMetric;
    units:   ComparativeMetric;
    tickets: ComparativeMetric;
  };
  byBranch:  ComparativeBranchRow[];
  byMonth:   Array<{ month: string; current: number; yearAgo: number }> | null;
}

export interface DashboardSummary {
  date: Date;
  isToday: boolean;
  branchFilter: string;
  kpis: DashboardKPIs;
  balancesByBranch: BranchBalance[];
  salesByBranch: BranchSales[];
  lastBalanceDate: Date | null;
  isStaleBalances: boolean;
  lastSalesDate: Date | null;
  isStaleSales: boolean;
  lastSync: { at: Date; status: string } | null;
  branches: Array<{ id: string; name: string }>;
  alertas: string[];
}
