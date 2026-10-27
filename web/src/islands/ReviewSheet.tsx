// Placeholder until Task 8 adds the review actions.
export interface ReviewItem {
  sessionKey: string;
  localDate: string;
  kind: "merge_split" | "pick" | "confirm";
  summary: string;
}

export default function ReviewSheet(_: { item: ReviewItem | null; onClose: () => void; onResolved: () => void }) {
  return null;
}
