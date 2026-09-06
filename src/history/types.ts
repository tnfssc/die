export interface HistoryProvenance {
  source: "original-transcript";
  scope: "active-session-branch" | "cross-session-branch";
  sessionId: string;
  sessionFile?: string;
  cwd: string;
  branchLeafId: string | null;
  entryId: string;
  timestamp: string;
  role: "user" | "assistant" | "toolResult" | "bashExecution";
  part: number;
}

export interface HistorySearchMatch {
  ref: string;
  excerpt: string;
  matchOffset: number;
  textLength: number;
  provenance: HistoryProvenance;
}

export interface HistorySearchResult {
  matches: HistorySearchMatch[];
  nextCursor?: string;
  scannedEntries: number;
  scanLimited: boolean;
}

export interface HistoryReadResult {
  ref: string;
  text: string;
  range: { start: number; end: number; total: number };
  nextCursor?: string;
  provenance: HistoryProvenance;
}
