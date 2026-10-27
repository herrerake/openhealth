import type { ProviderId } from "../core/types";
import { syncMindbody } from "./mindbody";
import { syncStub } from "./stubs";
import type { Connector, ScopeDescription } from "./types";
import { syncWodup } from "./wodup";

const scopes = (...labels: string[]): ScopeDescription[] => labels.map((label) => ({ label }));
const GENERIC = scopes("Workouts and daily activity");

export const registry: Record<ProviderId, Connector> = {
  apple_health: {
    id: "apple_health",
    kind: "file",
    displayName: "Apple Health",
    category: "wearables",
    scopes: scopes("Workouts with heart rate and calories", "Resting heart rate, HRV and sleep"),
    status: "available",
  },
  garmin: { id: "garmin", kind: "oauth", displayName: "Garmin", category: "wearables", scopes: GENERIC, status: "available", sync: syncStub },
  oura: { id: "oura", kind: "oauth", displayName: "Oura", category: "wearables", scopes: GENERIC, status: "available", sync: syncStub },
  whoop: { id: "whoop", kind: "oauth", displayName: "WHOOP", category: "wearables", scopes: GENERIC, status: "available", sync: syncStub },
  wodup: {
    id: "wodup",
    kind: "oauth",
    displayName: "WodUp",
    category: "gym",
    scopes: scopes("Workouts, scores and PRs", "Your notes on results", "Programs you follow"),
    status: "available",
    sync: syncWodup,
  },
  mindbody: {
    id: "mindbody",
    kind: "oauth",
    displayName: "Mindbody",
    category: "gym",
    scopes: scopes("Class bookings and check-ins", "Studio and instructor"),
    status: "available",
    sync: syncMindbody,
  },
  hyrox: { id: "hyrox", kind: "oauth", displayName: "HYROX", category: "races", scopes: scopes("Race results and splits"), status: "available", sync: syncStub },
  race_results: {
    id: "race_results",
    kind: "oauth",
    displayName: "Race results",
    category: "races",
    scopes: scopes("Race results and splits"),
    status: "available",
    sync: syncStub,
  },
};

const DISPLAY_ORDER: ProviderId[] = ["apple_health", "garmin", "oura", "whoop", "wodup", "mindbody", "hyrox", "race_results"];

export function listProviders(): Connector[] {
  return DISPLAY_ORDER.map((id) => registry[id]);
}

export const isProviderId = (id: string): id is ProviderId => id in registry;
