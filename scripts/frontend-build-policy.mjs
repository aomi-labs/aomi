// Runs only after the existing production PR source/main/merge-tree checks.
import { Vercel, verifyHeldProjects } from "./frontend-release.mjs";
await verifyHeldProjects(new Vercel(process.env.VERCEL_READONLY_TOKEN));
console.log(
  "All active surface builds are held; merging source cannot assign their production domains.",
);
