// Shared API response types — mirrors the backend output shapes.

export interface MeResponse {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'standard';
}

export interface AppUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'standard';
  active: boolean;
  addedBy: string;
  createdAt: string;
  updatedAt: string;
}

export type SfInstance = 'Instance A' | 'Instance B' | 'Instance C' | 'Instance D' | 'Instance E';
export type CleanupMode = 'standard' | 'urgent' | 'critical';
export type CleanupType = 'routine' | 'on_demand';

export interface AnalysisResultRow {
  id: string;
  email: string;
  fullName: string;
  department: string;
  division: string;
  businessTitle: string;
  region: string;
  product: string;
  managerEmail: string;
  onLeave: string;
  workerType: string;
  acquisitionCompany: string | null;
  sfCreatedDate: string;
  lastActivityDate: string | null;
  monthlyActivity: number | null;
  sfLastActivityDate: string | null;
  sfDaysActive: number | null;
  platformLastDate: string | null;
  platformDaysActive: number | null;
  permissionSets: string | null;
  profile: string | null;
  classification: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  matchTier: number;
  reasoning: string;
  actionStatus: 'pending' | 'actioned' | 'deferred';
  deltaCategory: 'newly_inactive' | 'persistently_inactive' | 'recovered' | 'reappeared' | 'net_new' | null;
  previousClassification: string | null;
  sporadicFlag?: {
    note: string;
    removalCount: number;
    lastRemovedAt: string | null;
    lastReappearedAt: string | null;
    flaggedBy: string;
    flaggedAt: string;
  };
}

export interface RunTabs {
  directRemove: AnalysisResultRow[];
  notifyFirst: AnalysisResultRow[];
  exEmployee: AnalysisResultRow[];
  gtmFlagged: AnalysisResultRow[];
  priorException: AnalysisResultRow[];
  humanReview: AnalysisResultRow[];
  excluded: AnalysisResultRow[];
}

export interface RunSummary {
  systemName: string;
  instance: string;
  mode: CleanupMode;
  cleanupType: CleanupType;
  ranByEmail: string;
  ranAt: string;
  totalUsers: number;
  counts: {
    directRemove: number;
    notifyFirst: number;
    exEmployees: number;
    gtmFlagged: number;
    priorException: number;
    humanReview: number;
    excluded: number;
  };
  tier3MatchCount: number;
  warnings: string[];
}

export interface SporadicFlagData {
  note: string;
  removalCount: number;
  lastRemovedAt: string | null;
  lastReappearedAt: string | null;
  flaggedBy: string;
  flaggedAt: string;
}

export interface DeltaSummary {
  isBaseline: boolean;
  previousRunId: string | null;
  previousRunDate: string | null;
  previousMode: string | null;
  daysSinceLastRun: number | null;
  modeMismatch: boolean;
  counts: {
    newlyInactive: number;
    persistentlyInactive: number;
    recovered: number;
    reappeared: number;
    netNew: number;
  };
}

export interface RunResult {
  runId: string;
  summary: RunSummary;
  tabs: RunTabs;
  sporadicFlags?: Record<string, SporadicFlagData>;
  deltaSummary?: DeltaSummary;
}

export interface HistoryRun {
  id: string;
  systemName: string;
  instanceName: string;
  cleanupType: string;
  mode: string;
  licensesNeeded: number | null;
  ranByEmail: string;
  ranAt: string;
  totalUsers: number;
  actionedUsers: number;
}

export interface AccessCriteria {
  instanceId: string;
  instanceName: string;
  content: string | object;
  version: number;
  isDefault?: boolean;
  updatedBy?: string;
  updatedAt?: string;
  versions?: CriteriaVersion[];
}

export interface CriteriaVersion {
  id: string;
  version: number;
  changedBy: string;
  changeNote: string;
  createdAt: string;
}

export interface ReasoningTableContent {
  systemName: string;
  toolPurpose: string;
  primaryUserBase: string;
  inactivitySignals: Array<{
    fieldName: string;
    weight: number;
    reasoning: string;
  }>;
  thresholds: {
    standardDays: number;
    urgentDays: number;
  };
  consultRequiredRoles: string[];
  integrationPatterns: string[];
  gtmEquivalentRoles: string;
  additionalNotes: string;
}

export interface InstanceConfigRecord {
  id: string;
  instanceName: string;
  defaultScope: string;
  thresholds: { standardDays: number; urgentDays: number };
  productAlignment: { matchingProducts: string[] } | null;
  gtmHandling: string;
}

export interface SystemRecord {
  id: string;
  name: string;
  description: string;
  foundationalNote: string;
  instanceConfigs: InstanceConfigRecord[];
  reasoningTable: {
    content: ReasoningTableContent;
    confirmedByEmail: string;
    confirmedAt: string;
    version: number;
  } | null;
}
