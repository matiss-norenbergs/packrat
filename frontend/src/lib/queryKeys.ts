// Query-key roots shared by the hooks and the invalidation helpers (kept here so lib/ never has to
// import from hooks/). Each hook module re-exports its own root.
export const libraryQueryKey = ["library"] as const
export const collectionsQueryKey = ["collections"] as const
export const downloadsQueryKey = ["downloads"] as const
