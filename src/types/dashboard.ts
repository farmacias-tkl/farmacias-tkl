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
}

export interface DashboardKPIs {
  totalBankBalance: number;
  totalSales: number;
  totalUnits: number;
  totalReceipts: number;
  avgTicket: number;
  salesVariation: number | null;
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
  lastSync: { at: Date; status: string } | null;
  branches: Array<{ id: string; name: string }>;
  alertas: string[];
}
