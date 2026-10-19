"use client";

import { createContext } from "react";

/**
 * True inside an `AomiSheet`. A dialog opened from a sheet already sits on
 * the sheet's backdrop, so it adds only a light dim instead of a second
 * dark, blurred one.
 */
export const InSheetContext = createContext(false);
