import { main } from "./app";

process.exitCode = await main(process.argv.slice(2));
