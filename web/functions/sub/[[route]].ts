import { handleRequest } from "../api/api-handler";

export const onRequestGet = async (context: { request: Request; env: Parameters<typeof handleRequest>[1] }) =>
  handleRequest(context.request, context.env);
