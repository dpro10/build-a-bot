/** One page (or slide, or photo) of a file, as read. */
export type ReadPage = {
  /** 1-based; 0 when the file has no real pages (a text file, a Word file without page breaks). */
  page: number;
  /** "Page 3", "Slide 4", "Photo", "Document". */
  label: string;
  text: string;
  /** No words found here (a blank slide, a scan that couldn't be read). */
  empty?: boolean;
};

/** What reading a file found. */
export type ReadResult = {
  pages: ReadPage[];
  /** Pages or slides in the file (may be more than were read). */
  pageCount: number;
  /** Paid model work, in micro-dollars (reading photos and scans). */
  costMicros: number;
  /** Something the owner should know ("12 scanned pages weren't read: out of credit"). */
  note?: string;
};
