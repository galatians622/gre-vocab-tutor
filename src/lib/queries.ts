import { queryOptions } from "@tanstack/react-query";
import {
  getDashboard,
  getLibrary,
  getPreferences,
  getProgress,
  getRoots,
  getRootSession,
  getWordDetail,
} from "./learning.functions";

export const dashboardQuery = queryOptions({ queryKey: ["dashboard"], queryFn: () => getDashboard() });
export const progressQuery = queryOptions({ queryKey: ["progress"], queryFn: () => getProgress() });
export const libraryQuery = queryOptions({ queryKey: ["library"], queryFn: () => getLibrary() });
export const rootsQuery = queryOptions({ queryKey: ["roots"], queryFn: () => getRoots() });
export const prefsQuery = queryOptions({ queryKey: ["prefs"], queryFn: () => getPreferences() });
export const wordQuery = (slug: string) =>
  queryOptions({ queryKey: ["word", slug], queryFn: () => getWordDetail({ data: { slug } }) });
export const rootSessionQuery = (slug: string) =>
  queryOptions({ queryKey: ["root", slug], queryFn: () => getRootSession({ data: { slug } }) });

export function pct(n: number | null | undefined) {
  return n == null ? "—" : `${Math.round(n * 100)}%`;
}
