/**
 * Shared Zod schemas reused across tools. Keep this thin - tool-specific
 * shapes live next to their tool definitions.
 */
import { z } from "zod";

export const urlSchema = z.string().url();

export const httpMethodSchema = z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);
