import { GoogleGenAI } from '@google/genai';

/**
 * gemini-3.5-flash is served from Vertex's GLOBAL endpoint; regional
 * locations 404 for it. Override via env for other models/regions.
 */
export const GCP_PROJECT = process.env['GCP_PROJECT'] ?? 'roundtable-public';
export const GCP_LOCATION = process.env['GCP_LOCATION'] ?? 'global';
export const TEXT_MODEL = process.env['CONCURRENCE_MODEL'] ?? 'gemini-3.5-flash';

let client: GoogleGenAI | undefined;

export function genai(): GoogleGenAI {
  client ??= new GoogleGenAI({
    vertexai: true,
    project: GCP_PROJECT,
    location: GCP_LOCATION,
  });
  return client;
}
