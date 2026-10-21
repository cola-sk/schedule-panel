import { app } from "../src/app.js";

// Vercel Edge Runtime 原生支持 Web standard Request/Response
export const config = {
  runtime: "edge",
};

export default app.fetch;
