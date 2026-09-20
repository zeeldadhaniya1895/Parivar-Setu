import schemesJson from "../config/schemes.json";
import { parseSchemesConfig } from "./engine/eligibility";

/** Scheme rules and display names, parsed once from config/schemes.json. */
export const schemesConfig = parseSchemesConfig(schemesJson);

const byCode = new Map(schemesConfig.schemes.map((s) => [s.code, s]));

export const schemeName = (code: string): string => byCode.get(code)?.name ?? code;
export const schemeNameGu = (code: string): string => byCode.get(code)?.nameGu ?? code;
export const schemeScope = (code: string) => byCode.get(code)?.scope ?? "person";
export const schemeIsDiscoveryOnly = (code: string): boolean => byCode.get(code)?.enrollment === "none";
