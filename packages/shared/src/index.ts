export type ScanStatus = 'pending' | 'running' | 'completed' | 'failed';
export type PageType = 'category' | 'search' | 'product' | 'unknown';
export type IssueSeverity = 'low' | 'medium' | 'high';
export type IssueType =
  | 'broken_link'
  | 'filter_inconsistency'
  | 'search_quality'
  | 'listing_problem';

export interface Scan {
  id: string;
  url: string;
  status: ScanStatus;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface Page {
  id: string;
  scan_id: string;
  url: string;
  type: PageType;
  status_code: number | null;
  crawled_at: string;
}

export interface Issue {
  id: string;
  scan_id: string;
  page_id: string | null;
  type: IssueType;
  severity: IssueSeverity;
  description: string;
  repro_steps: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface ScanResult {
  scan: Scan;
  pages: Page[];
  issues: Issue[];
  summary: {
    total_pages: number;
    total_issues: number;
    by_severity: Record<IssueSeverity, number>;
    by_type: Record<IssueType, number>;
  };
}
