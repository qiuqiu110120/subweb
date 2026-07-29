import { handleRequest, type Env } from "./api-handler";

export const onRequestOptions = async () => new Response(null, {
  status: 204,
  headers: {
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Node-Secret",
    "Access-Control-Max-Age": "86400",
  },
});

export const onRequest = async (context: { request: Request; env: Env }) =>
  handleRequest(context.request, context.env);
