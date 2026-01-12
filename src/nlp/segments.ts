import { z } from "zod";

/**
 * Schema for a single segment (both source and translated)
 */
export const SegmentSchema = z.object({
  start: z.number().min(0),
  end: z.number().min(0),
  text: z.string()
});

export type Segment = z.infer<typeof SegmentSchema>;

/**
 * Schema for segment array
 */
export const SegmentsSchema = z.array(SegmentSchema);

export type Segments = z.infer<typeof SegmentsSchema>;

/**
 * Parse and validate segments from unknown input
 */
export function parseSegments(data: unknown): Segments {
  return SegmentsSchema.parse(data);
}
