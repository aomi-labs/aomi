export type DataEntry = {name: string; href: string; isDirectory: boolean; size: number | null};
export type ResearchDirectory = {segments: string[]; entries: DataEntry[]};
